'use strict';
// Takeoff = create worktree + branch, write prompt, register the line in the runner script's case table (safe atomic edit), launch detached runner.
const fs = require('fs');
const path = require('path');
const { run, tpeStamp } = require('./util');

const LANES = {
  GK: { prefix: 'grok', agent: 'Grok CLI', airline: 'Grok Air', key: 'grok', cap: 6, autoAllowed: true, autoDefault: true },
  CL: { prefix: 'claude', agent: 'Claude Code', airline: 'Claude Airways', key: 'claude', cap: 2, autoAllowed: true, autoDefault: false },
  CX: { prefix: 'codex', agent: 'Codex CLI', airline: 'Codex Airlines', key: 'codex', cap: 2, autoAllowed: true, autoDefault: false },
  AG: { prefix: 'antigravity', agent: 'Antigravity', airline: 'Antigravity Air', key: 'antigravity', cap: 2, autoAllowed: true, autoDefault: false },
};

function ctx(cfg) {
  const L = cfg.logsDir; const P = (pat, line) => pat.replace(/\{line\}/g, line);
  return { cfg, BASE: cfg.baseDir, L, RUNNER: path.join(L, cfg.runnerScript), MAIN: cfg.mainCheckout, LOG: path.join(L, 'tower-dispatch.log'),
    wt: line => P(cfg.worktreePattern, line), log: line => path.join(L, P(cfg.logPattern, line)), prompt: line => path.join(L, P(cfg.promptPattern || '{line}-prompt.md', line)),
    detachOut: line => path.join(L, P(cfg.detachOutPattern || '{line}-detach.out', line)) };
}
function dlog(c, msg) { fs.appendFileSync(c.LOG, `${tpeStamp()} ${msg}\n`); }

function msToken(m) { if (!m) return 'vx'; const v = (m.match(/\d+/g) || []); return v.length ? 'v' + v.join('').slice(0, 3) : 'vx'; }
function slugOf(title) {
  const words = (title || '').replace(/\[[^\]]*\]/g, ' ').toLowerCase().match(/[a-z][a-z0-9]{1,}/g) || [];
  const stop = new Set(['the', 'and', 'for', 'with', 'pro', 'mcp', 'ui', 'v1', 'v2']);
  return words.filter(w => !stop.has(w)).slice(0, 3).join('-').slice(0, 24).replace(/-+$/, '');
}
function nextCutoff(now = Date.now(), hour = 8) { // next <hour>:00 local time at least 6 h away
  const d = new Date(now); let t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0).getTime();
  while (t - now < 6 * 3600e3) t += 24 * 3600e3; return tpeStamp(t, false);
}
function planFor(issue, laneCode, table) {
  const lane = LANES[laneCode]; if (!lane) throw new Error('unknown lane ' + laneCode);
  const ms = msToken(issue.milestone); const slug = slugOf(issue.title);
  let line = `${lane.prefix}-${ms}-i${issue.number}${slug ? '-' + slug.split('-').slice(0, 2).join('-') : ''}`;
  const branch = `feat/${ms}-${issue.number}-${slug || 'issue'}`;
  if (!/^[a-z0-9][a-z0-9-]{3,60}$/.test(line)) throw new Error('bad line name ' + line);
  if (!/^feat\/[a-z0-9.-]+$/.test(branch)) throw new Error('bad branch name ' + branch);
  const pf = `docs/${line.replace(/^[a-z]+-/, '').toUpperCase().replace(/-/g, '_')}_PROGRESS.md`;
  return { lane: laneCode, ...lane, line, branch, pf, ms, msLabel: issue.milestone || 'backlog', cut: nextCutoff(Date.now(), table.__cutoffHour ?? 8), exists: !!table[line] };
}
async function baseRef(c) {
  for (const b of c.cfg.baseBranches || ['main']) { try { const h = (await run('git', ['-C', c.MAIN, 'rev-parse', '--verify', '--short', `origin/${b}`])).trim(); return { name: b, hash: h }; } catch {} }
  throw new Error('none of baseBranches exist on origin');
}

