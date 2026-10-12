'use strict';
const S = require('../public/starbase-state');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.message || e)); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg ? msg + ' — ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

const T0 = Date.parse('2026-10-12T12:00:00+08:00');
function task(id, status, extra) {
  extra = extra || {};
  return {
    id: id,
    task: extra.task || id,
    status: status,
    statusZh: { queued: '排隊', in_progress: '進行中', blocked: '卡住', done: '完成' }[status],
    started_at: extra.started != null ? extra.started : T0 - 10 * 60e3,
    updated_at: extra.updated != null ? extra.updated : T0 - 60e3,
    done_at: extra.done != null ? extra.done : null,
    progress: extra.progress,
    link: extra.link || null,
    note: extra.note || '',
  };
}
function step(prev, tasks, extra) {
  extra = extra || {};
  return S.next({ prev: prev, tasks: tasks, now: extra.now != null ? extra.now : T0, reduced: !!extra.reduced, event: extra.event || 'tick', frame: extra.frame });
}

check('idle empty → stack hold frame 12', () => {
  const s = step(null, []);
  eq(s.scene, 'stack'); eq(s.mode, 'hold'); eq(s.frame, 12); eq(s.phase, 'idle'); eq(s.grayscale, false);
});

check('queued only is idle', () => {
  const s = step(null, [task('q1', 'queued')]);
  eq(s.scene, 'stack'); eq(s.mode, 'hold'); eq(s.frame, 12); eq(s.phase, 'idle');
});

check('page load already in_progress → fuel intro=0 loop', () => {
  const s = step(null, [task('a', 'in_progress', { started: T0 - 47 * 60e3 })]);
  eq(s.scene, 'fuel'); eq(s.mode, 'loop'); eq(s.intro, 0); eq(s.frame, 90); eq(s.phase, 'fuel_loop');
});

check('new in_progress started_at within 90s → stack once', () => {
  const s = step(null, [task('a', 'in_progress', { started: T0 - 30e3 })]);
  eq(s.scene, 'stack'); eq(s.mode, 'once'); eq(s.frame, 0); eq(s.phase, 'stack_once');
  eq(s.preload.scene, 'fuel');
});

check('queued → in_progress is a fresh start', () => {
  const prev = step(null, [task('a', 'queued')]);
  const s = step(prev, [task('a', 'in_progress', { started: T0 - 5e3 })]);
  eq(s.phase, 'stack_once'); eq(s.mode, 'once'); eq(s.frame, 0);
});

check('stack ended while in_progress → fuel from 0 with intro', () => {
  const t = [task('a', 'in_progress', { started: T0 - 20e3 })];
  const a = step(null, t);
  eq(a.phase, 'stack_once');
  const s = step(a, t, { event: 'ended' });
  eq(s.scene, 'fuel'); eq(s.mode, 'loop'); eq(s.intro, null); eq(s.frame, 0); eq(s.phase, 'fuel_intro');
});

check('stack playing then task completes → stay on stack, preload launch', () => {
  const start = [task('a', 'in_progress', { started: T0 - 20e3 })];
  const a = step(null, start);
  const done = [task('a', 'done', { done: T0 - 1e3, started: T0 - 20e3 })];
  const s = step(a, done);
  eq(s.phase, 'stack_once'); eq(s.pendingAfter, 'launch'); eq(s.preload.scene, 'launch');
});

check('stack ended with pending launch → skip fuel, play launch', () => {
  const start = [task('a', 'in_progress', { started: T0 - 20e3 })];
  const a = step(null, start);
  const done = [task('a', 'done', { done: T0 - 1e3, started: T0 - 20e3 })];
  const b = step(a, done);
  const s = step(b, done, { event: 'ended' });
  eq(s.scene, 'launch'); eq(s.mode, 'once'); eq(s.frame, 0); eq(s.phase, 'launch_once');
});

check('page load blocked → fuel intro=0 frame 240 hold + grayscale', () => {
  const s = step(null, [task('b', 'blocked', { started: T0 - 80 * 60e3 })]);
  eq(s.scene, 'fuel'); eq(s.mode, 'hold'); eq(s.frame, 240); eq(s.intro, 0);
  eq(s.grayscale, true); eq(s.hold, true); eq(s.phase, 'blocked');
});

check('fuel loop then blocked → pause current frame, grayscale', () => {
  const live = [task('a', 'in_progress', { started: T0 - 47 * 60e3 })];
  const a = step(null, live);
  eq(a.phase, 'fuel_loop');
  const s = step(a, [task('a', 'blocked', { started: T0 - 47 * 60e3 })], { frame: 180 });
  eq(s.phase, 'blocked'); eq(s.mode, 'hold'); eq(s.frame, 180); eq(s.grayscale, true); eq(s.hold, true);
  eq(s.scene, 'fuel'); eq(s.intro, 0);
});

check('blocked → in_progress continues fuel loop, no grayscale', () => {
  const blk = [task('a', 'blocked', { started: T0 - 80 * 60e3 })];
  const a = step(null, blk);
  const s = step(a, [task('a', 'in_progress', { started: T0 - 80 * 60e3 })]);
  eq(s.scene, 'fuel'); eq(s.mode, 'loop'); eq(s.intro, 0); eq(s.grayscale, false); eq(s.hold, false);
});

check('in_progress → done plays launch once', () => {
  const live = [task('a', 'in_progress', { started: T0 - 47 * 60e3 })];
  const a = step(null, live);
  const s = step(a, [task('a', 'done', { done: T0 - 2e3, started: T0 - 47 * 60e3 })]);
  eq(s.scene, 'launch'); eq(s.mode, 'once'); eq(s.frame, 0); eq(s.phase, 'launch_once');
  eq(s.preload.scene, 'stack'); eq(s.preload.frame, 12);
});

