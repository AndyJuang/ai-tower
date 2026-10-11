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

function uniqMsgs(arr) {
  const out = []; const seen = new Set();
  for (const x of arr || []) { const s = String(x); if (seen.has(s)) continue; seen.add(s); out.push(s); }
  return out;
}
function reuseDecision({ exists, runningPid }) {
  if (!exists) return { action: 'create' };
  if (runningPid) return { action: 'flying', pid: runningPid };
  return { action: 'reuse' };
}
function flyingError(line, pid) {
  const e = new Error(`這條已經在飛：${line}（PID ${pid}）`);
  e.flying = true; e.line = line; e.pid = pid;
  return e;
}
function recentTakeoff(dispatched, ref, now, windowMs) {
  const n = now != null ? now : Date.now(); const w = windowMs != null ? windowMs : 90e3;
  return (dispatched || []).some(d => d.ref === ref && n - d.at < w);
}
function capWarnings({ lane, running, cap, holding, total, globalCap }) {
  const warn = [];
  if (running >= cap) warn.push(`${lane} 已達上限（${running}/${cap}）— 手動起飛仍可`);
  if (holding) warn.push(`${lane} 正在等額度恢復`);
  if (total >= globalCap) warn.push(`全域上限 ${total}/${globalCap} — 會被拒絕`);
  return uniqMsgs(warn);
}
function autoCapBlock(cap, lane) {
  if (!cap || !cap.lanes || !cap.lanes[lane]) return null;
  const c = cap.lanes[lane];
  if (c.holding) {
    const hm = c.until ? tpeStamp(c.until, false).slice(11, 16) : '';
    return hm ? `${lane} 正在等額度恢復（至 ${hm}）` : `${lane} 正在等額度恢復`;
  }
  if (c.running >= c.cap) return `${lane} 已達上限（${c.running}/${c.cap}）`;
  if (cap.total >= cap.globalCap) return `全域上限 ${cap.total}/${cap.globalCap} — 會被拒絕`;
  return null;
}

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
function planFor(issue, laneCode, table, prodShort) {   // prodShort: product code for non-primary repos (keeps line names unique across repos)
  const lane = LANES[laneCode]; if (!lane) throw new Error('unknown lane ' + laneCode);
  const ms = msToken(issue.milestone); const slug = slugOf(issue.title);
  let line = `${lane.prefix}-${prodShort ? prodShort.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' : ''}${ms}-i${issue.number}${slug ? '-' + slug.split('-').slice(0, 2).join('-') : ''}`;
  const branch = `feat/${ms}-${issue.number}-${slug || 'issue'}`;
  if (!/^[a-z0-9][a-z0-9-]{3,60}$/.test(line)) throw new Error('bad line name ' + line);
  if (!/^feat\/[a-z0-9.-]+$/.test(branch)) throw new Error('bad branch name ' + branch);
  const pf = `docs/${line.replace(/^[a-z]+-/, '').toUpperCase().replace(/-/g, '_')}_PROGRESS.md`;
  return { lane: laneCode, ...lane, line, branch, pf, ms, msLabel: issue.milestone || 'backlog', cut: nextCutoff(Date.now(), table.__cutoffHour ?? 8), exists: !!table[line] };
}
async function baseRef(c, branches) {
  if (!branches) {   // other repos: their origin default branch
    try { const m = (await run('git', ['-C', c.MAIN, 'ls-remote', '--symref', 'origin', 'HEAD'], { timeout: 30000 })).match(/ref: refs\/heads\/(\S+)\s+HEAD/); branches = m ? [m[1], 'main', 'master'] : ['main', 'master']; } catch { branches = ['main', 'master']; }
  }
  for (const b of branches) { try { const h = (await run('git', ['-C', c.MAIN, 'rev-parse', '--verify', '--short', `origin/${b}`])).trim(); return { name: b, hash: h }; } catch {} }
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
  const vars = { agent: plan.agent, msLabel: plan.msLabel, ms: plan.ms, line: plan.line, worktree: plan.wt || c.wt(plan.line), repo: issue.repo, product: plan.productName || '', branch: plan.branch, base: base.name, baseHash: base.hash,
    now: tpeStamp(Date.now(), false), issueNumber: issue.number, issueTitle: issue.title, issueUrl: issue.url, issueBody: (full.body || '(empty)').trim().slice(0, 12000),
    comments, pushRule, pf: plan.pf, tag, testScript: `test:${plan.ms}:i${issue.number}`, fullTestsCmd: plan.fullTestsCmd || c.cfg.fullTestsCmd || 'npm test',
    codexPart: codex && c.cfg.codexGitPart ? fs.readFileSync(path.join(c.L, c.cfg.codexGitPart), 'utf8') : '' };
  return render(fs.readFileSync(plan.promptTemplate || c.cfg.promptTemplate, 'utf8'), vars, c);
}

