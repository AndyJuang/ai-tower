'use strict';
const assert = require('assert');
const P = require('../lib/processes');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

function proc(pid, ppid, command, extra) {
  extra = extra || {};
  return { pid, ppid, pgid: extra.pgid || 100, stat: extra.stat || 'Ss', etime: '01:00', started: 1, command };
}

const LINE = 'codex-vx-i157-youtube';
const SCRIPT = 'v1-extra-runner.sh';
const OPTS = { runnerScript: SCRIPT, extraRunners: [], queueScripts: [] };

function caffeinateTree() {
  // top runner, caffeinate, inner bash, helper subshell, sibling codex exec
  return [
    proc(100, 1, `bash /tmp/logs/${SCRIPT} ${LINE}`),
    proc(101, 100, `/usr/bin/caffeinate -i /bin/bash /tmp/logs/${SCRIPT} ${LINE}`),
    proc(102, 101, `/bin/bash /tmp/logs/${SCRIPT} ${LINE}`),
    proc(103, 102, `bash /tmp/logs/${SCRIPT} ${LINE}`),
    proc(104, 102, `/opt/homebrew/bin/codex exec -C /tmp/wt --skip-git-repo-check`),
  ];
}

check('caffeinate + helper subshell → 1 top runner, 0 orphans, agent found', () => {
  const { runners, orphans } = P.mapProcesses(caffeinateTree(), OPTS);
  const keys = Object.keys(runners);
  assert.deepEqual(keys, [LINE]);
  assert.equal(runners[LINE].pid, 100, 'topmost runner pid, not helper ' + runners[LINE].pid);
  assert.ok(runners[LINE].agent, 'agent paired');
  assert.equal(runners[LINE].agent.pid, 104);
  assert.equal(orphans.length, 0, 'codex exec must be owned, not an orphan');
});

check('extraRunners with caffeinate tree still one line', () => {
  const { runners, orphans } = P.mapProcesses(caffeinateTree(), {
    runnerScript: 'runner.sh',
    extraRunners: [{ script: SCRIPT, line: LINE }],
    queueScripts: [],
  });
  assert.equal(Object.keys(runners).length, 1);
  assert.equal(runners[LINE].pid, 100);
  assert.equal(orphans.length, 0);
});

check('true stand-alone codex exec is an orphan', () => {
  const procs = [proc(200, 1, '/opt/homebrew/bin/codex exec -C /tmp/other')];
  const { runners, orphans } = P.mapProcesses(procs, OPTS);
  assert.equal(Object.keys(runners).length, 0);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].pid, 200);
});

const KEY2CODE = { grok: 'GK', claude: 'CL', codex: 'CX', antigravity: 'AG' };
const CAPS = { GK: 6, CL: 2, CX: 2, AG: 2 };
function capOpts(extra) {
  return Object.assign({
    laneCodes: ['GK', 'CL', 'CX', 'AG'],
    key2code: KEY2CODE,
    caps: CAPS,
    dispatched: [],
    now: 1e12,
    globalCap: 8,
    graceMs: 90e3,
  }, extra || {});
}
function strip(id, air, status, extra) {
  extra = extra || {};
  return Object.assign({
    id, airline: { key: air }, status, bay: extra.bay || (status === 'TAKEOFF' ? 'takeoff' : status === 'LANDED' || status === 'STOPPED' || status === 'DIVERTED' ? 'goodday' : 'ready'),
    runnerPid: extra.runnerPid || null, agentPid: extra.agentPid || null, resumeAt: extra.resumeAt,
  }, extra);
}

check('capacity: caffeinate scenario counts CX=1 (no orphan double count)', () => {
  const mapped = P.mapProcesses(caffeinateTree(), OPTS);
  const strips = [
    strip(LINE, 'codex', 'TAKEOFF', { runnerPid: mapped.runners[LINE].pid, agentPid: mapped.runners[LINE].agent.pid }),
  ];
  mapped.orphans.forEach(o => strips.push(strip('codex-pid' + o.pid, 'codex', 'TAKEOFF', { agentPid: o.pid })));
  const c = P.countCapacity(strips, capOpts());
  assert.equal(c.lanes.CX.running, 1);
  assert.equal(c.total, 1);
  assert.equal(mapped.orphans.length, 0);
});

