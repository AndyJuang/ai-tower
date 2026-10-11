'use strict';
const assert = require('assert');
const D = require('../lib/dispatch');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

check('stale line (exists, not running) → reuse', () => {
  const d = D.reuseDecision({ exists: true, runningPid: null });
  assert.equal(d.action, 'reuse');
});

check('fresh line → create', () => {
  const d = D.reuseDecision({ exists: false });
  assert.equal(d.action, 'create');
});

check('same line currently running → flying with pid', () => {
  const d = D.reuseDecision({ exists: true, runningPid: 4242 });
  assert.equal(d.action, 'flying');
  assert.equal(d.pid, 4242);
  const e = D.flyingError('codex-vx-i157-youtube', 4242);
  assert.equal(e.message, '這條已經在飛：codex-vx-i157-youtube（PID 4242）');
  assert.equal(e.flying, true);
  assert.equal(e.line, 'codex-vx-i157-youtube');
  assert.equal(e.pid, 4242);
});

check('recentTakeoff: same ref within 90s', () => {
  const now = 1e12;
  const dispatched = [{ ref: 'AndyJuang/ai-tower#157', lane: 'CX', line: 'codex-vx-i157-youtube', at: now - 13e3 }];
  assert.equal(D.recentTakeoff(dispatched, 'AndyJuang/ai-tower#157', now, 90e3), true);
  assert.equal(D.recentTakeoff(dispatched, 'AndyJuang/ai-tower#157', now, 10e3), false);
  assert.equal(D.recentTakeoff(dispatched, 'AndyJuang/ai-tower#1', now, 90e3), false);
});

check('capWarnings are Chinese and de-duplicated', () => {
  const w = D.capWarnings({ lane: 'CX', running: 2, cap: 2, holding: false, total: 8, globalCap: 8 });
  assert.deepEqual(w, [
    'CX 已達上限（2/2）— 手動起飛仍可',
    '全域上限 8/8 — 會被拒絕',
  ]);
  const w2 = D.capWarnings({ lane: 'CX', running: 2, cap: 2, holding: false, total: 8, globalCap: 8 });
  assert.equal(w2.length, 2);
  assert.equal(new Set(w2).size, 2);
});

check('uniqMsgs drops duplicate error lines', () => {
  assert.deepEqual(D.uniqMsgs(['line exists: a', 'line exists: a', 'CX 已達上限（2/2）— 手動起飛仍可']),
    ['line exists: a', 'CX 已達上限（2/2）— 手動起飛仍可']);
});

check('autoCapBlock: over lane / global / holding', () => {
  const cap = { lanes: { CX: { running: 2, cap: 2, holding: false }, GK: { running: 0, cap: 6, holding: false } }, total: 2, globalCap: 8 };
  assert.equal(D.autoCapBlock(cap, 'CX'), 'CX 已達上限（2/2）');
  const full = { lanes: { GK: { running: 1, cap: 6, holding: false } }, total: 8, globalCap: 8 };
  assert.equal(D.autoCapBlock(full, 'GK'), '全域上限 8/8 — 會被拒絕');
  const hold = { lanes: { CL: { running: 1, cap: 2, holding: true, until: Date.parse('2026-10-12T01:00:00+08:00') } }, total: 1, globalCap: 8 };
  const b = D.autoCapBlock(hold, 'CL');
  assert.ok(/CL 正在等額度/.test(b));
  const ok = { lanes: { GK: { running: 1, cap: 6, holding: false } }, total: 1, globalCap: 8 };
  assert.equal(D.autoCapBlock(ok, 'GK'), null);
});

if (failed) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