// atomic edit of the runner: running bash processes keep reading the old inode, new runs see the new file
function addRunnerLine(c, plan, issue) {
  const txt = fs.readFileSync(c.RUNNER, 'utf8');
  if (new RegExp(`^\\s+${plan.line}\\)`, 'm').test(txt)) throw new Error('line already in case table: ' + plan.line);
  const ci = txt.indexOf('case "$A" in'); const anchor = ci < 0 ? null : (txt.slice(ci).match(/^  \*\) .*$/m) || [])[0];
  if (!anchor) throw new Error('case-table default branch `  *) …` not found in runner script');
  const entry = `  ${plan.line}) BR=${plan.branch}; START=00:00; CUT="${plan.cut}"; PF=${plan.pf};${plan.wtx ? ` WTX="${plan.wtx}";` : ''};  # #${issue.number} AI Tower ${tpeStamp(Date.now(), false)} (${issue.ref})\n`;
  let out = txt.replace(anchor, entry.replace(/\n$/, '') + '\n' + anchor);
  // tower lines (-i<number>) loop rounds until 可整合/cutoff like the v1.5 lines (added once)
  out = out.replace(/(LOOP_UNTIL=0; GAP=300; case "\$A" in )(antigravity-\*\|)(?!\*-i\[0-9\]\*\|)/, '$1*-i[0-9]*|$2');
  if (plan.wtx) out = ensureWtxHook(out, c.cfg.worktreeVar || 'WT');
  const stamp = tpeStamp().replace(/[- :]/g, '').slice(0, 14);
  const bak = `${c.RUNNER}.bak-tower-${stamp}`; fs.copyFileSync(c.RUNNER, bak);
  const tmp = `${c.RUNNER}.tower-tmp`; fs.writeFileSync(tmp, out, { mode: fs.statSync(c.RUNNER).mode });
  return { tmp, bak };
}

// other-repo lines set WTX="<worktree>" in their case entry; the runner must then use it as its worktree variable.
// Added once: `WTX=` before the case table, and `[ -n "$WTX" ] && <var>="$WTX"` after both the table and the <var>= assignment.
const WTX_MARK = '# AI Tower: other-repo worktree (WTX)';
function ensureWtxHook(txt, v) {
  if (txt.includes(WTX_MARK)) return txt;
  const lines = txt.split('\n'); const ci = lines.findIndex(l => /^case "\$A" in/.test(l)); if (ci < 0) throw new Error('case table not found for WTX hook');
  let ei = ci + 1; while (ei < lines.length && !/^esac\b/.test(lines[ei])) ei++; if (ei >= lines.length) throw new Error('case table end not found');
  const vi = lines.findIndex(l => new RegExp('^' + v + '="').test(l)); if (vi < 0) throw new Error(`worktree variable ${v}= not found in runner (set config worktreeVar)`);
  const at = Math.max(ei, vi) + 1;
  lines.splice(at, 0, `if [ -n "\${WTX:-}" ]; then ${v}="$WTX"; fi   ${WTX_MARK}`);
  lines.splice(ci, 0, `WTX=   ${WTX_MARK}`);
  return lines.join('\n');
}

