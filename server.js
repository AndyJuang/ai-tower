#!/usr/bin/env node
// AI Tower — flight-strip dashboard + dispatcher for background AI coding agents.
// Reads ps / runner logs / worktrees; writes only data/*.json, the dispatch log, and (on Takeoff) worktree + prompt + runner case-table entry.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const HOST = '127.0.0.1';
const crypto = require('crypto');
const { load: loadConfig } = require('./lib/config');
const CFG = loadConfig();
const { run, readJSON, writeJSON, tpeStamp } = require('./lib/util');
const ISSUES = require('./lib/issues');
const DISPATCH = require('./lib/dispatch');
const PORT = CFG.port;
const BASE = CFG.baseDir;
const L = CFG.logsDir;
const ROOT = __dirname;
const DATA = CFG.dataDir;
const ORDER_FILE = path.join(DATA, 'queue-order.json');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const POLL_MS = 10000;
const LANDED_KEEP_MIN = CFG.landedKeepMin || 30;      // visible after landing, then client fades out
const LANDED_DROP_MIN = LANDED_KEEP_MIN + 2;      // dropped from API after this
const DIVERTED_KEEP_MIN = CFG.divertedKeepMin || 180;
const QUEUE_SCRIPTS = CFG.queueScripts || [];
const TOKEN = crypto.randomBytes(24).toString('hex'); // per server session, embedded in the served page

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// `LC_ALL=C date` output, e.g. "Sun Oct 11 21:24:16 CST 2026" — parsed as the machine's local time
const DATE_RE = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +(\d{1,2}) (\d\d):(\d\d):(\d\d)(?: [A-Z]{2,5})? (\d{4})/g;
function taipei(y, mo, d, h, mi, s) { return new Date(y, mo, d, h, mi, s).getTime(); }   // log dates are in the machine's local time zone
function datesIn(str) {
  const out = []; let m; DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(str))) out.push(taipei(+m[6], MON[m[1]], +m[2], +m[3], +m[4], +m[5]));
  return out;
}