check('launch ended → idle stack@12', () => {
  const live = [task('a', 'in_progress', { started: T0 - 47 * 60e3 })];
  const a = step(null, live);
  const done = [task('a', 'done', { done: T0 - 2e3, started: T0 - 47 * 60e3 })];
  const b = step(a, done);
  const s = step(b, done, { event: 'ended' });
  eq(s.phase, 'idle'); eq(s.scene, 'stack'); eq(s.mode, 'hold'); eq(s.frame, 12);
  ok(s.played[done[0].id], 'done id marked played');
});

check('launch playing then new in_progress → stay on launch', () => {
  const done = [task('a', 'done', { done: T0 - 2e3 })];
  const a = step(null, done);
  eq(a.phase, 'launch_once');
  const both = [task('a', 'done', { done: T0 - 2e3 }), task('b', 'in_progress', { started: T0 - 5e3 })];
  const s = step(a, both);
  eq(s.phase, 'launch_once'); eq(s.scene, 'launch');
});

check('launch ended with new in_progress → stack once then fuel', () => {
  const done = [task('a', 'done', { done: T0 - 2e3 })];
  const a = step(null, done);
  const both = [task('a', 'done', { done: T0 - 2e3 }), task('b', 'in_progress', { started: T0 - 5e3 })];
  const b = step(a, both);
  const s = step(b, both, { event: 'ended' });
  eq(s.phase, 'stack_once'); eq(s.scene, 'stack'); eq(s.mode, 'once');
});

check('page load recent done_at within 90s → launch once', () => {
  const s = step(null, [task('d', 'done', { done: T0 - 25e3, started: T0 - 90 * 60e3 })]);
  eq(s.phase, 'launch_once'); eq(s.scene, 'launch'); eq(s.mode, 'once');
});

check('old done is idle and marked played', () => {
  const s = step(null, [task('d', 'done', { done: T0 - 2 * 3600e3 })]);
  eq(s.phase, 'idle'); ok(s.played.d);
});

check('already-played recent done does not replay', () => {
  const tasks = [task('d', 'done', { done: T0 - 25e3 })];
  const a = step(null, tasks);
  const b = step(a, tasks, { event: 'ended' });
  const s = step(b, tasks);
  eq(s.phase, 'idle');
});

check('reduced idle → stack@12 hold', () => {
  const s = step(null, [], { reduced: true });
  eq(s.scene, 'stack'); eq(s.mode, 'hold'); eq(s.frame, 12);
});

check('reduced in_progress → fuel@240 intro=0 hold', () => {
  const s = step(null, [task('a', 'in_progress', { started: T0 - 10 * 60e3 })], { reduced: true });
  eq(s.scene, 'fuel'); eq(s.mode, 'hold'); eq(s.frame, 240); eq(s.intro, 0); eq(s.grayscale, false);
});

check('reduced blocked → fuel@240 grayscale HOLD', () => {
  const s = step(null, [task('a', 'blocked')], { reduced: true });
  eq(s.scene, 'fuel'); eq(s.mode, 'hold'); eq(s.frame, 240); eq(s.grayscale, true); eq(s.hold, true);
});

check('reduced recent done → launch@640 for 6s then idle', () => {
  const tasks = [task('d', 'done', { done: T0 - 10e3 })];
  const a = step(null, tasks, { reduced: true });
  eq(a.scene, 'launch'); eq(a.mode, 'hold'); eq(a.frame, 640); eq(a.phase, 'reduced_launch');
  const mid = step(a, tasks, { reduced: true, now: T0 + 3000 });
  eq(mid.phase, 'reduced_launch'); eq(mid.frame, 640);
  const b = step(a, tasks, { reduced: true, now: T0 + 6000 });
  eq(b.phase, 'idle'); eq(b.scene, 'stack'); eq(b.frame, 12);
});

check('progress 0–1 stays, 0–100 scales, clamped 0.05–0.98', () => {
  eq(S.fuelProgress(0.4), 0.4);
  eq(S.fuelProgress(50), 0.5);
  eq(S.fuelProgress(0), 0.05);
  eq(S.fuelProgress(1), 0.98);
  eq(S.fuelProgress(100), 0.98);
  eq(S.fuelProgress(null), null);
  const s = step(null, [task('a', 'in_progress', { started: T0 - 47 * 60e3, progress: 0.4 })]);
  eq(s.progress, 0.4);
  const t = step(null, [task('a', 'in_progress', { started: T0 - 47 * 60e3, progress: 80 })]);
  eq(t.progress, 0.8);
  const u = step(null, [task('a', 'in_progress', { started: T0 - 47 * 60e3 })]);
  eq(u.progress, null);
});

check('sbMain prefers in_progress over queued over blocked', () => {
  const tasks = [
    task('q', 'queued', { updated: T0 }),
    task('b', 'blocked', { updated: T0 }),
    task('i', 'in_progress', { updated: T0 - 1000 }),
  ];
  eq(S.sbMain(tasks).id, 'i');
  eq(S.sbMain(tasks.filter(t => t.id !== 'i')).id, 'q');
  eq(S.sbMain([task('b', 'blocked')]).id, 'b');
  eq(S.sbMain([]), null);
});

check('multi-task: one done while another in_progress stays on fuel', () => {
  const live = [
    task('a', 'in_progress', { started: T0 - 47 * 60e3 }),
    task('b', 'queued'),
  ];
  const a = step(null, live);
  const next = [
    task('a', 'done', { done: T0 - 1e3, started: T0 - 47 * 60e3 }),
    task('b', 'in_progress', { started: T0 - 47 * 60e3 }),
  ];
  const s = step(a, next);
  eq(s.scene, 'fuel'); eq(s.phase, 'fuel_loop');
});

if (failed) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
