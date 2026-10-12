'use strict';
// StarBase — read-only status files for the three DEV Grok Bot pads.
// Each file may be one object, an array, or { tasks: [...] }. Bad JSON keeps the last good read.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_AGENTS = [
  { name: '沃茲', role: '桌面 App', vehicle: 'starship' },
  { name: '克雷格', role: 'iPhone/iPad App', vehicle: 'falcon9' },
  { name: '強尼', role: '設計', vehicle: 'mcgregor' },
];
const VEHICLES = new Set(['starship', 'falcon9', 'mcgregor']);
const STATUS_ZH = { queued: '排隊', in_progress: '進行中', blocked: '卡住', done: '完成' };
const STATUS_IN = {
  '排隊': 'queued', queued: 'queued', ready: 'queued',
  '進行中': 'in_progress', in_progress: 'in_progress', running: 'in_progress',
  '卡住': 'blocked', blocked: 'blocked',
  '完成': 'done', done: 'done',
};

function resolveAgents(raw) {
  const byName = Object.fromEntries(DEFAULT_AGENTS.map(a => [a.name, a]));
  const src = Array.isArray(raw) && raw.length ? raw : DEFAULT_AGENTS;
  const out = [];
  for (const x of src) {
    const name = typeof x === 'string' ? x : (x && x.name);
    if (!name) continue;
    const d = byName[name] || {};
    const vehicle = (typeof x === 'object' && x.vehicle) || d.vehicle || 'starship';
    out.push({
      name: String(name),
      role: (typeof x === 'object' && x.role) || d.role || '',
      vehicle: VEHICLES.has(vehicle) ? vehicle : (d.vehicle || 'starship'),
    });
  }
  return out.length ? out : DEFAULT_AGENTS.slice();
}

function normalizeStatus(s) {
  if (s == null) return null;
  const raw = String(s).trim();
  if (STATUS_IN[raw]) return STATUS_IN[raw];
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return STATUS_IN[key] || null;
}

function parseTime(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function safeLink(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch { return null; }
}

function extractList(payload) {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === 'object') {
    if (Array.isArray(payload.tasks)) return payload.tasks;
    return [payload];
  }
  return [];
}

function taskId(agent, task, started) {
  return agent + '::' + task + '::' + (started || 0);
}

function normalizeTask(raw, agentName) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const task = String(raw.task || '').trim().slice(0, 240);
  if (!task) return null;
  const status = normalizeStatus(raw.status);
  if (!status) return null;
  const agent = String(raw.agent || agentName || '').trim() || agentName;
  const started_at = parseTime(raw.started_at);
  const updated_at = parseTime(raw.updated_at);
  const done_at = parseTime(raw.done_at);
  return {
    id: taskId(agent, task, started_at),
    agent, task, status, statusZh: STATUS_ZH[status],
    started_at, updated_at, done_at,
    link: safeLink(raw.link),
    note: raw.note == null || raw.note === '' ? '' : String(raw.note).slice(0, 800),
    progress: (function () {
      if (raw.progress == null || raw.progress === '') return null;
      const n = Number(raw.progress);
      return Number.isFinite(n) ? n : null;
    })(),
  };
}

function parsePayload(input, agentName) {
  const payload = typeof input === 'string' ? JSON.parse(input) : input;
  return extractList(payload).map(x => normalizeTask(x, agentName)).filter(Boolean);
}

function isHiddenDone(t, hideHours, now) {
  if (!t || t.status !== 'done') return false;
  const t0 = t.done_at || t.updated_at || t.started_at;
  if (!t0) return false;
  return (now - t0) > hideHours * 3600e3;
}

function safeAgentFile(dir, name) {
  if (!name || typeof name !== 'string') return null;
  if (name !== path.basename(name) || name.includes('..') || /[\\/]/.test(name)) return null;
  return path.join(dir, name + '.json');
}

