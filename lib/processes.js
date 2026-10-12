'use strict';
// Map ps snapshot → tower runners / orphans, and count live capacity.
// Pure: no fs, no exec. Tests feed a fake process list.

const AGENT_RE = /(^|\/)(grok|claude|agy)( +-{1,2}[A-Za-z][\w-]*(?:[ =](?!-)\S+)?)*? +-p\b|(^|\/|\s)codex(\.js)? exec\b/;
const CODEX_RE = /(^|\/|\s)codex(\.js)? exec\b/;

// stand-alone grok job: `grok … --prompt-file X` / `grok … -p …` (not the bare interactive `grok`)
const GROK_JOB_RE = /(^|\/)grok( +\S+)*? +(--prompt-file|-p)\b/;

// Parse a wrapper like `bash <script> <worktree> <n> <n>…` → { wt, issues }
function parseGrokWrapper(command) {
  if (!command || !/^(?:\S*\/)?bash\s/.test(command)) return null;
  const a = command.trim().split(/\s+/).slice(1);
  if (a.length < 2) return null;
  let end = a.length; const nums = [];
  while (end > 1 && /^#?\d+$/.test(a[end - 1])) { nums.unshift(a[end - 1].replace('#', '')); end--; }
  const wt = a.slice(1, end).find(x => x.startsWith('/')) || null;
  return { script: a[0], wt, issues: nums };
}
function issuesFromName(name) {
  const out = []; const re = /(?:^|[-_])i(\d+)(?=$|[-_])/g; let m;
  while ((m = re.exec(name || ''))) out.push(m[1]);
  return out;
}
function grokJobInfo(p, byPid) {
  const parent = byPid.get(p.ppid);
  const w = parent ? parseGrokWrapper(parent.command) : null;
  const wt = (w && w.wt) || null;
  const base = wt ? wt.replace(/\/+$/, '').split('/').pop() : null;
  let issues = (w && w.issues.length) ? w.issues : issuesFromName(base);
  return { pid: p.pid, wrapperPid: w ? parent.pid : null, stat: p.stat, started: (w && parent.started) || p.started, command: p.command,
    wt, line: base, issues: issues.map(n => '#' + n) };
}

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
  const grokOrphans = procs.filter(p => GROK_JOB_RE.test(p.command) && !owned.has(p.pid) && !(byPid.get(p.ppid) && GROK_JOB_RE.test(byPid.get(p.ppid).command)))
    .map(p => grokJobInfo(p, byPid));
  return { runners, queueAlive, orphans, grokOrphans, owned };
}

const CLAUDE_RE = /(?:^|\/)claude(?:\.js|\.mjs|\.sh)?\s+(?:.*-p\b|exec\b)|(?:^|\/)claude\s+-[A-Za-z]/;
function isClaudeProc(cmd) {
  if (!cmd) return false;
  return CLAUDE_RE.test(cmd);
}

function isCodexProc(cmd) {
  return CODEX_RE.test(cmd || '');
}

