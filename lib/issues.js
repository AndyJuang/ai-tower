'use strict';
// PARK source: open GitHub issues (gh issue list), cached 5 min per repo; PR refs used to exclude in-flight work.
const { run } = require('./util');
const CFG = require('./config').load();
const { productOf } = require('./products');
const REPOS = (process.env.TOWER_ISSUE_REPOS ? process.env.TOWER_ISSUE_REPOS.split(',') : CFG.issueRepos || []).filter(Boolean);
const TTL = 5 * 60e3;
// issues that need a human on a real device (background agents have no GUI): matched against every label, and against the start of the title
const MANUAL_SRC = CFG.manualIssueRegex || 'manual|實機';
const MANUAL_LABEL_RE = new RegExp(MANUAL_SRC, 'i');
const MANUAL_TITLE_RE = new RegExp('^[\\s\\[【(（]*(?:' + MANUAL_SRC + ')', 'i');
function isManual(title, labels) { return (labels || []).some(l => MANUAL_LABEL_RE.test(l)) || MANUAL_TITLE_RE.test(title || ''); }
const cache = {}; // repo -> {at, issues, prRefs:Set, error}
let busy = false;
function refsIn(text, closingOnly) {
  const out = new Set(); if (!text) return out;
  const re = closingOnly ? /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi : /#(\d+)/g; let m;
  while ((m = re.exec(text))) out.add(+m[1]); return out;
}
async function fetchRepo(repo) {
  const c = cache[repo] = cache[repo] || { at: 0, issues: [], prRefs: new Set() };
  try {
    const iss = JSON.parse(await run('gh', ['issue', 'list', '-R', repo, '--state', 'open', '--limit', '400', '--json', 'number,title,milestone,labels,url,updatedAt'], { timeout: 30000 }));
    const prs = JSON.parse(await run('gh', ['pr', 'list', '-R', repo, '--state', 'all', '--limit', '300', '--json', 'number,title,body,state,headRefName'], { timeout: 30000 }));
    const refs = new Set();
    for (const p of prs) { if (p.state !== 'OPEN' && p.state !== 'MERGED') continue; refsIn(p.title).forEach(n => refs.add(n)); refsIn(p.body, true).forEach(n => refs.add(n)); }
    c.issues = iss.map(i => ({ ref: `${repo}#${i.number}`, repo, number: i.number, title: i.title, url: i.url, milestone: i.milestone ? i.milestone.title : null, labels: (i.labels || []).map(l => l.name).slice(0, 4), manual: isManual(i.title, (i.labels || []).map(l => l.name)), product: productOf(repo), updatedAt: i.updatedAt }));
    c.prRefs = refs; c.at = Date.now(); c.error = null;
  } catch (e) { c.error = String(e.message || e).slice(0, 300); c.at = Date.now() - TTL + 60e3; }
}
async function refreshIssues(force) {
  if (busy) return; busy = true;
  try { for (const r of REPOS) if (force || !cache[r] || Date.now() - cache[r].at > TTL) await fetchRepo(r); } finally { busy = false; }
}
function msKey(m) { if (!m) return [9, 9, 9]; const v = (m.match(/\d+/g) || []).map(Number); return [v[0] ?? 9, v[1] ?? 0, v[2] ?? 0]; }
function cmpIssue(a, b) { const x = msKey(a.milestone), y = msKey(b.milestone); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return a.repo.localeCompare(b.repo) || a.number - b.number; }
function isManualRef(ref) { const i = getIssue(ref); return !!(i && i.manual); }
function getIssue(ref) { const [repo] = ref.split('#'); const c = cache[repo]; return c ? c.issues.find(i => i.ref === ref) || null : null; }
function park(excludeByRepo, queuedRefs) {
  const list = [], manual = [], errors = {}, fetchedAt = {};
  for (const r of REPOS) {
    const c = cache[r]; if (!c) continue; fetchedAt[r] = c.at; if (c.error) errors[r] = c.error;
    const ex = excludeByRepo[r] || new Set();
    for (const i of c.issues) {
      const why = ex.has(i.number) ? 'line' : c.prRefs.has(i.number) ? 'pr' : null;
      if (why) continue;
      if (i.manual) { manual.push(i); continue; }   // never queued, never dispatched
      if (queuedRefs.has(i.ref)) continue;
      list.push(i);
    }
  }
  list.sort(cmpIssue); manual.sort(cmpIssue);
  return { issues: list, manual, manualRegex: MANUAL_SRC, manualTitle: CFG.manualSectionTitle || '需要實機 · 手動測試', repos: REPOS, errors, fetchedAt };
}
module.exports = { refreshIssues, park, getIssue, isManual, isManualRef, REPOS, refsIn };
