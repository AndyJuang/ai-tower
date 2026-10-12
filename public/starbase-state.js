(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StarbaseState = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DUR = { stack: 300, fuel: 390, launch: 780 };
  var HOLD_FRAME = { stack: 12, fuel: 240, launch: 640 };
  var FUEL_LOOP_START = 90;
  var START_MS = 90000;
  var DONE_MS = 90000;
  var REDUCED_LAUNCH_MS = 6000;

  function sbMain(tasks) {
    var live = tasks || [];
    function pick(st) {
      return live.filter(function (t) { return t.status === st; }).sort(function (a, b) {
        return (b.updated_at || b.started_at || 0) - (a.updated_at || a.started_at || 0);
      })[0];
    }
    return pick('in_progress') || pick('queued') || pick('blocked') || null;
  }

  function fuelProgress(raw) {
    if (raw == null || raw === '') return null;
    var p = Number(raw);
    if (!isFinite(p)) return null;
    if (p > 1) p = p / 100;
    if (p < 0) p = 0;
    if (p > 1) p = 1;
    return Math.min(0.98, Math.max(0.05, p));
  }

  function copyMap(m) {
    var o = {};
    if (m) Object.keys(m).forEach(function (k) { o[k] = m[k]; });
    return o;
  }

  function statusSnapshot(tasks) {
    var o = {};
    (tasks || []).forEach(function (t) { if (t && t.id) o[t.id] = t.status; });
    return o;
  }

  function isFreshStart(t, prevSt, now) {
    if (!t || t.status !== 'in_progress') return false;
    var ps = prevSt[t.id];
    if (ps === 'queued') return true;
    if (ps == null && t.started_at && (now - t.started_at) <= START_MS) return true;
    return false;
  }

  function isFreshDone(t, prevSt, played, now) {
    if (!t || t.status !== 'done') return false;
    if (played[t.id]) return false;
    var ps = prevSt[t.id];
    if (ps === 'in_progress' || ps === 'blocked') return true;
    var doneAt = t.done_at || t.updated_at;
    if (doneAt && (now - doneAt) <= DONE_MS) return true;
    return false;
  }

  function attachProgress(o, tasks) {
    if (o.scene !== 'fuel') { o.progress = null; return o; }
    var main = (tasks || []).filter(function (t) { return t.status === 'in_progress'; })[0]
      || (tasks || []).filter(function (t) { return t.status === 'blocked'; })[0];
    o.progress = main && main.progress != null ? fuelProgress(main.progress) : null;
    return o;
  }

  function base(prev, tasks) {
    return {
      scene: 'stack',
      mode: 'hold',
      frame: HOLD_FRAME.stack,
      intro: null,
      progress: null,
      grayscale: false,
      hold: false,
      phase: 'idle',
      pendingAfter: null,
      reducedLaunchAt: null,
      played: copyMap(prev && prev.played),
      statuses: statusSnapshot(tasks),
      preload: null
    };
  }

  function idle(prev, tasks) {
    var o = base(prev, tasks);
    o.phase = 'idle';
    o.scene = 'stack';
    o.mode = 'hold';
    o.frame = HOLD_FRAME.stack;
    return attachProgress(o, tasks);
  }

  function stackOnce(prev, tasks, pendingAfter) {
    var o = base(prev, tasks);
    o.phase = 'stack_once';
    o.scene = 'stack';
    o.mode = 'once';
    o.frame = 0;
    o.pendingAfter = pendingAfter || null;
    o.preload = pendingAfter === 'launch'
      ? { scene: 'launch', mode: 'hold', frame: 0 }
      : { scene: 'fuel', mode: 'hold', frame: 0 };
    return attachProgress(o, tasks);
  }

  function fuelLoop(prev, tasks, intro0) {
    var o = base(prev, tasks);
    o.scene = 'fuel';
    o.mode = 'loop';
    o.intro = intro0 ? 0 : null;
    o.frame = intro0 ? FUEL_LOOP_START : 0;
    o.phase = intro0 ? 'fuel_loop' : 'fuel_intro';
    return attachProgress(o, tasks);
  }

  function fuelHold(prev, tasks, frame, intro0) {
    var o = base(prev, tasks);
    o.scene = 'fuel';
    o.mode = 'hold';
    o.frame = frame != null && isFinite(frame) ? frame : HOLD_FRAME.fuel;
    o.intro = intro0 ? 0 : null;
    o.phase = 'blocked';
    o.grayscale = true;
    o.hold = true;
    return attachProgress(o, tasks);
  }

  function launchOnce(prev, tasks) {
    var o = base(prev, tasks);
    o.phase = 'launch_once';
    o.scene = 'launch';
    o.mode = 'once';
    o.frame = 0;
    o.preload = { scene: 'stack', mode: 'hold', frame: HOLD_FRAME.stack };
    return attachProgress(o, tasks);
  }

  function reducedLaunch(prev, tasks, at) {
    var o = base(prev, tasks);
    o.phase = 'reduced_launch';
    o.scene = 'launch';
    o.mode = 'hold';
    o.frame = HOLD_FRAME.launch;
    o.reducedLaunchAt = at;
    o.preload = { scene: 'stack', mode: 'hold', frame: HOLD_FRAME.stack };
    return attachProgress(o, tasks);
  }

  function reducedFuel(prev, tasks) {
    var o = base(prev, tasks);
    o.phase = 'fuel_loop';
    o.scene = 'fuel';
    o.mode = 'hold';
    o.frame = HOLD_FRAME.fuel;
    o.intro = 0;
    return attachProgress(o, tasks);
  }

  function markPlayed(prev, tasks) {
    var played = copyMap(prev && prev.played);
    (tasks || []).forEach(function (t) { if (t && t.status === 'done' && t.id) played[t.id] = true; });
    return played;
  }

  function next(input) {
    input = input || {};
    var tasks = input.tasks || [];
    var now = input.now != null ? input.now : 0;
    var reduced = !!input.reduced;
    var event = input.event || 'tick';
    var prev = input.prev || { phase: null, played: {}, statuses: {} };
    var prevSt = prev.statuses || {};
    var played = copyMap(prev.played);

    var inP = tasks.filter(function (t) { return t.status === 'in_progress'; });
    var blocked = tasks.filter(function (t) { return t.status === 'blocked'; });
    var done = tasks.filter(function (t) { return t.status === 'done'; });
    var wantsStart = inP.some(function (t) { return isFreshStart(t, prevSt, now); });
    var wantsLaunch = done.some(function (t) { return isFreshDone(t, prevSt, played, now); });
    var phase = prev.phase;

    done.forEach(function (t) {
      if (t.id && !played[t.id] && !isFreshDone(t, prevSt, played, now)) played[t.id] = true;
    });
    prev = {
      phase: prev.phase,
      played: played,
      statuses: prev.statuses || {},
      pendingAfter: prev.pendingAfter,
      reducedLaunchAt: prev.reducedLaunchAt,
      frame: prev.frame,
      intro: prev.intro,
      scene: prev.scene,
      mode: prev.mode
    };

    if (reduced) {
      if (phase === 'reduced_launch') {
        var at = prev.reducedLaunchAt != null ? prev.reducedLaunchAt : now;
        if (now - at >= REDUCED_LAUNCH_MS) {
          var after = { played: markPlayed(prev, tasks), statuses: prev.statuses };
          if (inP.length) return reducedFuel(after, tasks);
          if (blocked.length) return fuelHold(after, tasks, HOLD_FRAME.fuel, true);
          return idle(after, tasks);
        }
        return reducedLaunch(prev, tasks, at);
      }
      if (wantsLaunch) return reducedLaunch(prev, tasks, now);
      if (blocked.length && !inP.length) return fuelHold(prev, tasks, HOLD_FRAME.fuel, true);
      if (inP.length) return reducedFuel(prev, tasks);
      return idle(prev, tasks);
    }

    if (event === 'ended') {
      if (phase === 'stack_once') {
        if (prev.pendingAfter === 'launch' || (wantsLaunch && !inP.length)) return launchOnce(prev, tasks);
        if (inP.length) return fuelLoop(prev, tasks, false);
        if (blocked.length) return fuelHold(prev, tasks, HOLD_FRAME.fuel, true);
        return idle(prev, tasks);
      }
      if (phase === 'launch_once') {
        var p3 = { played: markPlayed(prev, tasks), statuses: prev.statuses };
        if (inP.length) return stackOnce(p3, tasks, null);
        if (blocked.length) return fuelHold(p3, tasks, HOLD_FRAME.fuel, true);
        return idle(p3, tasks);
      }
      if (phase === 'fuel_intro') return fuelLoop(prev, tasks, true);
    }

    if (phase === 'stack_once') {
      var pending = (wantsLaunch && !inP.length) ? 'launch' : null;
      return stackOnce(prev, tasks, pending);
    }
    if (phase === 'launch_once') return launchOnce(prev, tasks);
    if (phase === 'fuel_intro' || phase === 'fuel_loop') {
      if (wantsLaunch && !inP.length && !blocked.length) return launchOnce(prev, tasks);
      if (blocked.length && !inP.length) {
        var keep = input.frame != null ? input.frame : HOLD_FRAME.fuel;
        return fuelHold(prev, tasks, keep, true);
      }
      return fuelLoop(prev, tasks, phase === 'fuel_loop' || prev.intro === 0);
    }
    if (phase === 'blocked') {
      if (inP.length) return fuelLoop(prev, tasks, true);
      if (!blocked.length) {
        if (wantsLaunch) return launchOnce(prev, tasks);
        return idle(prev, tasks);
      }
      return fuelHold(prev, tasks, prev.frame != null ? prev.frame : HOLD_FRAME.fuel, true);
    }

    if (wantsStart) return stackOnce(prev, tasks, null);
    if (inP.length) return fuelLoop(prev, tasks, true);
    if (blocked.length) return fuelHold(prev, tasks, HOLD_FRAME.fuel, true);
    if (wantsLaunch) return launchOnce(prev, tasks);
    return idle(prev, tasks);
  }

  function srcKey(s) {
    if (!s) return '';
    return [s.scene, s.intro === 0 ? 'i0' : 'i1', s.progress == null ? 'pd' : 'p' + s.progress].join('|');
  }

  return {
    next: next,
    sbMain: sbMain,
    fuelProgress: fuelProgress,
    srcKey: srcKey,
    DUR: DUR,
    HOLD_FRAME: HOLD_FRAME,
    FUEL_LOOP_START: FUEL_LOOP_START,
    START_MS: START_MS,
    DONE_MS: DONE_MS,
    REDUCED_LAUNCH_MS: REDUCED_LAUNCH_MS
  };
}));