check('capacity: same line counted once; GOOD DAY / LANDED ignored', () => {
  const strips = [
    strip(LINE, 'codex', 'TAKEOFF', { runnerPid: 100, agentPid: 104 }),
    strip(LINE, 'codex', 'TAKEOFF', { runnerPid: 100, agentPid: 104 }),
    strip('codex-old', 'codex', 'LANDED', { bay: 'goodday', runnerPid: 99, agentPid: null }),
    strip('codex-stop', 'codex', 'STOPPED', { bay: 'goodday', runnerPid: 98 }),
    strip('grok-taxi', 'grok', 'TAXI', { bay: 'ready', runnerPid: 50 }),
  ];
  const c = P.countCapacity(strips, capOpts());
  assert.equal(c.lanes.CX.running, 1);
  assert.equal(c.lanes.GK.running, 1);
  assert.equal(c.total, 2);
});

check('capacity: just-dispatched grace only if line not yet in ps', () => {
  const now = 1e12;
  const dispatched = [
    { ref: 'o/r#1', lane: 'CX', line: LINE, at: now - 10e3 },
    { ref: 'o/r#2', lane: 'CL', line: 'claude-v15-i1', at: now - 10e3 },
    { ref: 'o/r#3', lane: 'GK', line: 'grok-old', at: now - 120e3 },
  ];
  const strips = [strip(LINE, 'codex', 'TAKEOFF', { runnerPid: 100, agentPid: 104 })];
  const c = P.countCapacity(strips, capOpts({ now, dispatched }));
  assert.equal(c.lanes.CX.running, 1, 'visible line is not double-counted via grace');
  assert.equal(c.lanes.CL.running, 1, 'unseen just-dispatched counts');
  assert.equal(c.lanes.GK.running, 0, 'grace expired');
  assert.equal(c.total, 2);
});

check('capacity: HOLDING live runner counts; holding flag set', () => {
  const strips = [strip('claude-wait', 'claude', 'HOLDING', { bay: 'ready', runnerPid: 70, resumeAt: 1e12 + 60e3 })];
  const c = P.countCapacity(strips, capOpts({ now: 1e12 }));
  assert.equal(c.lanes.CL.running, 1);
  assert.equal(c.lanes.CL.holding, true);
});

check('isLiveCap: TAKEOFF yes, GOOD DAY no', () => {
  assert.equal(P.isLiveCap(strip('a', 'codex', 'TAKEOFF', { runnerPid: 1, agentPid: 2 })), true);
  assert.equal(P.isLiveCap(strip('b', 'codex', 'LANDED', { bay: 'goodday', runnerPid: 1 })), false);
  assert.equal(P.isLiveCap(strip('c', 'codex', 'TAXI', { runnerPid: 1 })), true);
  assert.equal(P.isLiveCap(strip('d', 'codex', 'SCHEDULED', { bay: 'park' })), false);
});

check('stand-alone grok job under a wrapper → grokOrphan with wt line + trailing issues', () => {
  const wt = '/x/proj-wt-grok-v9-i11';
  const procs = [proc(300, 1, `/bin/bash /x/_logs/v9/run.sh ${wt} 11 12`), proc(301, 300, 'grok --always-approve --prompt-file /x/_logs/v9/p-11.md --debug-file /x/d.log'),
    proc(302, 1, '/Users/a/.grok/bin/grok')];
  const { runners, orphans, grokOrphans } = P.mapProcesses(procs, OPTS);
  assert.equal(Object.keys(runners).length, 0); assert.equal(orphans.length, 0);
  assert.equal(grokOrphans.length, 1, 'interactive bare grok ignored');
  const g = grokOrphans[0];
  assert.equal(g.pid, 301); assert.equal(g.wrapperPid, 300); assert.equal(g.wt, wt); assert.equal(g.line, 'proj-wt-grok-v9-i11');
  assert.deepEqual(g.issues, ['#11', '#12']);
});

check('grok job: issues fall back to worktree name; tower-owned grok is not an orphan', () => {
  const procs = [proc(400, 1, '/bin/bash /x/run.sh /x/proj-wt-grok-v9-i21'), proc(401, 400, 'grok --prompt-file /x/p.md'),
    proc(500, 1, `bash /tmp/logs/${SCRIPT} grok-v9-x`), proc(501, 500, 'grok -p hello')];
  const { runners, grokOrphans } = P.mapProcesses(procs, OPTS);
  assert.ok(runners['grok-v9-x'].agent);
  assert.equal(grokOrphans.length, 1); assert.deepEqual(grokOrphans[0].issues, ['#21']);
});

if (failed) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
