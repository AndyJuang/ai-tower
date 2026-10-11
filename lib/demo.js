'use strict';
// Synthetic data for demo mode (screenshots, trying the UI). Nothing here touches real processes or files.
const LANES = ['GK', 'CL', 'CX', 'AG'];
const AIR = {
  grok: { key: 'grok', code: 'GK', name: 'Grok Air', agent: 'Grok CLI' },
  claude: { key: 'claude', code: 'CL', name: 'Claude Airways', agent: 'Claude Code' },
  codex: { key: 'codex', code: 'CX', name: 'Codex Airlines', agent: 'Codex CLI' },
  antigravity: { key: 'antigravity', code: 'AG', name: 'Antigravity Air', agent: 'Antigravity' },
};
const REPO = 'demo-org/demo-app';
const ISSUE_TITLES = [
  [201, 'v1.5', '字幕自動斷行與安全框'], [202, 'v1.5', 'Export presets for vertical video'], [203, 'v1.5', '快捷鍵設定頁'], [204, 'v1.5', 'Dark theme contrast pass'],
  [205, 'v1.5', '匯出進度通知'], [206, 'v1.5', 'Recent projects list'], [207, 'v2.0', 'Plugin API draft'], [208, 'v2.0', '多語系介面（日文）'],
  [209, null, 'Crash report opt-in dialog wording'], [210, null, '說明文件連結更新'], [211, 'v1.5', 'Audio ducking under narration'], [212, 'v2.0', 'Cloud sync prototype'],
];
function make() {
  const now = Date.now(), m = 60e3;
  const issue = ([n, ms, t]) => ({ ref: `${REPO}#${n}`, repo: REPO, number: n, title: t, url: `https://github.com/${REPO}/issues/${n}`, milestone: ms, labels: n % 3 ? ['enhancement'] : ['bug'] });
  const strip = (id, air, title, status, extra) => ({ id, callsign: id, flight: `${AIR[air].code} ${extra.n}`, airline: AIR[air], title, project: 'demo-app', branch: `feat/demo-${extra.n}`,
    issues: ['#' + extra.n], issueMeta: [{ n: String(extra.n), url: `https://github.com/${REPO}/issues/${extra.n}`, title }], tags: [], progress: { status: extra.ps || '狀態：進行中' },
    attempt: extra.attempt || 1, runnerPid: extra.runner ? 40000 + extra.n : null, agentPid: status === 'TAKEOFF' ? 41000 + extra.n : null,
    lastCommit: { hash: 'a1b2c3' + (extra.n % 10), time: now - (extra.c || 7) * m, subject: `[demo #${extra.n}] work in progress (tests: 42 PASS)` }, status, ...extra.s });
  const strips = [
    strip('grok-v15-i180-timeline', 'grok', '時間軸吸附與磁性對齊', 'TAKEOFF', { n: 180, runner: 1, s: { bay: 'takeoff', std: now - 47 * m, since: now - 47 * m } }),
    strip('grok-v15-i181-captions', 'grok', 'Caption styles library', 'TAKEOFF', { n: 181, runner: 1, attempt: 2, s: { bay: 'takeoff', std: now - 95 * m, since: now - 12 * m } }),
    strip('grok-v15-i182-audio', 'grok', '錄音電平表與削峰警示', 'TAKEOFF', { n: 182, runner: 1, s: { bay: 'takeoff', std: now - 21 * m, since: now - 21 * m } }),
    strip('claude-v15-i183-settings', 'claude', 'Settings search', 'HOLDING', { n: 183, runner: 1, s: { bay: 'ready', readyAt: now - 6 * m, std: now - 80 * m, resumeAt: now + 26 * m } }),
    strip('grok-v15-i184-export', 'grok', '匯出佇列與失敗重試', 'TAXI', { n: 184, runner: 1, s: { bay: 'ready', std: now - 60 * m, nextAt: now + 3 * m, readyAt: now - 2 * m } }),
    strip('grok-v15-i170-themes', 'grok', '主題 token 全面整理', 'LANDED', { n: 170, ps: '狀態：可整合', s: { bay: 'goodday', std: now - 140 * m, endedAt: now - 9 * m, flightMin: 131, reason: 'DONE progress file says 可整合 and branch pushed' } }),
    strip('antigravity-v15-i171-onboard', 'antigravity', 'Onboarding checklist', 'STOPPED', { n: 171, s: { bay: 'goodday', std: now - 70 * m, endedAt: now - 15 * m, flightMin: 55, reason: 'STOP by manager (agent paused)' } }),
    strip('codex-v15-i172-ffmpeg', 'codex', 'FFmpeg probe hardening', 'DIVERTED', { n: 172, s: { bay: 'goodday', std: now - 50 * m, endedAt: now - 4 * m, flightMin: 46, reason: 'runner process gone without DONE/STOP line' } }),
  ];
  const all = ISSUE_TITLES.map(issue);
  return { now, strips, issues: all, lanes: { GK: [`${REPO}#201`, `${REPO}#204`], CL: [`${REPO}#206`], CX: [`${REPO}#209`], AG: [] }, settings: { mode: 'AUTO', auto: { GK: true, CL: false, CX: false, AG: false } }, n: 0 };
}
function snapshot(st) {
  const queued = new Set(Object.values(st.lanes).flat());
  const byRef = Object.fromEntries(st.issues.map(i => [i.ref, i]));
  const capLanes = {}; for (const k of LANES) capLanes[k] = { running: 0, cap: k === 'GK' ? 6 : 2, holding: false, until: null };
  let total = 0; for (const s of st.strips) { const k = s.airline.code; if (s.runnerPid) { capLanes[k].running++; total++; } if (s.status === 'HOLDING') { capLanes[k].holding = true; capLanes[k].until = s.resumeAt; } }
  st.queuedAt = st.queuedAt || {}; const t0 = Date.now();
  const lanes = {}; for (const k of LANES) { const c = capLanes[k]; let free = Math.max(0, Math.min(c.cap - c.running, 8 - total)), slot = 0;
    const manual = st.settings.mode !== 'AUTO' || !st.settings.auto[k] || k === 'CX';
    lanes[k] = st.lanes[k].map((ref, i) => { st.queuedAt[ref] = st.queuedAt[ref] || t0 - (12 + i * 7) * 60e3; let etd = null, etdState;
      if (manual) etdState = 'manual'; else if (c.holding) { etd = c.until; etdState = 'quota'; } else if (slot < free) { etd = t0 + 10e3 + slot++ * 90e3; etdState = 'auto'; } else etdState = 'full';
      return { ...byRef[ref], flight: `${k} ${ref.split('#')[1]}`, dispatchable: true, queuedAt: st.queuedAt[ref], etd, etdState }; }); }
  const models = demoModels(st);
  return {
    models,
    generatedAt: Date.now(), tzOffsetMin: -new Date().getTimezoneOffset(), tzLabel: 'LOCAL', demo: true, pollMs: 10000, queues: [], strips: st.strips,
    quota: {}, park: { issues: st.issues.filter(i => !queued.has(i.ref) && !st.strips.some(s => s.issues.includes('#' + i.number))), repos: [REPO, 'demo-org/demo-docs'], errors: {}, fetchedAt: {} },
    lanes, settings: st.settings, dispatchRepo: REPO, capacity: { lanes: capLanes, total, globalCap: 8 },
    laneCfg: { GK: { cap: 6, airline: 'Grok Air', agent: 'Grok CLI' }, CL: { cap: 2, airline: 'Claude Airways', agent: 'Claude Code' }, CX: { cap: 2, airline: 'Codex Airlines', agent: 'Codex CLI' }, AG: { cap: 2, airline: 'Antigravity Air', agent: 'Antigravity' } },
    autopilot: { mode: st.settings.mode, next: st.lanes.GK[0] ? { lane: 'GK', ref: st.lanes.GK[0], flight: 'GK ' + st.lanes.GK[0].split('#')[1], eta: Date.now() + 10000, blocked: null } : null, note: 'demo mode — takeoffs are simulated' },
  };
}
function demoModels(st) {
  st.models = st.models || { GK: { model: null, effort: null }, CL: { model: null, effort: null }, CX: { model: null, effort: 'high' }, AG: { model: null, effort: null } };
  st.overrides = st.overrides || {};
  const cat = { GK: { models: ['agent-model-a', 'agent-model-a-fast'], efforts: ['low', 'high'] }, CL: { models: ['model-large', 'model-medium'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    CX: { models: ['coder-1', 'coder-1-mini'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, AG: { models: ['agent-pro-high', 'agent-flash-medium'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] } };
  const def = { GK: { model: 'agent-model-a' }, CL: { model: 'model-medium', effort: 'high' }, CX: { model: 'coder-1', effort: 'medium' }, AG: { model: 'agent-pro-high', effort: 'high' } };
  const lanes = {}; for (const k of LANES) { const set = st.models[k];
    lanes[k] = { set, runnerDefault: def[k], effective: { model: set.model || def[k].model || null, effort: set.effort || def[k].effort || null, source: set.model || set.effort ? 'tower' : 'runner' }, catalog: { models: cat[k].models, efforts: cat[k].efforts, note: '' } }; }
  return { lanes, overrides: st.overrides, hook: true, catalogReady: true };
}
function mutate(st, p, j) {
  if (p === '/api/models') { if (j.lane) st.models[j.lane] = { model: j.model || null, effort: j.effort || null }; else if (j.line) st.overrides[j.line] = { model: j.model || null, effort: j.effort || null }; return { ok: true, demo: true, lane: j.lane, line: j.line }; }
  if (p === '/api/lanes') { for (const k of LANES) if (Array.isArray(j.lanes && j.lanes[k])) st.lanes[k] = j.lanes[k]; return { lanes: st.lanes }; }
  if (p === '/api/settings') { if (j.mode) st.settings.mode = j.mode; if (j.auto) for (const k of LANES) if (k !== 'CX' && typeof j.auto[k] === 'boolean') st.settings.auto[k] = j.auto[k]; return st.settings; }
  const i = st.issues.find(x => x.ref === j.ref); const air = { GK: 'grok', CL: 'claude', CX: 'codex', AG: 'antigravity' }[j.lane];
  if (p === '/api/preview') return { ref: j.ref, lane: j.lane, agent: AIR[air].agent, airline: AIR[air].name, line: `${air}-demo-i${i.number}`, branch: `feat/demo-${i.number}`, base: 'main', issue: i, warn: ['demo mode — nothing is launched'] };
  if (p === '/api/takeoff') {
    st.lanes[j.lane] = st.lanes[j.lane].filter(x => x !== j.ref);
    st.strips.push({ id: `${air}-demo-i${i.number}`, callsign: `${air}-demo-i${i.number}`, flight: `${j.lane} ${i.number}`, airline: AIR[air], title: i.title, project: 'demo-app', branch: `feat/demo-${i.number}`, issues: ['#' + i.number], issueMeta: [{ n: String(i.number), url: i.url, title: i.title }], tags: [], progress: {}, attempt: 1, runnerPid: 1, agentPid: 2, status: 'TAKEOFF', bay: 'takeoff', std: Date.now(), since: Date.now() });
    return { ok: true, line: `${air}-demo-i${i.number}`, branch: `feat/demo-${i.number}`, steps: ['simulated'] };
  }
  return { error: 'unknown' };
}
module.exports = { make, snapshot, mutate };