// ---------- runner case table (line -> branch / PF / cutoff / issues) ----------
const STOP_RE = new RegExp(`^(STOP|STOPPED)\\b.*\\bby (manager|Grok|coordinator|tower|user|owner${(CFG.stopByNames || []).map(n => '|' + n.replace(/[^\w-]/g, '')).join('')})`, 'i');   // intentional stops (grey, not red)
const DONE_RE = new RegExp(CFG.doneRegex || '可整合|READY TO MERGE', 'i');   // progress-file status meaning "done"
function readLineTable() {
  const table = {};
  const f = path.join(L, CFG.runnerScript);
  let txt = ''; try { txt = fs.readFileSync(f, 'utf8'); } catch { return table; }
  const start = txt.indexOf('case "$A" in'); const end = txt.indexOf('\nesac', start);
  const block = start >= 0 ? txt.slice(start, end) : '';
  for (const raw of block.split('\n')) {
    const m = raw.match(/^\s+([a-z0-9][a-z0-9-]*)\)\s+(.*?);;(.*)$/);
    if (!m) continue;
    const body = m[2], comment = m[3] || '';
    const get = k => { const r = body.match(new RegExp('\\b' + k + '=("([^"]*)"|[^;\\s]+)')); return r ? (r[2] !== undefined ? r[2] : r[1]) : null; };
    table[m[1]] = { line: m[1], branch: get('BR'), start: get('START'), cut: get('CUT'), pf: get('PF'),
      issues: [...new Set((comment.match(/#\d{2,4}/g) || []))], note: comment.replace(/^\s*#\s*/, '').trim(), runner: CFG.runnerScript };
  }
  for (const x of CFG.extraRunners || []) {
    let br = null; try { br = (fs.readFileSync(path.join(L, x.script), 'utf8').match(/BR=([^;\s]+)/) || [])[1]; } catch {}
    table[x.line] = { line: x.line, branch: br, pf: x.pf, issues: [], note: x.project || '', runner: x.script, project: x.project, extra: x };
  }
  return table;
}
const EXTRA = Object.fromEntries((CFG.extraRunners || []).map(x => [x.line, x]));
const sub = (s, line) => s.replace(/\{line\}/g, line).replace(/\{baseDir\}/g, BASE).replace(/^~(?=\/)/, os.homedir());
function logFor(line) { return EXTRA[line] ? path.join(L, EXTRA[line].log) : path.join(L, sub(CFG.logPattern, line)); }
function worktreeFor(line) { return EXTRA[line] ? sub(EXTRA[line].worktree, line) : sub(CFG.worktreePattern, line); }
const AIRLINES = {
  grok: { key: 'grok', code: 'GK', name: 'Grok Air', agent: 'Grok CLI' },
  claude: { key: 'claude', code: 'CL', name: 'Claude Airways', agent: 'Claude Code' },
  codex: { key: 'codex', code: 'CX', name: 'Codex Airlines', agent: 'Codex CLI' },
  antigravity: { key: 'antigravity', code: 'AG', name: 'Antigravity Air', agent: 'Antigravity' },
};
function airlineOf(line) {
  if (EXTRA[line] && AIRLINES[EXTRA[line].airline]) return AIRLINES[EXTRA[line].airline];
  if (line.startsWith('codex-')) return AIRLINES.codex;
  if (line.startsWith('grok-')) return AIRLINES.grok;
  if (line.startsWith('claude-')) return AIRLINES.claude;
  if (line.startsWith('antigravity-')) return AIRLINES.antigravity;
  return { key: 'unknown', code: '??', name: 'Unknown', agent: '?' };
}
// flight number = airline code + stable sequence (tower lines: issue number; others: 100 + position in the runner case table)
function flightNo(line, table) {
  const a = airlineOf(line); if (EXTRA[line] && EXTRA[line].flight) return EXTRA[line].flight;
  const m = line.match(/-i(\d+)(?:-|$)/); if (m) return a.code + ' ' + m[1];   // tower-dispatched lines: code + issue number
  const i = Object.keys(table).indexOf(line); return a.code + ' ' + (i >= 0 ? 100 + i : 900);
}

// ---------- incremental log parsing (only lines starting with runner keywords) ----------
const EV_RE = /^(RUNNER END|RUNNER|WAIT|START|EXIT|LIMITCHECK|SLEEP|RETRY|ROUND|DONE|STOPPED|STOP|HOLD|RELEASE-JOB)\b(.*)$/;
const logCache = new Map(); // file -> {size, ino, rest, events}
function scanLog(file) {
  let st; try { st = fs.statSync(file); } catch { logCache.delete(file); return null; }
  let c = logCache.get(file);
  if (!c || c.ino !== st.ino || st.size < c.size) c = { size: 0, ino: st.ino, rest: '', events: [], mtime: 0 };
  if (st.size > c.size) {
    const fd = fs.openSync(file, 'r');
    try {
      const CH = 1 << 20; const buf = Buffer.alloc(CH); let pos = c.size;
      while (pos < st.size) {
        const n = fs.readSync(fd, buf, 0, Math.min(CH, st.size - pos), pos); if (n <= 0) break; pos += n;
        const text = c.rest + buf.toString('latin1', 0, n); // keyword lines are ASCII-prefixed; decode later
        const lines = text.split('\n'); c.rest = lines.pop();
        if (c.rest.length > 65536) c.rest = '';
        for (const ln of lines) {
          const ch = ln.charCodeAt(0); if (ch < 65 || ch > 90) continue; // must start with A-Z
          const m = ln.match(EV_RE); if (!m) continue;
          const raw = Buffer.from(ln, 'latin1').toString('utf8');
          c.events.push(parseEvent(m[1], raw));
        }
      }
      c.size = pos;
    } finally { fs.closeSync(fd); }
  }
  c.mtime = st.mtimeMs;
  logCache.set(file, c);
  return c;
}
function parseEvent(type, raw) {
  const ds = datesIn(raw); const ev = { type, raw: raw.slice(0, 300), t: ds[0] || null };
  let m;
  if ((type === 'START' || type === 'EXIT') && (m = raw.match(/attempt (\d+)/))) ev.attempt = +m[1];
  if (type === 'START') { if ((m = raw.match(/pid (\d+)/))) ev.pid = +m[1]; if ((m = raw.match(/branch (\S+)/))) ev.branch = m[1]; if ((m = raw.match(/head (\S+)/))) ev.head = m[1]; }
  if (type === 'EXIT' && (m = raw.match(/code (-?\d+)/))) ev.code = +m[1];
  if (type === 'SLEEP') { ev.t = null; ev.resumeAt = ds[0] || null; if ((m = raw.match(/SLEEP (\d+) s/))) ev.secs = +m[1]; }
  if (type === 'ROUND' && (m = raw.match(/next round in (\d+) min/)) && ds[0]) ev.nextAt = ds[0] + (+m[1]) * 60000;
  if (type === 'RETRY' && (m = raw.match(/in (\d+) s/))) ev.secs = +m[1];
  if (type === 'WAIT' && (m = raw.match(/until (\d\d:\d\d)/))) ev.until = m[1];
  if (type === 'LIMITCHECK') ev.limit = /LIMIT\b/.test(raw.replace('NOLIMIT', ''));
  return ev;
}

// ---------- processes ----------
const AGENT_RE = /(^|\/)(grok -p|claude -p|agy -p)\b|(^|\/|\s)codex(\.js)? exec\b/;
function psSnapshot() {
  return new Promise(resolve => {
    execFile('ps', ['-axwwo', 'pid=,ppid=,pgid=,stat=,etime=,lstart=,command='], { maxBuffer: 64 << 20 }, (err, out) => {
      const procs = [];
      if (!err) for (const ln of out.split('\n')) {
        const p = ln.trim().split(/\s+/); if (p.length < 11) continue;
        const [pid, ppid, pgid, stat, etime] = p; const ls = p.slice(5, 10).join(' ');
        const m = ls.match(/(\w{3}) (\w{3}) (\d+) (\d\d):(\d\d):(\d\d) (\d{4})/);
        procs.push({ pid: +pid, ppid: +ppid, pgid: +pgid, stat, etime, started: m ? taipei(+m[7], MON[m[2]], +m[3], +m[4], +m[5], +m[6]) : null, command: p.slice(10).join(' ') });
      }
      resolve(procs);
    });
  });
}
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const RUNNER_RE = new RegExp('^(?:/bin/)?bash \\S*' + esc(CFG.runnerScript) + ' (\\S+)');
function mapProcesses(procs) {
  const runners = {}; const kids = new Map(); let queueAlive = {};
  for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  for (const p of procs) {
    let m;
    if ((m = p.command.match(RUNNER_RE))) runners[m[1]] = { ...p };
    else { const x = (CFG.extraRunners || []).find(x => new RegExp('^(?:/bin/)?bash \\S*' + esc(x.script) + '(\\s|$)').test(p.command)); if (x) runners[x.line] = { ...p }; }
    for (const q of QUEUE_SCRIPTS) if (p.command.includes(q) && /bash/.test(p.command)) queueAlive[q] = p.pid;
  }
  for (const r of Object.values(runners)) {
    // walk descendants for an agent process; fallback: same pgid
    const stack = [...(kids.get(r.pid) || [])]; let agent = null;
    while (stack.length && !agent) { const k = stack.shift(); if (AGENT_RE.test(k.command)) agent = k; else stack.push(...(kids.get(k.pid) || [])); }
    if (!agent) agent = procs.find(k => k.pgid === r.pgid && k.pid !== r.pid && AGENT_RE.test(k.command)) || null;
    if (agent) r.agent = { pid: agent.pid, stat: agent.stat, started: agent.started, etime: agent.etime, cmd: agent.command.split(' ').slice(0, 2).join(' ') };
  }
  // stand-alone `codex exec` jobs not owned by a tower runner (top-most codex process only)
  const owned = new Set(); for (const r of Object.values(runners)) { const st = [r.pid]; while (st.length) { const x = st.pop(); owned.add(x); (kids.get(x) || []).forEach(k => st.push(k.pid)); } }
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const CODEX_RE = /(^|\/|\s)codex(\.js)? exec\b/;
  const orphans = procs.filter(p => CODEX_RE.test(p.command) && !owned.has(p.pid) && !(byPid.get(p.ppid) && CODEX_RE.test(byPid.get(p.ppid).command)));
  return { runners, queueAlive, orphans };
}
function cwdOf(pid) {
  return new Promise(resolve => execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 4000 }, (e, out) => {
    const m = !e && out.match(/^n(.+)$/m); resolve(m ? m[1] : null); }));
}
function gitBranch(wt) {
  return new Promise(resolve => execFile('git', ['-C', wt, 'branch', '--show-current'], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 4000 }, (e, out) => resolve(e ? null : out.trim() || null)));
}

// ---------- progress + git (read-only) ----------
const gitCache = new Map();
function gitLast(wt) {
  return new Promise(resolve => {
    execFile('git', ['-C', wt, 'log', '-1', '--format=%h%x09%ct%x09%s'], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 5000 }, (err, out) => {
      if (err || !out) return resolve(null);
      const [h, ct, ...s] = out.trim().split('\t'); resolve({ hash: h, time: +ct * 1000, subject: s.join('\t') });
    });
  });
}
function readProgress(line, info) {
  const wt = worktreeFor(line); let file = info && info.pf ? path.join(wt, info.pf) : null;
  if (!file) {
    try {
      const all = fs.readdirSync(path.join(wt, 'docs')).filter(f => /PROGRESS.*\.md$/i.test(f));
      const tok = line.replace(/^[a-z]+-/, '').toUpperCase().replace(/-/g, '_'); // claude-v108-fixes -> V108_FIXES
      const [ver, ...rest] = tok.split('_'); const restU = rest.join('_');
      let c = all.filter(f => f.toUpperCase().replace(/-/g, '_').includes(tok));
      if (c.length !== 1 && restU) c = all.filter(f => { const u = f.toUpperCase().replace(/-/g, '_'); return u.startsWith(ver + '_') && u.includes(restU); });
      if (c.length !== 1) c = all.filter(f => /^V1.*PROGRESS.*\.md$/.test(f)).length === 1 ? all.filter(f => /^V1.*PROGRESS.*\.md$/.test(f)) : [];
      if (c.length === 1) file = path.join(wt, 'docs', c[0]);
    } catch {}
  }
  if (!file) return { file: null };
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return { file: path.relative(BASE, file), missing: true }; }
  const lines = txt.split('\n'); const head = lines.slice(0, 12).join('\n');
  const st = lines.find(l => /(狀態|^\W*Status)\s*[：:]/i.test(l)) || lines.find(l => l.includes('狀態') && !/^\s*[#|]/.test(l)) || '';
  return { file: path.relative(BASE, file), status: st.replace(/[*#>`-]/g, '').trim().slice(0, 80),
    done: DONE_RE.test(head) && !/進行中|用量上限暫停|in progress/i.test(head) };
}

// ---------- queue files ----------
function readQueues(queueAlive) {
  const out = [];
  for (const q of QUEUE_SCRIPTS) {
    let sh; try { sh = fs.readFileSync(path.join(L, q), 'utf8'); } catch { continue; }
    const m = sh.match(/^QUEUE=\(([^)]*)\)/m); if (!m) continue;
    const items = m[1].trim().split(/\s+/).filter(Boolean);
    const logf = path.join(L, q.replace(/\.sh$/, '.log'));
    let log = ''; try { log = fs.readFileSync(logf, 'utf8'); } catch {}
    const lines = log.split('\n'); let lastStart = -1, queuedAt = null, pidInLog = null;
    lines.forEach((l, i) => { const r = l.match(/^(\S+ \S+) queue pid (\d+)/); if (r) { lastStart = i; queuedAt = r[1]; pidInLog = +r[2]; } });
    const handled = new Set(); const everLaunched = new Set();
    lines.forEach((l, i) => { const r = l.match(/ (?:launch|skip) (\S+)/) || l.match(/ (\S+) finished/); if (r) { everLaunched.add(r[1]); if (i > lastStart) handled.add(r[1]); } });
    const qt = queuedAt ? (() => { const [d, t] = queuedAt.split(' '); const [y, mo, da] = d.split('-').map(Number); const [h, mi, s] = t.split(':').map(Number); return taipei(y, mo - 1, da, h, mi, s); })() : null;
    out.push({ script: q, alive: !!queueAlive[q], pid: queueAlive[q] || pidInLog, queuedAt: qt,
      items: items.map((raw, idx) => ({ raw, line: raw.replace(/^re:/, ''), relaunch: raw.startsWith('re:'), idx, handled: handled.has(raw.replace(/^re:/, '')) })), everLaunched });
  }
  return out;
}

// ---------- friendly titles: titles.json mapping, then GitHub issue title via gh (cached 6 h) ----------
const REPO = CFG.dispatchRepo;
const TITLES_FILE = CFG.titlesFile || path.join(DATA, 'titles.json');
const ISSUE_CACHE_FILE = path.join(DATA, 'issue-cache.json');
const GH = 'gh';
let issueCache = {}; try { issueCache = JSON.parse(fs.readFileSync(ISSUE_CACHE_FILE, 'utf8')); } catch {}
let titlesCache = { at: 0, v: {} };
function readTitles() { const n = Date.now(); if (n - titlesCache.at > 10000) { try { titlesCache = { at: n, v: JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8')) }; } catch { titlesCache = { at: n, v: {} }; } } return titlesCache.v; }
function cleanTitle(t) { return t.replace(/^\s*(\[[^\]]*\]\s*)+/, '').replace(/^(feat|fix|docs|chore)(\([^)]*\))?:\s*/i, '').replace(/\s*\((Refs? )?#[\d#, -、]+\)\s*$/i, '').trim() || t; }
const issueQueue = new Set(); let issueBusy = false;
function wantIssue(n) { const c = issueCache[n]; if (!c || Date.now() - c.at > 6 * 3600e3) issueQueue.add(n); pumpIssues(); }
function pumpIssues() {
  if (issueBusy || !issueQueue.size) return; const n = issueQueue.values().next().value; issueQueue.delete(n); issueBusy = true;
  execFile(GH, ['api', `repos/${REPO}/issues/${n}`, '--jq', '{title: .title, state: .state, pr: (.pull_request != null)}'], { timeout: 15000 }, (err, out) => {
    try { if (!err) { const j = JSON.parse(out); issueCache[n] = { ...j, at: Date.now() }; fs.writeFileSync(ISSUE_CACHE_FILE, JSON.stringify(issueCache, null, 1)); }
      else issueCache[n] = { ...(issueCache[n] || {}), at: Date.now() - 5 * 3600e3 }; } catch {}
    issueBusy = false; setTimeout(pumpIssues, 300);
  });
}

// ---------- strip assembly ----------
function fmtHM(t) { if (!t) return null; const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
async function buildSnapshot() {
  const now = Date.now();
  const table = readLineTable();
  const procs = await psSnapshot();
  const { runners, queueAlive, orphans } = mapProcesses(procs);
  const queues = readQueues(queueAlive);
  const queued = new Map(); const launchedByQueue = new Set();
  for (const q of queues) { q.everLaunched.forEach(x => launchedByQueue.add(x)); if (!q.alive) continue;
    for (const it of q.items) if (!it.handled && !queued.has(it.line)) queued.set(it.line, { ...it, script: q.script, queuedAt: q.queuedAt }); }

  const lines = new Set([...Object.keys(runners), ...queued.keys()]);
  for (const k of Object.keys(table)) { try { if (now - fs.statSync(logFor(k)).mtimeMs < Math.max(DIVERTED_KEEP_MIN, LANDED_DROP_MIN) * 60e3 + 3600e3) lines.add(k); } catch {} }

  const strips = [];
  for (const line of lines) {
    const info = table[line] || { line, issues: [] };
    const air = airlineOf(line);
    const runner = runners[line] || null;
    const log = scanLog(logFor(line));
    const evs = log ? log.events : [];
    let i0 = -1; evs.forEach((e, i) => { if (e.type === 'RUNNER') i0 = i; });
    const run = i0 >= 0 ? evs.slice(i0) : evs;
    const starts = run.filter(e => e.type === 'START');
    const lastStart = starts[starts.length - 1];
    const sig = run.filter(e => !['HOLD', 'RELEASE-JOB'].includes(e.type));
    const last = sig[sig.length - 1] || null;
    const progress = readProgress(line, info);
    let q = queued.get(line);
    if (q && q.relaunch && progress.done) q = null; // queue scripts skip re-launch lines that are already done
    const s = { id: line, callsign: line, flight: flightNo(line, table), airline: air, project: info.project || CFG.projectName || (REPO || '').split('/').pop() || '',
      branch: (lastStart && lastStart.branch) || info.branch, issues: info.issues, cutoff: info.cut, progress,
      std: starts[0] ? starts[0].t : null, attempt: lastStart ? lastStart.attempt : 0, head: lastStart ? lastStart.head : null,
      runnerPid: runner ? runner.pid : null, agentPid: runner && runner.agent ? runner.agent.pid : null,
      lastEvent: last ? last.raw : null, tags: [], logFile: log ? path.relative(BASE, logFor(line)) : null };
    if (runner && (/T/.test(runner.stat) || (runner.agent && /T/.test(runner.agent.stat)))) s.tags.push('暫停');
    if (runner && QUEUE_SCRIPTS.length && !launchedByQueue.has(line) && !EXTRA[line] && !/-i\d+/.test(line)) s.tags.push('插入');

    if (runner) {
      if (runner.agent) { s.status = 'TAKEOFF'; s.bay = 'takeoff'; s.since = lastStart && lastStart.t || runner.agent.started; }
      else if (last && last.type === 'SLEEP') { s.status = 'HOLDING'; s.bay = 'ready'; s.resumeAt = last.resumeAt; s.quota = 'waiting for quota until ' + fmtHM(last.resumeAt); s.since = s.std; }
      else if (last && last.type === 'WAIT' || (!last && runner)) { s.status = 'SCHEDULED'; s.bay = 'park'; s.etd = last && last.until; }
      else { s.status = 'TAXI'; s.bay = 'ready'; s.since = s.std;
        if (last && last.type === 'ROUND') s.nextAt = last.nextAt;
        else if (last && last.type === 'RETRY' && last.secs) s.nextAt = (sig.length && (evs.filter(e => e.t).pop() || {}).t || now) + last.secs * 1000; }
    } else if (q) {
      s.status = 'SCHEDULED'; s.bay = 'park'; s.queuePos = q.idx; s.queueScript = q.script; s.queuedAt = q.queuedAt;
      if (q.relaunch) s.tags.push('重飛'); s.std = null; s.attempt = 0;
    } else {
      if (!log) continue;
      const term = [...sig].reverse().find(e => ['DONE', 'STOP', 'STOPPED', 'RUNNER END'].includes(e.type));
      s.endedAt = (term && term.t) || log.mtime;
      const okByLog = term && (DONE_RE.test(term.raw) || /^DONE agent finished normally/.test(term.raw) || term.type === 'RUNNER END');
      const intentional = term && STOP_RE.test(term.raw);
      s.status = progress.done || okByLog ? 'LANDED' : intentional ? 'STOPPED' : 'DIVERTED'; s.bay = 'goodday';
      s.reason = term ? term.raw.replace(/ (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \w{3} .*?\d{4}/, '').slice(0, 140) : 'runner process gone without DONE/STOP line';
      const age = (now - s.endedAt) / 60e3;
      if (s.status === 'LANDED' && age > LANDED_DROP_MIN) continue;
      if ((s.status === 'DIVERTED' || s.status === 'STOPPED') && age > DIVERTED_KEEP_MIN) continue;
      s.fade = s.status === 'LANDED' && age > LANDED_KEEP_MIN;
      if (s.std) s.flightMin = Math.round((s.endedAt - s.std) / 60e3);
    }
    strips.push(s);
  }
  for (const o of orphans) {
    const cm = o.command.match(/\s(?:-C|--cd)\s+(\S+)/);
    const wt = (cm && cm[1]) || await cwdOf(o.pid);
    strips.push({ id: 'codex-pid' + o.pid, callsign: 'codex exec ' + o.pid, flight: 'CX ' + String(o.pid).slice(-3), airline: airlineOf('codex-'), project: wt ? path.basename(wt) : '?',
      wt, branch: wt ? await gitBranch(wt) : null, issues: [], progress: {}, std: o.started, since: o.started, attempt: 1,
      runnerPid: null, agentPid: o.pid, lastEvent: 'stand-alone codex exec (no tower runner)', tags: ['手動'], status: 'TAKEOFF', bay: 'takeoff',
      titleHint: wt ? path.basename(wt) : 'Codex job' });
  }
  await Promise.all(strips.map(async s => {
    const wt = s.wt || worktreeFor(s.id); const c = gitCache.get(wt);
    if (c && now - c.at < 30000) { s.lastCommit = c.v; return; }
    const v = await gitLast(wt); gitCache.set(wt, { at: now, v }); s.lastCommit = v;
  }));
  for (const s of strips) {
    const t = readTitles();
    s.issueMeta = (s.issues || []).map(n => { const k = n.slice(1); const m = issueCache[k]; return { n: k, url: `https://github.com/${REPO}/issues/${k}`, title: m ? m.title : null, pr: m ? m.pr : null }; });
    const fromIssue = s.issueMeta.map(m => m.title).find(Boolean);
    s.title = t[s.branch] || t[s.id] || (fromIssue ? cleanTitle(fromIssue) : s.titleHint || s.id.replace(/^[a-z]+-/, '').replace(/-/g, ' '));
    s.issues.forEach(n => wantIssue(n.slice(1)));
  }
  // agent quota board (from the runners' own LIMITCHECK/SLEEP lines)
  const quota = {}; for (const [k, a] of Object.entries(AIRLINES)) quota[k] = { airline: a.name, agent: a.agent, code: a.code, flying: 0, holding: 0, until: null };
  for (const s of strips) {
    const k = s.airline.key; quota[k] = quota[k] || { airline: s.airline.name, agent: s.airline.agent, code: s.airline.code, flying: 0, holding: 0, until: null };
    if (s.status === 'TAKEOFF') quota[k].flying++;
    if (s.status === 'HOLDING') { quota[k].holding++; if (s.resumeAt > now) quota[k].until = Math.max(quota[k].until || 0, s.resumeAt); }
  }
  for (const [k, v] of Object.entries(quota)) { v.untilHM = fmtHM(v.until);
    v.state = v.until ? 'quota until ' + v.untilHM : v.flying ? 'flying' : (k === 'codex' ? ((CFG.lanes || {}).CX || {}).idleLabel || 'manual only' : 'idle'); }
  return { generatedAt: now, tzOffsetMin: -new Date(now).getTimezoneOffset(), tzLabel: CFG.tzLabel || '', pollMs: POLL_MS, queues: queues.map(q => ({ script: q.script, alive: q.alive, pid: q.pid })), quota, strips };
}

// ---------- v3: lanes, park, settings, auto pilot ----------
const LANE_CODES = ['GK', 'CL', 'CX', 'AG'];
const KEY2CODE = { grok: 'GK', claude: 'CL', codex: 'CX', antigravity: 'AG' };
function laneCfg(code) { const base = DISPATCH.LANES[code]; const c = (CFG.lanes || {})[code] || {}; return { ...base, cap: c.cap ?? base.cap, manualOnly: !!c.manualOnly || code === 'CX', autoDefault: c.auto ?? base.autoDefault, idleLabel: c.idleLabel || 'idle' }; }
function readLanes() {
  const o = readJSON(ORDER_FILE, {}); const lanes = {};
  for (const k of LANE_CODES) lanes[k] = Array.isArray(o.lanes && o.lanes[k]) ? o.lanes[k].filter(x => typeof x === 'string') : [];
  return lanes;
}
function writeLanes(lanes) { writeJSON(ORDER_FILE, { lanes, updatedAt: new Date().toISOString(), note: 'AI Tower READY TO FLY lanes (issue refs owner/repo#N). Auto pilot / Takeoff read this file.' }); }
function readSettings() {
  const s = readJSON(SETTINGS_FILE, {}); const auto = {};
  for (const k of LANE_CODES) { const lc = laneCfg(k); auto[k] = lc.manualOnly ? false : (s.auto && typeof s.auto[k] === 'boolean' ? s.auto[k] : lc.autoDefault); }
  return { mode: s.mode === 'AUTO' ? 'AUTO' : 'MANUAL', auto };
}
function writeSettings(v) { writeJSON(SETTINGS_FILE, { ...v, updatedAt: new Date().toISOString() }); }
const dispatched = readJSON(path.join(DATA, 'dispatched.json'), []); // [{ref, lane, line, branch, at, mode}]
function saveDispatched() { writeJSON(path.join(DATA, 'dispatched.json'), dispatched.slice(-500)); }
let lastAutoAt = 0; let autoNote = null; let lastTable = {};

function capacity(strips) {
  const now = Date.now(); const out = {}; let total = 0;
  for (const k of LANE_CODES) out[k] = { running: 0, cap: laneCfg(k).cap, holding: false, until: null };
  for (const s of strips) {
    const k = KEY2CODE[s.airline.key]; if (!k) continue;
    if (s.runnerPid || s.agentPid) { out[k].running++; total++; }
    if (s.status === 'HOLDING' && s.resumeAt > now) { out[k].holding = true; out[k].until = Math.max(out[k].until || 0, s.resumeAt); }
  }
  // just-dispatched lines not yet visible in ps count too (avoid double launch)
  for (const d of dispatched) if (now - d.at < 90e3 && !strips.some(s => s.id === d.line)) { out[d.lane].running++; total++; }
  return { lanes: out, total, globalCap: CFG.globalCap || 8 };
}
function laneView(lanes, cap) {
  const v = {};
  for (const k of LANE_CODES) v[k] = lanes[k].map(ref => { const i = ISSUES.getIssue(ref); const [repo, n] = ref.split('#');
    return { ref, repo, number: +n, title: i ? i.title : null, url: i ? i.url : `https://github.com/${repo}/issues/${n}`, milestone: i ? i.milestone : null, labels: i ? i.labels : [], flight: `${k} ${n}`, dispatchable: repo === REPO }; });
  return v;
}
function autoPick(snap, lanes, settings) {
  const cap = snap.capacity;
  for (const k of LANE_CODES) {
    if (laneCfg(k).manualOnly || !settings.auto[k]) continue;
    const ref = lanes[k].find(r => r.split('#')[0] === REPO); if (!ref) continue;
    const c = cap.lanes[k];
    const blocked = c.holding ? `${k} holding for quota until ${tpeStamp(c.until).slice(11, 16)}` : c.running >= c.cap ? `${k} at capacity ${c.running}/${c.cap}` : cap.total >= cap.globalCap ? `global cap ${cap.total}/${cap.globalCap}` : null;
    return { lane: k, ref, flight: `${k} ${ref.split('#')[1]}`, blocked, eta: blocked ? null : Math.max(Date.now() + POLL_MS, lastAutoAt + 90e3) };
  }
  return null;
}
async function doTakeoff(ref, lane, mode) {
  if (!LANE_CODES.includes(lane)) throw new Error('bad lane');
  if (mode === 'auto' && laneCfg(lane).manualOnly) throw new Error(lane + ' is manual-only');
  const issue = ISSUES.getIssue(ref);
  const cap = snapshot.capacity || capacity(snapshot.strips || []);
  const r = await DISPATCH.takeoff(CFG, { ref, lane, mode, issue, table: lastTable, runnersAlive: cap.total });
  dispatched.push({ ref, lane, line: r.line, branch: r.branch, at: r.at, mode }); saveDispatched();
  const lanes = readLanes(); lanes[lane] = lanes[lane].filter(x => x !== ref); writeLanes(lanes);
  setTimeout(refresh, 3000);
  return r;
}
function excludeSets(table) {
  const ex = {}; const add = (repo, n) => { (ex[repo] = ex[repo] || new Set()).add(n); };
  for (const t of Object.values(table)) for (const i of t.issues || []) add(REPO, +i.slice(1));
  for (const d of dispatched) { const [repo, n] = d.ref.split('#'); add(repo, +n); }
  return ex;
}

let snapshot = { generatedAt: 0, strips: [] }; let building = null;
async function refresh() {
  if (building) return building;
  building = (async () => {
    if (CFG.demo) { snapshot = demoSnapshot(); return; }
    const snap = await buildSnapshot();
    lastTable = readLineTable();
    ISSUES.refreshIssues().catch(() => {});
    const lanes = readLanes(); const settings = readSettings();
    snap.capacity = capacity(snap.strips);
    const queued = new Set(Object.values(lanes).flat());
    snap.park = ISSUES.park(excludeSets(lastTable), queued);
    snap.lanes = laneView(lanes, snap.capacity);
    snap.settings = settings;
    snap.laneCfg = Object.fromEntries(LANE_CODES.map(k => { const c = laneCfg(k); return [k, { cap: c.cap, manualOnly: c.manualOnly, idleLabel: c.idleLabel, airline: c.airline, agent: c.agent }]; }));
    snap.dispatchRepo = REPO;
    const pick = autoPick(snap, lanes, settings);
    snap.autopilot = { mode: settings.mode, next: pick, note: autoNote };
    snapshot = snap;
    if (settings.mode === 'AUTO' && pick && !pick.blocked && Date.now() - lastAutoAt > 90e3) {
      lastAutoAt = Date.now();
      doTakeoff(pick.ref, pick.lane, 'auto').then(r => { autoNote = `auto takeoff ${pick.flight} → ${r.line} ${tpeStamp().slice(11, 16)}`; })
        .catch(e => { autoNote = `auto takeoff ${pick.flight} failed: ${e.message.slice(0, 160)}`; });
    }
  })().catch(e => { snapshot.error = String(e && e.stack || e); }).finally(() => { building = null; });
  return building;
}
// ---------- demo mode (synthetic data for screenshots / trying the UI) ----------
let demoState = null;
function demoSnapshot() {
  if (!demoState) demoState = require('./lib/demo').make();
  return require('./lib/demo').snapshot(demoState);
}
refresh(); setInterval(refresh, POLL_MS);
if (!CFG.demo) ISSUES.refreshIssues(true).catch(() => {});

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
function send(res, code, body, type) { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(body); }
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
function guard(req) { // mutating endpoints: session token + same-origin + loopback host (blocks CSRF / DNS rebinding)
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return 'bad host';
  if (!ALLOWED_ORIGINS.has(req.headers.origin || '')) return 'bad origin';
  const t = req.headers['x-tower-token'] || '';
  if (t.length !== TOKEN.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN))) return 'bad token';
  if (!/^application\/json/.test(req.headers['content-type'] || '')) return 'bad content-type';
  return null;
}
function body(req) { return new Promise((resolve, reject) => { let b = ''; req.on('data', d => { b += d; if (b.length > 2e5) { reject(new Error('too large')); req.destroy(); } }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } }); }); }
const REF_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d{1,6}$/;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return send(res, 421, JSON.stringify({ error: 'bad host' }));
  try {
    if (req.method === 'GET' && url.pathname === '/api/strips') { if (!snapshot.generatedAt) await refresh(); return send(res, 200, JSON.stringify(snapshot)); }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const bad = guard(req); if (bad) return send(res, 403, JSON.stringify({ error: bad }));
      const j = await body(req);
      if (CFG.demo) { const r = require('./lib/demo').mutate(demoState, url.pathname, j); return send(res, 200, JSON.stringify(r)); }
      if (url.pathname === '/api/lanes') {
        const lanes = readLanes();
        for (const k of LANE_CODES) if (Array.isArray(j.lanes && j.lanes[k])) lanes[k] = [...new Set(j.lanes[k].filter(x => typeof x === 'string' && REF_RE.test(x)))].slice(0, 100);
        writeLanes(lanes); refresh(); return send(res, 200, JSON.stringify({ lanes }));
      }
      if (url.pathname === '/api/settings') {
        const cur = readSettings();
        if (j.mode === 'AUTO' || j.mode === 'MANUAL') cur.mode = j.mode;
        for (const k of LANE_CODES) if (j.auto && typeof j.auto[k] === 'boolean' && !laneCfg(k).manualOnly) cur.auto[k] = j.auto[k];
        writeSettings(cur); DISPATCH.dlog(DISPATCH.ctx(CFG), `SETTINGS mode=${cur.mode} auto=${JSON.stringify(cur.auto)}`); refresh();
        return send(res, 200, JSON.stringify(cur));
      }
      if (url.pathname === '/api/preview') {
        if (!REF_RE.test(j.ref || '') || !LANE_CODES.includes(j.lane)) return send(res, 400, JSON.stringify({ error: 'bad ref/lane' }));
        const issue = ISSUES.getIssue(j.ref); if (!issue) return send(res, 404, JSON.stringify({ error: 'issue not in cache' }));
        const plan = DISPATCH.planFor(issue, j.lane, lastTable); const cap = snapshot.capacity;
        const warn = [];
        if (issue.repo !== REPO) warn.push('POC: only ' + REPO + ' can be dispatched');
        if (cap) { const c = cap.lanes[j.lane]; if (c.running >= c.cap) warn.push(`${j.lane} over its cap (${c.running}/${c.cap}) — manual takeoff still allowed`); if (c.holding) warn.push(`${j.lane} is holding for quota`); if (cap.total >= cap.globalCap) warn.push(`global cap reached ${cap.total}/${cap.globalCap} — takeoff will be refused`); }
        return send(res, 200, JSON.stringify({ ref: j.ref, lane: j.lane, agent: plan.agent, airline: plan.airline, line: plan.line, branch: plan.branch, pf: plan.pf, base: (CFG.baseBranches || ['main'])[0], issue: { number: issue.number, title: issue.title, milestone: issue.milestone }, warn }));
      }
      if (url.pathname === '/api/takeoff') {
        if (!REF_RE.test(j.ref || '') || !LANE_CODES.includes(j.lane)) return send(res, 400, JSON.stringify({ error: 'bad ref/lane' }));
        try { const r = await doTakeoff(j.ref, j.lane, 'manual'); return send(res, 200, JSON.stringify(r)); }
        catch (e) { return send(res, 409, JSON.stringify({ error: e.message, steps: e.steps || [] })); }
      }
      return send(res, 404, JSON.stringify({ error: 'not found' }));
    }
  } catch (e) { return send(res, 500, JSON.stringify({ error: String(e.message || e) })); }
  if (req.method !== 'GET') return send(res, 405, '{}');
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const f = path.normalize(path.join(ROOT, 'public', p));
  if (!f.startsWith(path.join(ROOT, 'public') + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(f, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    if (f.endsWith('index.html')) data = Buffer.from(data.toString('utf8').replace('__TOWER_TOKEN__', TOKEN).replace('__TOWER_DEMO__', CFG.demo ? '1' : ''));
    send(res, 200, data, MIME[path.extname(f)] || 'application/octet-stream');
  });
});
server.listen(PORT, HOST, () => console.log(`[tower] ${new Date().toISOString()} listening http://${HOST}:${PORT} config=${path.basename(CFG._file)}${CFG.demo ? ' DEMO' : ''}`));
