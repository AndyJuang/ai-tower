'use strict';
const assert = require('assert');
const { createBridgeQueue } = require('../public/starbase/bridge');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

check('bridge queue: initial URL mode=hold default', () => {
  const q = createBridgeQueue({ mode: 'hold', hold: 90 });
  assert.equal(q.getMode(), 'hold');
  assert.equal(q.isReady(), false);
  const act = q.onReady();
  assert.equal(q.isReady(), true);
  assert.deepEqual(act, { action: 'hold', frame: 90 });
  assert.equal(q.getMode(), 'hold');
});

check('bridge queue: initial URL mode=once and mode=loop', () => {
  const qOnce = createBridgeQueue({ mode: 'once', hold: 12 });
  assert.deepEqual(qOnce.onReady(), { action: 'play', once: true, from: 12 });

  const qLoop = createBridgeQueue({ mode: 'loop', hold: 0 });
  assert.deepEqual(qLoop.onReady(), { action: 'play', once: false });
});

check('bridge queue: early play command before ready (WebKit trace fix)', () => {
  const q = createBridgeQueue({ mode: 'hold', hold: 90 });
  // Parent sends play while player is not ready
  const queued = q.receive({ cmd: 'play', once: false });
  assert.equal(queued.type, 'queued');
  assert.equal(q.isReady(), false);

  // ready() runs: should apply early play instead of URL hold
  const act = q.onReady();
  assert.deepEqual(act, { action: 'play', once: false, from: undefined });
  assert.equal(q.getMode(), 'loop');
  assert.equal(q.getEarlyCmd(), null);
});

check('bridge queue: early play once with from frame before ready', () => {
  const q = createBridgeQueue({ mode: 'hold', hold: 90 });
  q.receive({ cmd: 'play', once: true, from: 15 });
  const act = q.onReady();
  assert.deepEqual(act, { action: 'play', once: true, from: 15 });
  assert.equal(q.getMode(), 'once');
});

check('bridge queue: early play followed by resume before ready', () => {
  const q = createBridgeQueue({ mode: 'hold', hold: 90 });
  q.receive({ cmd: 'play', once: false });
  q.receive({ cmd: 'resume' });
  const act = q.onReady();
  assert.deepEqual(act, { action: 'play', once: false, from: undefined });
  assert.equal(q.getMode(), 'loop');
});

check('bridge queue: early play, ready, then resume arrives (WebKit trace scenario)', () => {
  const q = createBridgeQueue({ mode: 'hold', hold: 90 });
  // 538 ms: play arrives
  q.receive({ cmd: 'play', once: false });
  // 753 ms: ready() runs
  const readyAct = q.onReady();
  assert.deepEqual(readyAct, { action: 'play', once: false, from: undefined });
  assert.equal(q.getMode(), 'loop');

  // 795 ms: resume arrives
  const resumeAct = q.receive({ cmd: 'resume' });
  assert.deepEqual(resumeAct, { action: 'resume', mode: 'loop' });
});

check('bridge queue: resume after play recovers playback even if mode was hold', () => {
  const q = createBridgeQueue({ mode: 'hold', hold: 90 });
  // Play was received
  q.receive({ cmd: 'play', once: false });
  q.onReady();
  // Simulate mode somehow being hold (e.g. legacy override)
  q.setMode('hold');

  // Resume after play must treat as playing
  const act = q.receive({ cmd: 'resume' });
  assert.deepEqual(act, { action: 'play', once: false, from: undefined });
  assert.equal(q.getMode(), 'loop');
});

check('bridge queue: early pause overrides early play', () => {
  const q = createBridgeQueue({ mode: 'hold', hold: 90 });
  q.receive({ cmd: 'play', once: false });
  q.receive({ cmd: 'pause' });
  const act = q.onReady();
  assert.deepEqual(act, { action: 'pause' });
});

check('bridge queue: early seek overrides early play', () => {
  const q = createBridgeQueue({ mode: 'hold', hold: 90 });
  q.receive({ cmd: 'play', once: false });
  q.receive({ cmd: 'seek', frame: 45 });
  const act = q.onReady();
  assert.deepEqual(act, { action: 'seek', frame: 45 });
});

check('bridge queue: lifecycle commands after ready (play -> pause -> resume -> seek)', () => {
  const q = createBridgeQueue({ mode: 'hold', hold: 0 });
  q.onReady();

  const p1 = q.receive({ cmd: 'play', once: false });
  assert.deepEqual(p1, { action: 'play', once: false, from: undefined });
  assert.equal(q.getMode(), 'loop');

  const p2 = q.receive({ cmd: 'pause' });
  assert.deepEqual(p2, { action: 'pause' });

  const p3 = q.receive({ cmd: 'resume' });
  assert.deepEqual(p3, { action: 'resume', mode: 'loop' });

  const p4 = q.receive({ cmd: 'seek', frame: 120 });
  assert.deepEqual(p4, { action: 'seek', frame: 120 });
});

check('bridge queue: ignore resume if never played and mode is hold', () => {
  const q = createBridgeQueue({ mode: 'hold', hold: 10 });
  q.onReady();
  const act = q.receive({ cmd: 'resume' });
  assert.deepEqual(act, { action: 'ignore' });
});

check('bridge queue: ignore invalid or empty messages', () => {
  const q = createBridgeQueue({ mode: 'hold' });
  assert.equal(q.receive(null), null);
  assert.equal(q.receive({}), null);
  assert.equal(q.receive({ cmd: 'unknown' }), null);
});

if (failed) {
  console.error(failed + ' tests failed');
  process.exit(1);
}
