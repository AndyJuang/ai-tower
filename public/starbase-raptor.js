// StarBase Raptor — drives public/starbase/raptor/engine.html on each StarBase pad.
// Pure logic (progress mapping, landing dedupe, slot allocation) is exported for node tests;
// the browser controller is attached as window.StarbaseRaptor.
// Engine figure: wheresryan22/anatomy (MIT, (c) 2026 Ryan) — see public/starbase/raptor/LICENSE-anatomy.txt.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StarbaseRaptor = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_LIVE = 3;              // concurrent engine iframes (each holds one WebGL context)
  var TAU_MS = 10 * 60 * 1000;   // asymptotic ramp time constant when no progress / estimate
  var RAMP_CAP = 0.95;           // never show "assembled" before the job actually lands
  var LAND_WINDOW_MS = 10 * 60 * 1000; // a done task this fresh counts as "just landed"
  var TOGGLE_KEY = 'starbase.raptor';
  var SEEN_KEY = 'starbase.raptor.landed';
  var IDLE_IMG = '/starbase/raptor/idle.png'; // assembled engine, used when a pad has no live iframe

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function num(v) { if (v == null || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }

  // Active job of a pad: newest in_progress, else null (queued/blocked don't assemble).
  function activeJob(tasks) {
    var run = (tasks || []).filter(function (t) { return t && t.status === 'in_progress'; });
    run.sort(function (a, b) { return (b.updated_at || b.started_at || 0) - (a.updated_at || a.started_at || 0); });
    return run[0] || null;
  }

  // Map a running job to 0..RAMP_CAP. Order: explicit progress (0..1 or 0..100) →
  // elapsed / estimate (estimate_ms | eta_ms | estimate_min) → smooth asymptotic ramp on elapsed.
  function jobProgress(t, now) {
    if (!t) return 0;
    var p = num(t.progress);
    if (p != null) { if (p > 1) p = p / 100; return clamp(p, 0, RAMP_CAP); }
    var start = num(t.started_at);
    if (start == null) return 0.05;
    var elapsed = Math.max(0, now - start);
    var est = num(t.estimate_ms) || num(t.eta_ms) || (num(t.estimate_min) ? num(t.estimate_min) * 60000 : null);
    if (est && est > 0) return clamp(elapsed / est, 0, RAMP_CAP);
    return clamp(RAMP_CAP * (1 - Math.exp(-elapsed / TAU_MS)), 0, RAMP_CAP);
  }

  // Jobs that landed and haven't ignited yet. `seen` is a Set of job ids (mutated: ids are added).
  // `prevRunning` = ids that were in_progress on the previous poll: a transition always counts;
  // otherwise only a done task with done_at inside LAND_WINDOW_MS counts (so reloads don't replay old ones).
  function newLandings(tasks, seen, prevRunning, now) {
    var out = [];
    (tasks || []).forEach(function (t) {
      if (!t || t.status !== 'done' || !t.id || seen.has(t.id)) return;
      var doneAt = num(t.done_at) || num(t.updated_at);
      var fresh = (prevRunning && prevRunning.has(t.id)) || (doneAt != null && now - doneAt <= LAND_WINDOW_MS);
      seen.add(t.id);
      if (fresh) out.push(t);
    });
    return out;
  }

  // Choose which pads get a live engine. candidates: [{key, visible, active, featured, launching}].
  // Only visible pads are eligible; priority launching > active > featured; stable by input order.
  function allocate(candidates, max) {
    if (max == null) max = MAX_LIVE;
    var elig = (candidates || []).map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return x.c.visible; });
    function score(c) { return (c.launching ? 4 : 0) + (c.active ? 2 : 0) + (c.featured ? 1 : 0); }
    elig.sort(function (a, b) { return score(b.c) - score(a.c) || a.i - b.i; });
    return new Set(elig.slice(0, Math.max(0, max)).map(function (x) { return x.c.key; }));
  }

  function staticSvg(p) {
    var n = Math.round(clamp(p || 0, 0, 1) * 11);
    var bars = '';
    for (var i = 0; i < 11; i++) bars += '<rect x="' + (8 + i * 8) + '" y="92" width="6" height="5" rx="1" fill="' + (i < n ? '#ffb547' : '#d4d4d6') + '"/>';
    return '<svg class="sb-raptor-static" viewBox="0 0 104 104" role="img" aria-label="Raptor ' + n + '/11">' +
      '<g fill="none" stroke="#8a8a8f" stroke-width="2" stroke-linejoin="round">' +
      '<rect x="40" y="8" width="24" height="14" rx="3"/><path d="M44 22h16v10H44z"/><path d="M46 32h12l4 10H42z"/>' +
      '<path d="M42 42h20l14 40H28z" stroke="#26262a"/></g>' +
      '<text x="52" y="66" text-anchor="middle" font-size="9" fill="#8a8a8f" font-family="monospace">' + n + '/11</text>' + bars + '</svg>';
  }

  // ---------- browser controller ----------
  function enabled() { try { return localStorage.getItem(TOGGLE_KEY) !== 'off'; } catch (e) { return true; } }
  function setEnabled(on) { try { localStorage.setItem(TOGGLE_KEY, on ? 'on' : 'off'); } catch (e) {} }
  function reducedMotion() { try { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }

  function createController(opts) {
    opts = opts || {};
    var src = opts.src || '/starbase/raptor/engine.html';
    var max = opts.max == null ? MAX_LIVE : opts.max;
    var pads = new Map(); // key -> state
    var seen = new Set();
    try { JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]').forEach(function (id) { seen.add(id); }); } catch (e) {}
    function saveSeen() { try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-300))); } catch (e) {} }
    var io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(function (ents) {
      ents.forEach(function (e) { var s = e.target.__raptor; if (s) s.visible = e.isIntersecting; });
      schedule();
    }, { threshold: 0.05 }) : null;
    var queued = false;
    function schedule() { if (queued) return; queued = true; (window.requestAnimationFrame || setTimeout)(function () { queued = false; reconcile(); }); }

    window.addEventListener('message', function (e) {
      var m = e.data || {}; if (!m.raptor || !m.id) return;
      var s = pads.get(m.id.replace(/^raptor-/, '')); if (!s || !s.frame || e.source !== s.frame.contentWindow) return;
      if (m.raptor === 'ready') { s.ready = true; s.queue.splice(0).forEach(send.bind(null, s)); }
      if (m.raptor === 'landed') { s.launching = false; s.box.dataset.state = 'landed'; }
      if (m.raptor === 'reset') { s.sent = -1; push(s); schedule(); }
    });
    document.addEventListener('visibilitychange', schedule);

    function send(s, msg) { if (!s.frame) return; if (s.ready) s.frame.contentWindow.postMessage(msg, location.origin); else s.queue.push(msg); }
    function push(s) { if (s.launching) return; var p = Math.round(s.progress * 1000) / 1000; if (p !== s.sent) { s.sent = p; send(s, { cmd: 'progress', value: p }); } }
    function mountFrame(s) {
      s.box.dataset.painted = 'frame';
      var f = document.createElement('iframe');
      f.name = 'raptor-' + s.key; f.src = src; f.title = 'Raptor engine · ' + s.key; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      s.frame = f; s.ready = false; s.queue = []; s.sent = -1;
      s.box.replaceChildren(f); push(s);
    }
    function unmountFrame(s) { if (s.frame) { s.frame.src = 'about:blank'; s.frame.remove(); } s.frame = null; s.ready = false; s.launching = false; }
    function paintStatic(s) { if (s.box.dataset.painted !== 'img') { s.box.innerHTML = '<img class="sb-raptor-static" src="' + IDLE_IMG + '" alt="Raptor engine" draggable="false">'; s.box.dataset.painted = 'img'; } }

    function reconcile() {
      var live = enabled() && !reducedMotion() && !document.hidden && (!opts.isLive || opts.isLive());
      var list = Array.from(pads.values());
      var keep = live ? allocate(list.map(function (s) { return { key: s.key, visible: s.visible && (s.active || s.launching), active: s.active, featured: s.featured, launching: s.launching }; }), max) : new Set();
      list.forEach(function (s) {
        s.box.dataset.mode = keep.has(s.key) ? 'live' : 'static';
        if (keep.has(s.key)) { if (!s.frame) mountFrame(s); else push(s); }
        else { if (s.frame) unmountFrame(s); paintStatic(s); }
      });
    }

    // Call on every render. padEl gets a .sb-raptor box; tasks = that agent's tasks.
    function sync(key, padEl, tasks, info) {
      var s = pads.get(key);
      if (!s || !padEl.contains(s.box)) {
        if (s) { unmountFrame(s); if (io) io.unobserve(s.box); }
        var box = padEl.querySelector('.sb-raptor');
        if (!box) { box = document.createElement('div'); box.className = 'sb-raptor'; (padEl.querySelector('.sb-info') || padEl).insertBefore(box, (padEl.querySelector('.sb-main-task') || null)); }
        s = { key: key, box: box, frame: null, ready: false, queue: [], sent: -1, visible: !io, active: false, featured: false, launching: false, progress: 0, running: new Set() };
        box.__raptor = s; pads.set(key, s); if (io) io.observe(box);
      }
      var now = Date.now();
      var job = activeJob(tasks);
      s.active = !!job; s.featured = !!(info && info.featured);
      if (!s.launching) s.progress = job ? jobProgress(job, now) : 0;
      var landed = newLandings(tasks, seen, s.running, now);
      s.running = new Set((tasks || []).filter(function (t) { return t && t.status === 'in_progress'; }).map(function (t) { return t.id; }));
      if (landed.length) {
        saveSeen();
        // one ignition per poll even if several jobs land at once; offscreen/static pads just mark them seen
        s.launching = true; s.box.dataset.state = 'launch';
        reconcile();
        if (s.frame) send(s, { cmd: 'complete' }); else { s.launching = false; s.progress = 0; }
        return;
      }
      s.box.dataset.state = job ? 'assembling' : 'idle';
      schedule();
    }
    function prune(keys) { pads.forEach(function (s, k) { if (!keys.has(k)) { unmountFrame(s); if (io) io.unobserve(s.box); pads.delete(k); } }); }
    return { sync: sync, prune: prune, refresh: schedule, _pads: pads, _seen: seen };
  }

  return {
    MAX_LIVE: MAX_LIVE, TAU_MS: TAU_MS, RAMP_CAP: RAMP_CAP, LAND_WINDOW_MS: LAND_WINDOW_MS, TOGGLE_KEY: TOGGLE_KEY,
    activeJob: activeJob, jobProgress: jobProgress, newLandings: newLandings, allocate: allocate, staticSvg: staticSvg,
    enabled: enabled, setEnabled: setEnabled, createController: createController,
  };
}));