function render(tpl, vars, c) {
  const rf = f => fs.readFileSync(path.isAbsolute(f) ? f : path.join(c.L, f), 'utf8');
  return tpl
    .replace(/\{\{firstLine:([^}]+)\}\}/g, (_, f) => rf(f).split('\n')[0])
    .replace(/\{\{fromHeading:([^:}]+):([^}]+)\}\}/g, (_, f, h) => { const t = rf(f); const i = t.split('\n').findIndex(l => l.startsWith(h)); return i < 0 ? '' : t.split('\n').slice(i).join('\n'); })
    .replace(/\{\{include:([^}]+)\}\}/g, (_, f) => rf(f))
    .replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] != null ? String(vars[k]) : m);
}
function promptText(c, plan, issue, full, base) {
  const codex = plan.prefix === 'codex';
  const tag = `[${plan.msLabel} #${issue.number}]`;
  const comments = (full.comments || []).slice(-8).map(cm => `- **${cm.author && cm.author.login || '?'}** (${(cm.createdAt || '').slice(0, 10)}): ${(cm.body || '').trim().slice(0, 1500)}`).join('\n') || '(no comments)';
  const pushRule = codex
    ? `- Git writes go through \`.codex-git-request\` (see the Codex git section below); commit message \`${tag} … (tests: …)\`; only your branch ${plan.branch}.`
    : `- Only on your branch: \`git add\` / \`git commit\` / \`git push -u origin ${plan.branch}\` (never force), message \`${tag} … (tests: …)\`, small commits. No merge / rebase / reset --hard / stash, no PRs, no release builds, no version bumps, stay inside this issue's scope.`;
  const vars = { agent: plan.agent, msLabel: plan.msLabel, ms: plan.ms, line: plan.line, worktree: c.wt(plan.line), branch: plan.branch, base: base.name, baseHash: base.hash,
    now: tpeStamp(Date.now(), false), issueNumber: issue.number, issueTitle: issue.title, issueUrl: issue.url, issueBody: (full.body || '(empty)').trim().slice(0, 12000),
    comments, pushRule, pf: plan.pf, tag, testScript: `test:${plan.ms}:i${issue.number}`, fullTestsCmd: c.cfg.fullTestsCmd || 'npm test',
    codexPart: codex && c.cfg.codexGitPart ? fs.readFileSync(path.join(c.L, c.cfg.codexGitPart), 'utf8') : '' };
  return render(fs.readFileSync(c.cfg.promptTemplate, 'utf8'), vars, c);
}

// atomic edit of the runner: running bash processes keep reading the old inode, new runs see the new file
function addRunnerLine(c, plan, issue) {
  const txt = fs.readFileSync(c.RUNNER, 'utf8');
  if (new RegExp(`^\\s+${plan.line}\\)`, 'm').test(txt)) throw new Error('line already in case table: ' + plan.line);
  const ci = txt.indexOf('case "$A" in'); const anchor = ci < 0 ? null : (txt.slice(ci).match(/^  \*\) .*$/m) || [])[0];
  if (!anchor) throw new Error('case-table default branch `  *) …` not found in runner script');
  const entry = `  ${plan.line}) BR=${plan.branch}; START=00:00; CUT="${plan.cut}"; PF=${plan.pf};;  # #${issue.number} AI Tower ${tpeStamp(Date.now(), false)} (${issue.ref})\n`;
  let out = txt.replace(anchor, entry.replace(/\n$/, '') + '\n' + anchor);
  // tower lines (-i<number>) loop rounds until 可整合/cutoff like the v1.5 lines (added once)
  out = out.replace(/(LOOP_UNTIL=0; GAP=300; case "\$A" in )(antigravity-\*\|)(?!\*-i\[0-9\]\*\|)/, '$1*-i[0-9]*|$2');
  const stamp = tpeStamp().replace(/[- :]/g, '').slice(0, 14);
  const bak = `${c.RUNNER}.bak-tower-${stamp}`; fs.copyFileSync(c.RUNNER, bak);
  const tmp = `${c.RUNNER}.tower-tmp`; fs.writeFileSync(tmp, out, { mode: fs.statSync(c.RUNNER).mode });
  return { tmp, bak };
}

