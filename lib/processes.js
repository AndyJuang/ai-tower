'use strict';
// Map ps snapshot → tower runners / orphans, and count live capacity.
// Pure: no fs, no exec. Tests feed a fake process list.

const AGENT_RE = /(^|\/)(grok|claude|agy)( +-{1,2}[A-Za-z][\w-]*(?:[ =](?!-)\S+)?)*? +-p\b|(^|\/|\s)codex(\.js)? exec\b/;
const CODEX_RE = /(^|\/|\s)codex(\.js)? exec\b/;

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function lineOfCommand(command, opts) {
  const runnerScript = opts.runnerScript || 'runner.sh';
  const main = command.match(new RegExp('^(?:/bin/)?bash \\S*' + esc(runnerScript) + ' (\\S+)'));
  if (main) return main[1];
  for (const x of opts.extraRunners || []) {
    const re = new RegExp('^(?:/bin/)?bash \\S*' + esc(x.script) + '(?:\\s+(\\S+))?');
    const m = command.match(re);
    if (m) return m[1] || x.line;
  }
  return null;
}

function addTree(startPid, kids, owned) {
  const st = [startPid];
  while (st.length) {
    const x = st.pop();
    if (owned.has(x)) continue;
    owned.add(x);
    (kids.get(x) || []).forEach(k => st.push(k.pid));
  }
}

function findAgent(rootPid, kids, procs, pgid) {
  const stack = [...(kids.get(rootPid) || [])];
  const seen = new Set();
  while (stack.length) {
    const k = stack.shift();
    if (!k || seen.has(k.pid)) continue;
    seen.add(k.pid);
    if (AGENT_RE.test(k.command)) return k;
    stack.push(...(kids.get(k.pid) || []));
  }
  return procs.find(k => k.pgid === pgid && k.pid !== rootPid && AGENT_RE.test(k.command)) || null;
}

function mapProcesses(procs, opts) {
  opts = opts || {};
  const groups = Object.create(null);
  const kids = new Map();
  const queueAlive = {};
  for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  for (const p of procs) {
    const line = lineOfCommand(p.command, opts);
    if (line) { (groups[line] = groups[line] || []).push(p); }
    for (const q of opts.queueScripts || []) if (p.command.includes(q) && /bash/.test(p.command)) queueAlive[q] = p.pid;
  }
  const runners = {};
  const owned = new Set();
  for (const [line, list] of Object.entries(groups)) {
    const ids = new Set(list.map(p => p.pid));
    const top = list.find(p => !ids.has(p.ppid)) || list.slice().sort((a, b) => a.pid - b.pid)[0];
    const r = { pid: top.pid, ppid: top.ppid, pgid: top.pgid, stat: top.stat, etime: top.etime, started: top.started, command: top.command };
    for (const p of list) addTree(p.pid, kids, owned);
    const agent = findAgent(top.pid, kids, procs, top.pgid);
    if (agent) {
      r.agent = { pid: agent.pid, stat: agent.stat, started: agent.started, etime: agent.etime, cmd: agent.command.split(' ').slice(0, 2).join(' ') };
      addTree(agent.pid, kids, owned);
    }
    runners[line] = r;
  }
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const orphans = procs.filter(p => CODEX_RE.test(p.command) && !owned.has(p.pid) && !(byPid.get(p.ppid) && CODEX_RE.test(byPid.get(p.ppid).command)));
  return { runners, queueAlive, orphans };
}

function isLiveCap(s) {
  if (!s) return false;
  if (s.bay === 'goodday' || s.status === 'LANDED' || s.status === 'STOPPED' || s.status === 'DIVERTED') return false;
  if (s.status === 'TAKEOFF') return true;
  if (s.runnerPid) return true;
  return false;
}

function countCapacity(strips, opts) {
  const laneCodes = opts.laneCodes || ['GK', 'CL', 'CX', 'AG'];
  const key2code = opts.key2code || { grok: 'GK', claude: 'CL', codex: 'CX', antigravity: 'AG' };
  const caps = opts.caps || {};
  const now = opts.now != null ? opts.now : Date.now();
  const graceMs = opts.graceMs != null ? opts.graceMs : 90e3;
  const globalCap = opts.globalCap || 8;
  const out = {};
  let total = 0;
  for (const k of laneCodes) out[k] = { running: 0, cap: caps[k] != null ? caps[k] : 2, holding: false, until: null };
  const seen = new Set();
  for (const s of strips || []) {
    const k = s.airline && key2code[s.airline.key];
    if (!k || !out[k]) continue;
    if (s.status === 'HOLDING' && s.resumeAt > now) {
      out[k].holding = true;
      out[k].until = Math.max(out[k].until || 0, s.resumeAt);
    }
    if (!isLiveCap(s)) continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out[k].running++;
    total++;
  }
  for (const d of opts.dispatched || []) {
    if (now - d.at >= graceMs) continue;
    if (!d.line || seen.has(d.line)) continue;
    if ((strips || []).some(s => s.id === d.line && (s.runnerPid || s.status === 'TAKEOFF'))) continue;
    const lane = out[d.lane]; if (!lane) continue;
    seen.add(d.line);
    lane.running++;
    total++;
  }
  return { lanes: out, total, globalCap };
}

module.exports = { AGENT_RE, mapProcesses, countCapacity, isLiveCap, lineOfCommand };
