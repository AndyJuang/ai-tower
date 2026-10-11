'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sb = require('../lib/starbase');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

check('parse single object', () => {
  const t = sb.parsePayload({ agent: '沃茲', task: 'StarBase 模式開發', status: '進行中', started_at: '2026-10-12T00:13:54+08:00', link: 'https://github.com/AndyJuang/ai-tower', note: 'Grok CLI' }, '沃茲');
  assert.equal(t.length, 1);
  assert.equal(t[0].task, 'StarBase 模式開發');
  assert.equal(t[0].status, 'in_progress');
  assert.equal(t[0].statusZh, '進行中');
  assert.equal(t[0].agent, '沃茲');
  assert.ok(t[0].started_at > 0);
  assert.equal(t[0].link, 'https://github.com/AndyJuang/ai-tower');
});

check('parse array', () => {
  const t = sb.parsePayload([
    { task: 'A', status: '排隊' },
    { task: 'B', status: '完成' },
    { task: '', status: '排隊' },
  ], '克雷格');
  assert.equal(t.length, 2);
  assert.equal(t[0].status, 'queued');
  assert.equal(t[1].status, 'done');
});

check('parse {tasks}', () => {
  const t = sb.parsePayload({ tasks: [{ task: 'C', status: '卡住', note: '等確認' }] }, '強尼');
  assert.equal(t.length, 1);
  assert.equal(t[0].status, 'blocked');
  assert.equal(t[0].note, '等確認');
});

check('english status mapping', () => {
  assert.equal(sb.normalizeStatus('queued'), 'queued');
  assert.equal(sb.normalizeStatus('ready'), 'queued');
  assert.equal(sb.normalizeStatus('in_progress'), 'in_progress');
  assert.equal(sb.normalizeStatus('in-progress'), 'in_progress');
  assert.equal(sb.normalizeStatus('running'), 'in_progress');
  assert.equal(sb.normalizeStatus('blocked'), 'blocked');
  assert.equal(sb.normalizeStatus('done'), 'done');
  assert.equal(sb.normalizeStatus('排隊'), 'queued');
  assert.equal(sb.normalizeStatus('進行中'), 'in_progress');
  assert.equal(sb.normalizeStatus('卡住'), 'blocked');
  assert.equal(sb.normalizeStatus('完成'), 'done');
  assert.equal(sb.normalizeStatus('nope'), null);
  const t = sb.parsePayload({ task: 'X', status: 'running' }, '沃茲');
  assert.equal(t[0].status, 'in_progress');
});

check('non-http links dropped', () => {
  const drop = [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,hi',
    '/relative/path',
    'github.com/no-scheme',
    '',
  ];
  for (const link of drop) {
    const t = sb.normalizeTask({ task: 'L', status: '排隊', link }, '沃茲');
    assert.equal(t.link, null, 'should drop ' + link);
  }
  const ok = sb.normalizeTask({ task: 'L', status: 'queued', link: 'http://127.0.0.1:9/x' }, '沃茲');
  assert.equal(ok.link, 'http://127.0.0.1:9/x');
  const ok2 = sb.normalizeTask({ task: 'L', status: 'queued', link: 'https://example.com/pr/1' }, '沃茲');
  assert.equal(ok2.link, 'https://example.com/pr/1');
});

check('hideHours filters old done tasks', () => {
  const now = Date.parse('2026-01-02T12:00:00Z');
  const old = { status: 'done', done_at: now - 7 * 3600e3, task: 'old' };
  const fresh = { status: 'done', done_at: now - 1 * 3600e3, task: 'fresh' };
  const live = { status: 'in_progress', started_at: now - 10 * 60e3, task: 'live' };
  const noTime = { status: 'done', task: 'undated' };
  assert.equal(sb.isHiddenDone(old, 6, now), true);
  assert.equal(sb.isHiddenDone(fresh, 6, now), false);
  assert.equal(sb.isHiddenDone(live, 6, now), false);
  assert.equal(sb.isHiddenDone(noTime, 6, now), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-hide-'));
  fs.writeFileSync(path.join(dir, '沃茲.json'), JSON.stringify([
    { task: 'old', status: '完成', done_at: new Date(now - 7 * 3600e3).toISOString() },
    { task: 'fresh', status: 'done', done_at: new Date(now - 1 * 3600e3).toISOString() },
    { task: 'live', status: '進行中', started_at: new Date(now - 10 * 60e3).toISOString() },
  ]));
  const snap = sb.load({ starbaseDir: dir, starbaseAgents: ['沃茲'], goodDayHideHours: 6 }, { now, cache: new Map() });
  const names = snap.agents[0].tasks.map(t => t.task).sort();
  assert.deepEqual(names, ['fresh', 'live']);
  assert.equal(snap.hideHours, 6);
});

check('bad JSON keeps last good read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bad-'));
  const f = path.join(dir, '沃茲.json');
  const cache = new Map();
  fs.writeFileSync(f, JSON.stringify({ task: 'A', status: '進行中', started_at: '2026-01-01T00:00:00Z' }));
  let r = sb.readAgentFile(f, '沃茲', cache);
  assert.equal(r.error, null);
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].task, 'A');
  fs.writeFileSync(f, '{ "task": "half-written"');
  r = sb.readAgentFile(f, '沃茲', cache);
  assert.ok(r.error && /bad json/i.test(r.error));
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].task, 'A');
});

check('missing file is empty, not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-miss-'));
  const f = path.join(dir, '強尼.json');
  const r = sb.readAgentFile(f, '強尼', new Map());
  assert.equal(r.tasks.length, 0);
  assert.equal(r.error, null);
  assert.equal(r.missing, true);
});

check('load order 沃茲 → 克雷格 → 強尼 and default vehicles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ord-'));
  fs.writeFileSync(path.join(dir, '克雷格.json'), JSON.stringify({ task: 'iOS', status: 'queued' }));
  const snap = sb.load({ starbaseDir: dir, goodDayHideHours: 6 }, { now: Date.now(), cache: new Map() });
  assert.deepEqual(snap.agents.map(a => a.name), ['沃茲', '克雷格', '強尼']);
  assert.equal(snap.agents[0].vehicle, 'starship');
  assert.equal(snap.agents[1].vehicle, 'falcon9');
  assert.equal(snap.agents[2].vehicle, 'mcgregor');
  assert.equal(snap.agents[1].tasks[0].task, 'iOS');
  assert.equal(snap.agents[0].tasks.length, 0);
});

check('resolveAgents accepts name strings', () => {
  const a = sb.resolveAgents(['沃茲', '克雷格', '強尼']);
  assert.equal(a[0].vehicle, 'starship');
  assert.equal(a[2].role, '設計');
});

if (failed) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