function cleanTitle(t) {
  if (!t || typeof t !== 'string') return '';
  return t
    .replace(/^\s*(\[[^\]]*\]\s*)+/, '')
    .replace(/^(feat|fix|docs|chore)(\([^)]*\))?:\s*/i, '')
    .replace(/\s*\((Refs? )?#[\d#, -、]+\)\s*$/i, '')
    .trim() || t;
}

function baseOfWorktree(wt) {
  if (!wt) return null;
  return String(wt).replace(/\/+$/, '').split('/').pop() || null;
}

function extractWorktreeFromProc(p, cwds, prefix) {
  const pref = prefix || '-wt-';
  const cwd = cwds && (typeof cwds.get === 'function' ? cwds.get(p.pid) : cwds[p.pid]);
  if (cwd && cwd.includes(pref) && !cwd.includes('*')) return cwd;

  const cmd = p.command || '';
  const mCwd = cmd.match(/(?:--cwd|-C)\s+([^\s]+)/);
  if (mCwd && mCwd[1].includes(pref)) {
    const cleaned = mCwd[1].replace(/^["']|["']$/g, '');
    if (cleaned.startsWith('/') && !cleaned.includes('*')) return cleaned;
  }

  const tokens = cmd.split(/\s+/);
  for (const t of tokens) {
    const cleaned = t.replace(/^["']|["']$/g, '');
    if (cleaned.startsWith('/') && cleaned.includes(pref) && !cleaned.includes('*')) {
      return cleaned;
    }
  }

  return (cwd && !cwd.includes('*')) ? cwd : null;
}

function createWozTasks(info) {
  const { agentType, pid, started, line, wt, issues, issueCache, titles, repo, now, prefix } = info;
  const agentName = info.agent || '沃茲';
  const pref = prefix || '-wt-';

  let started_at = null;
  if (started != null) {
    const t = typeof started === 'number' ? started : Date.parse(started);
    if (Number.isFinite(t)) started_at = t;
  }
  if (!started_at) started_at = now || Date.now();

  const noteMap = {
    grok: 'Grok 實作中',
    claude: 'Claude 實作中',
    codex: 'Codex 實作中'
  };
  const note = noteMap[agentType] || `${agentType} 實作中`;

  if (issues && issues.length > 0) {
    return issues.map(raw => {
      const num = String(raw).replace(/^#/, '');
      let title = null;
      if (issueCache && issueCache[num] && issueCache[num].title) {
        title = cleanTitle(issueCache[num].title);
      }
      if (!title && titles) {
        if (titles[num]) title = cleanTitle(titles[num]);
        else if (titles['#' + num]) title = cleanTitle(titles['#' + num]);
      }
      if (!title && line && titles && titles[line]) {
        title = cleanTitle(titles[line]);
      }
      if (!title) {
        title = `Issue #${num}`;
      }
      const link = (num && repo) ? `https://github.com/${repo}/issues/${num}` : null;
      return {
        id: `${agentName}::${title}::${started_at}::${num}`,
        agent: agentName,
        task: title,
        status: 'in_progress',
        statusZh: '進行中',
        started_at,
        updated_at: started_at,
        done_at: null,
        link,
        note,
        progress: null,
        issues: [num],
        issue: num
      };
    });
  }

  // No issue numbers: fall back to line / generic
  let title = null;
  if (line && titles && titles[line]) {
    title = cleanTitle(titles[line]);
  }
  if (!title && line) {
    title = line.replace(new RegExp('^' + esc(pref)), '').replace(/-/g, ' ');
  }
  if (!title) {
    title = `${agentType.toUpperCase()} 工作`;
  }
  return [{
    id: `${agentName}::${title}::${started_at}`,
    agent: agentName,
    task: title,
    status: 'in_progress',
    statusZh: '進行中',
    started_at,
    updated_at: started_at,
    done_at: null,
    link: null,
    note,
    progress: null,
    issues: []
  }];
}

function makeWozTask(info) {
  const list = createWozTasks(info);
  return list[0] || null;
}

function detectWozJobs(procs, opts = {}) {
  const cwds = opts.cwds || null;
  const issueCache = opts.issueCache || {};
  const titles = opts.titles || {};
  const repo = opts.repo || null;
  const prefix = opts.targetPrefix || '-wt-';
  const agentName = opts.agent || '沃茲';
  const now = opts.now != null ? opts.now : Date.now();

  const mapRes = mapProcesses(procs, opts);
  const { grokOrphans, owned } = mapRes;

  const byPid = new Map((procs || []).map(p => [p.pid, p]));
  const seenKeys = new Set();
  const tasks = [];

  // 1. Manual GK jobs (bash run.sh <worktree> <issues> spawning grok)
  for (const g of grokOrphans || []) {
    // 必須有 wrapper 或是有效 worktree
    if (!g.wrapperPid && !g.wt) continue;

    const wt = g.wt || (cwds && (typeof cwds.get === 'function' ? cwds.get(g.pid) : cwds[g.pid])) || null;
    const line = g.line || (wt ? baseOfWorktree(wt) : null);
    let issues = (g.issues && g.issues.length) ? g.issues.slice() : (line ? issuesFromName(line).map(n => '#' + n) : []);

    const key = line || (wt ? wt : (issues.length ? issues[0] : 'grok-pid-' + g.pid));
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const jobTasks = createWozTasks({
      agentType: 'grok',
      pid: g.pid,
      started: g.started,
      line,
      wt,
      issues,
      issueCache,
      titles,
      repo,
      prefix,
      agent: agentName,
      now
    });
    tasks.push(...jobTasks);
  }

  // 2. Stand-alone claude and codex processes whose worktree/cwd is under targetPrefix
  for (const p of procs || []) {
    if (owned && owned.has(p.pid)) continue;

    const isCodex = isCodexProc(p.command);
    const isClaude = !isCodex && isClaudeProc(p.command);
    if (!isCodex && !isClaude) continue;

    // 避免父子進程重複
    const parent = byPid.get(p.ppid);
    if (parent) {
      if (isCodex && isCodexProc(parent.command)) continue;
      if (isClaude && isClaudeProc(parent.command)) continue;
    }

    const wt = extractWorktreeFromProc(p, cwds, prefix);
    if (!wt || !wt.includes(prefix)) continue;

    const line = baseOfWorktree(wt);
    let issues = line ? issuesFromName(line).map(n => '#' + n) : [];
    if (!issues.length) {
      const fromCmd = issuesFromName(p.command);
      if (fromCmd.length) issues = fromCmd.map(n => '#' + n);
    }

    const key = line || (issues.length ? issues[0] : `${isCodex ? 'codex' : 'claude'}-pid-${p.pid}`);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const jobTasks = createWozTasks({
      agentType: isCodex ? 'codex' : 'claude',
      pid: p.pid,
      started: p.started,
      line,
      wt,
      issues,
      issueCache,
      titles,
      repo,
      prefix,
      agent: agentName,
      now
    });
    tasks.push(...jobTasks);
  }

  return tasks;
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

module.exports = {
  AGENT_RE, GROK_JOB_RE, parseGrokWrapper, issuesFromName, mapProcesses, countCapacity, isLiveCap, lineOfCommand,
  CLAUDE_RE, isClaudeProc, isCodexProc, cleanTitle, baseOfWorktree, extractWorktreeFromProc, makeWozTask, createWozTasks, detectWozJobs
};