let lock = false;
async function takeoff(cfg, { ref, lane, mode, issue, table, runnersAlive, clone, product, liveRunners }) {
  const c = ctx(cfg); const GLOBAL_CAP = cfg.globalCap || 8;
  if (lock) throw new Error('另一班正在起飛，請稍候');
  lock = true; const steps = [];
  try {
    if (!issue) throw new Error('issue not found in cache: ' + ref);
    const primary = issue.repo === cfg.dispatchRepo; const rc = (cfg.repos && cfg.repos[issue.repo]) || {};
    if (!clone) throw new Error('browse-only: no local clone of ' + issue.repo);
    c.MAIN = clone;
    if (runnersAlive >= GLOBAL_CAP) throw new Error(`全域上限 ${runnersAlive}/${GLOBAL_CAP} — 會被拒絕`);
    const plan = planFor(issue, lane, Object.assign(Object.create(null), table, { __cutoffHour: cfg.cutoffHour }), primary ? null : product && product.short);
    if (!primary) { plan.wt = plan.wtx = path.join(path.dirname(clone), `${path.basename(clone)}-wt-${plan.line}`); plan.productName = product && product.name;
      plan.promptTemplate = rc.promptTemplate || cfg.promptTemplateOther || null; plan.fullTestsCmd = rc.fullTestsCmd || "the project's own test command (see its README / package.json)"; }
    const live = (liveRunners && liveRunners[plan.line]) || null;
    const decision = reuseDecision({ exists: plan.exists, runningPid: live && live.pid });
    if (decision.action === 'flying') throw flyingError(plan.line, decision.pid);
    const reuse = decision.action === 'reuse';
    if (reuse) {
      const old = table[plan.line] || {};
      if (old.branch) plan.branch = old.branch;
      if (old.wtx) { plan.wt = plan.wtx = old.wtx; }
    }
    const wt = plan.wt || c.wt(plan.line);
    if (reuse) {
      if (!fs.existsSync(wt)) throw new Error('既有 line 的 worktree 不在了：' + wt);
    } else {
      if (fs.existsSync(wt)) throw new Error('worktree path exists: ' + wt);
      for (const f of [c.prompt(plan.line), c.log(plan.line)]) if (fs.existsSync(f)) throw new Error('file exists: ' + path.basename(f));
    }
    dlog(c, `${reuse ? 'TAKEOFF-REUSE' : 'TAKEOFF-BEGIN'} mode=${mode} lane=${lane} ref=${ref} line=${plan.line} branch=${plan.branch}`);
    let base = { name: 'main', hash: '' };
    if (!reuse) {
      const full = JSON.parse(await run('gh', ['issue', 'view', String(issue.number), '-R', issue.repo, '--json', 'number,title,body,comments,milestone,url'], { timeout: 30000 }));
      steps.push('issue fetched');
      await run('git', ['-C', c.MAIN, 'fetch', '-q', 'origin'], { timeout: 120000 }); steps.push('fetched origin');
      base = await baseRef(c, primary ? (cfg.baseBranches || ['main']) : rc.baseBranches);
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
    } else {
      steps.push('reused existing worktree/branch/case');
      try { base.hash = (await run('git', ['-C', wt, 'rev-parse', '--short', 'HEAD'])).trim(); base.name = plan.branch; } catch {}
    }
    const detachOut = c.detachOut(plan.line);
    const det = [path.join(c.L, cfg.detachScript || 'detach.py'), path.join(__dirname, '..', 'detach.py')].find(f => fs.existsSync(f));
    const prefix = cfg.launchPrefix || ['/usr/bin/nice', '-n', '10', ...(fs.existsSync('/usr/bin/caffeinate') ? ['/usr/bin/caffeinate', '-i'] : [])];
    await run('python3', [det, detachOut, ...prefix, '/bin/bash', c.RUNNER, plan.line], { cwd: c.L, timeout: 15000 });
    steps.push('launched via ' + cfg.detachScript);
    dlog(c, `TAKEOFF-OK mode=${mode} lane=${lane} ref=${ref} line=${plan.line} branch=${plan.branch} reuse=${reuse ? 1 : 0} base=${base.name}@${base.hash} | ${steps.join(' ; ')}`);
    return { ok: true, line: plan.line, branch: plan.branch, base: `${base.name} ${base.hash}`.trim(), steps, at: Date.now(), reuse };
  } catch (e) {
    dlog(c, `TAKEOFF-FAIL mode=${mode} lane=${lane} ref=${ref} after [${steps.join(' ; ')}]: ${e.message}`);
    e.steps = steps; throw e;
  } finally { lock = false; }
}
module.exports = { LANES, planFor, takeoff, ctx, dlog, msToken, ensureWtxHook, reuseDecision, flyingError, recentTakeoff, capWarnings, autoCapBlock, uniqMsgs };