function readAgentFile(file, agentName, cache) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { tasks: [], error: null, missing: true };
    const prev = cache && cache.get(file);
    return { tasks: prev ? prev.tasks : [], error: String(e.message || e) };
  }
  try {
    const tasks = parsePayload(txt, agentName);
    if (cache) cache.set(file, { tasks });
    return { tasks, error: null };
  } catch (e) {
    const prev = cache && cache.get(file);
    return { tasks: prev ? prev.tasks : [], error: 'bad json: ' + String(e.message || e) };
  }
}

const lastGood = new Map();

function findDesktopAgent(cfg = {}) {
  if (cfg.starbase && typeof cfg.starbase.desktopAgent === 'string') return cfg.starbase.desktopAgent;
  if (typeof cfg.starbaseDesktopAgent === 'string') return cfg.starbaseDesktopAgent;
  const agents = cfg.starbaseAgents || DEFAULT_AGENTS;
  if (Array.isArray(agents)) {
    const found = agents.find(a => typeof a === 'object' && a.role && /桌面|desktop/i.test(a.role));
    if (found && found.name) return found.name;
    const woz = agents.find(a => (typeof a === 'string' ? a : a.name) === '沃茲');
    if (woz) return typeof woz === 'string' ? woz : woz.name;
    if (agents.length) return typeof agents[0] === 'string' ? agents[0] : agents[0].name;
  }
  return '沃茲';
}

const _hashCache = new Map();
function starbaseHashes(rootDir) {
  const base = rootDir || path.join(__dirname, '..');
  function hashFile(rel) {
    try {
      const p = path.join(base, 'public', 'starbase', rel);
      if (!fs.existsSync(p)) return 'missing';
      const st = fs.statSync(p);
      const cached = _hashCache.get(rel);
      if (cached && cached.mtime === st.mtimeMs) return cached.hash;
      const c = fs.readFileSync(p);
      const hash = crypto.createHash('sha256').update(c).digest('hex').slice(0, 8);
      _hashCache.set(rel, { mtime: st.mtimeMs, hash });
      return hash;
    } catch { return '0'; }
  }
  const bridge = hashFile('bridge.js');
  const bundle = hashFile('starbase.js');
  const asset = crypto.createHash('sha256').update(bridge + ':' + bundle).digest('hex').slice(0, 8);
  return { bridge, bundle, asset };
}

function load(cfg = {}, opts = {}) {
  const now = opts.now || Date.now();
  const hideHours = Number(cfg.goodDayHideHours ?? 6);
  const hours = Number.isFinite(hideHours) && hideHours >= 0 ? hideHours : 6;
  const agents = resolveAgents(cfg.starbaseAgents);
  const dir = cfg.starbaseDir;
  const cache = opts.cache || lastGood;
  const hashes = starbaseHashes(opts.root);
  const desktopAgent = opts.desktopAgent || (opts.wozTasks && opts.wozTasks[0] && opts.wozTasks[0].agent) || findDesktopAgent(cfg);
  return {
    generatedAt: now,
    hideHours: hours,
    hash: hashes.asset,
    agents: agents.map(a => {
      const rec = { name: a.name, role: a.role, vehicle: a.vehicle, tasks: [] };
      const file = dir ? safeAgentFile(dir, a.name) : null;
      if (!file) { rec.error = 'bad agent name'; return rec; }
      const r = readAgentFile(file, a.name, cache);
      rec.tasks = (r.tasks || []).filter(t => !isHiddenDone(t, hours, now));
      if (a.name === desktopAgent && Array.isArray(opts.wozTasks) && opts.wozTasks.length) {
        const injected = opts.wozTasks.map(t => normalizeTask(t, desktopAgent)).filter(Boolean);
        const seen = new Set(injected.map(t => t.task));
        const merged = [...injected];
        for (const t of rec.tasks) {
          if (!seen.has(t.task)) {
            merged.push(t);
          }
        }
        rec.tasks = merged;
      }
      if (r.error) rec.error = r.error;
      return rec;
    }),
  };
}

module.exports = {
  DEFAULT_AGENTS, STATUS_ZH, VEHICLES,
  resolveAgents, normalizeStatus, normalizeTask, extractList, safeLink,
  parsePayload, isHiddenDone, readAgentFile, safeAgentFile, load, lastGood,
  findDesktopAgent, starbaseHashes
};