let lock = false;
async function takeoff(cfg, { ref, lane, mode, issue, table, runnersAlive }) {
  const c = ctx(cfg); const GLOBAL_CAP = cfg.globalCap || 8;
  if (lock) throw new Error('another takeoff is in progress');
  lock = true; const steps = [];
  try {
    if (!issue) throw new Error('issue not found in cache: ' + ref);
    if (issue.repo !== cfg.dispatchRepo) throw new Error('POC dispatches only ' + cfg.dispatchRepo);
    if (runnersAlive >= GLOBAL_CAP) throw new Error(`global cap ${GLOBAL_CAP} heavy runners reached (${runnersAlive})`);
    const plan = planFor(issue, lane, Object.assign(Object.create(null), table, { __cutoffHour: cfg.cutoffHour }));
    if (plan.exists) throw new Error('line exists: ' + plan.line);
    const wt = c.wt(plan.line);
    if (fs.existsSync(wt)) throw new Error('worktree path exists: ' + wt);
    for (const f of [c.prompt(plan.line), c.log(plan.line)]) if (fs.existsSync(f)) throw new Error('file exists: ' + path.basename(f));
    dlog(c, `TAKEOFF-BEGIN mode=${mode} lane=${lane} ref=${ref} line=${plan.line} branch=${plan.branch}`);
    const full = JSON.parse(await run('gh', ['issue', 'view', String(issue.number), '-R', issue.repo, '--json', 'number,title,body,comments,milestone,url'], { timeout: 30000 }));
    steps.push('issue fetched');
    await run('git', ['-C', c.MAIN, 'fetch', '-q', 'origin'], { timeout: 120000 }); steps.push('fetched origin');
    const base = await baseRef(c);
    try { await run('git', ['-C', c.MAIN, 'rev-parse', '--verify', '-q', `refs/heads/${plan.branch}`]); throw new Error('local branch exists: ' + plan.branch); } catch (e) { if (/exists/.test(e.message)) throw e; }
    const remote = (await run('git', ['-C', c.MAIN, 'ls-remote', '--heads', 'origin', plan.branch])).trim();
    if (remote) throw new Error('remote branch exists: ' + plan.branch);
    await run('git', ['-C', c.MAIN, 'worktree', 'add', '--no-track', '-b', plan.branch, wt, `origin/${base.name}`], { timeout: 120000 });
    steps.push(`worktree ${path.basename(wt)} on ${plan.branch} from origin/${base.name} ${base.hash}`);
    const nm = path.join(c.MAIN, 'node_modules'); if (fs.existsSync(nm) && !fs.existsSync(path.join(wt, 'node_modules'))) { fs.symlinkSync(nm, path.join(wt, 'node_modules')); steps.push('node_modules symlinked'); }
    const promptFile = c.prompt(plan.line);
    fs.writeFileSync(promptFile, promptText(c, plan, issue, full, base), { flag: 'wx' }); steps.push('prompt ' + path.basename(promptFile));
    const { tmp, bak } = addRunnerLine(c, plan, issue);
    try { await run('bash', ['-n', tmp]); } catch (e) { fs.unlinkSync(tmp); throw new Error('bash -n failed on edited runner (not applied): ' + e.message); }
    fs.renameSync(tmp, c.RUNNER); steps.push(`runner case table +${plan.line} (backup ${path.basename(bak)}, bash -n ok)`);
    const detachOut = c.detachOut(plan.line);
    const det = [path.join(c.L, cfg.detachScript || 'detach.py'), path.join(__dirname, '..', 'detach.py')].find(f => fs.existsSync(f));
    const prefix = cfg.launchPrefix || ['/usr/bin/nice', '-n', '10', ...(fs.existsSync('/usr/bin/caffeinate') ? ['/usr/bin/caffeinate', '-i'] : [])];
    await run('python3', [det, detachOut, ...prefix, '/bin/bash', c.RUNNER, plan.line], { cwd: c.L, timeout: 15000 });
    steps.push('launched via ' + cfg.detachScript);
    dlog(c, `TAKEOFF-OK mode=${mode} lane=${lane} ref=${ref} line=${plan.line} branch=${plan.branch} base=origin/${base.name}@${base.hash} | ${steps.join(' ; ')}`);
    return { ok: true, line: plan.line, branch: plan.branch, base: `origin/${base.name} ${base.hash}`, steps, at: Date.now() };
  } catch (e) {
    dlog(c, `TAKEOFF-FAIL mode=${mode} lane=${lane} ref=${ref} after [${steps.join(' ; ')}]: ${e.message}`);
    e.steps = steps; throw e;
  } finally { lock = false; }
}
module.exports = { LANES, planFor, takeoff, ctx, dlog, msToken };
