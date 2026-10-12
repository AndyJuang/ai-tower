(function () {
  'use strict';
  // Note: Early hypothesis attributed frozen scenes to AudioContext suspension in Safari iframes.
  // Headless WebKit trace proved the real root cause was postMessage race conditions:
  // rAF latency in WebKit iframes caused early commands to be dropped before ready() ran,
  // followed by URL mode=hold override and ignored resume commands.
  // The AudioContext stub below is retained as a harmless defense against any audio-clock dependency.
  try {
    ['AudioContext', 'webkitAudioContext'].forEach(function (k) {
      try { Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); } catch (e) {}
      try { if (typeof Window !== 'undefined' && Window.prototype) Object.defineProperty(Window.prototype, k, { value: undefined, configurable: true, writable: true }); } catch (e) {}
      try { window[k] = undefined; } catch (e) {}
    });
  } catch (e) {}

  function createBridgeQueue(initial) {
    var mode = (initial && initial.mode) || 'hold';
    var hold = (initial && Number(initial.hold)) || 0;
    if (!isFinite(hold) || hold < 0) hold = 0;

    var lastPlay = null;
    var earlyCmd = null;
    var isReady = false;

    return {
      getMode: function () { return mode; },
      setMode: function (m) { mode = m; },
      getLastPlay: function () { return lastPlay; },
      getEarlyCmd: function () { return earlyCmd; },
      isReady: function () { return isReady; },

      receive: function (d) {
        if (!d || !d.cmd) return null;
        if (d.cmd === 'play') {
          lastPlay = { cmd: 'play', once: !!d.once, from: d.from };
        }

        if (!isReady) {
          if (d.cmd === 'play') {
            earlyCmd = { cmd: 'play', once: !!d.once, from: d.from };
          } else if (d.cmd === 'resume') {
            if (lastPlay) {
              earlyCmd = { cmd: 'play', once: !!lastPlay.once, from: lastPlay.from };
            } else {
              earlyCmd = { cmd: 'resume' };
            }
          } else if (d.cmd === 'pause') {
            earlyCmd = { cmd: 'pause' };
          } else if (d.cmd === 'seek') {
            earlyCmd = { cmd: 'seek', frame: Number(d.frame) || 0 };
          } else {
            return null;
          }
          return { type: 'queued', cmd: earlyCmd };
        }

        return this.dispatch(d);
      },

      onReady: function () {
        isReady = true;
        if (earlyCmd) {
          var action = this.dispatch(earlyCmd);
          earlyCmd = null;
          return action;
        }
        if (mode === 'hold') {
          return { action: 'hold', frame: hold };
        } else if (mode === 'once') {
          return { action: 'play', once: true, from: hold > 0 ? hold : undefined };
        } else {
          return { action: 'play', once: false };
        }
      },

      dispatch: function (d) {
        if (!d || !d.cmd) return null;
        if (d.cmd === 'play') {
          lastPlay = { cmd: 'play', once: !!d.once, from: d.from };
          mode = d.once ? 'once' : 'loop';
          return { action: 'play', once: !!d.once, from: d.from };
        }
        if (d.cmd === 'resume') {
          if (mode === 'once' || mode === 'loop') {
            return { action: 'resume', mode: mode };
          }
          if (lastPlay) {
            // Treat 'resume' after a 'play' as playing even if mode is still hold
            mode = lastPlay.once ? 'once' : 'loop';
            return { action: 'play', once: !!lastPlay.once, from: lastPlay.from };
          }
          return { action: 'ignore' };
        }
        if (d.cmd === 'pause') {
          return { action: 'pause' };
        }
        if (d.cmd === 'seek') {
          return { action: 'seek', frame: Number(d.frame) || 0 };
        }
        return null;
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createBridgeQueue: createBridgeQueue };
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  var q = new URLSearchParams(location.search);
  var DUR = { stack: 300, fuel: 390, launch: 780 };
  var sc = q.get('scene');
  if (!DUR[sc]) sc = 'stack';
  document.body.dataset.scene = sc;
  var mode = q.get('mode') || 'hold';
  var hold = Number(q.get('frame'));
  if (!isFinite(hold) || hold < 0) hold = 0;
  var last = -1;
  var P = null;
  var wasPlaying = false;
  var origin = location.origin;
  var kickAt = -1;
  var kickTimer = 0;
  var waitStart = Date.now();
  var waitTimer = null;
  var waitRaf = null;

  var queue = createBridgeQueue({ mode: mode, hold: hold });

  function post(m) {
    m.sb = 1;
    m.scene = sc;
    try { parent.postMessage(m, origin); } catch (e) {}
  }

  function dur() { return DUR[sc] || 300; }

  function applyHold() {
    if (!P) return;
    P.pause();
    P.seekTo(hold);
  }

  function stopKick() {
    if (kickTimer) { clearInterval(kickTimer); kickTimer = 0; }
    kickAt = -1;
  }

  // Remotion can report isPlaying() but never advance when play() lands in the
  // same tick as a seek/pause. Start on the next frames; kick again if stuck.
  function startSoon() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var curMode = queue.getMode();
        if ((curMode === 'once' || curMode === 'loop') && P && !document.hidden) P.play();
      });
    });
    stopKick();
    kickTimer = setInterval(function () {
      var curMode = queue.getMode();
      if (!P || document.hidden || (curMode !== 'once' && curMode !== 'loop')) { stopKick(); return; }
      var f = P.getCurrentFrame();
      if (P.isPlaying() && f === kickAt) {
        P.pause();
        P.seekTo(f);
        requestAnimationFrame(function () {
          var m = queue.getMode();
          if ((m === 'once' || m === 'loop') && !document.hidden) P.play();
        });
      }
      kickAt = f;
    }, 300);
  }

  function applyAction(act) {
    if (!act || !P) return;
    if (act.action === 'hold') {
      applyHold();
    } else if (act.action === 'play') {
      last = -1;
      if (act.from != null) P.seekTo(act.from);
      startSoon();
    } else if (act.action === 'resume') {
      if (!P.isPlaying()) startSoon();
    } else if (act.action === 'pause') {
      stopKick();
      P.pause();
    } else if (act.action === 'seek') {
      stopKick();
      P.pause();
      P.seekTo(act.frame);
    }
  }

  function onFrame(e) {
    var f = e && e.detail ? e.detail.frame : (P && P.getCurrentFrame ? P.getCurrentFrame() : 0);
    var curMode = queue.getMode();
    if (curMode === 'once' && (f >= dur() - 2 || (last >= 0 && f < last))) {
      stopKick();
      P.pause();
      P.seekTo(dur() - 1);
      queue.setMode('done');
      post({ ev: 'ended' });
    }
    last = f;
  }

  function ready() {
    P = window.__player;
    if (!P) return false;
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    if (waitRaf) { cancelAnimationFrame(waitRaf); waitRaf = null; }
    try { if (P.mute) P.mute(); } catch (e) {}
    P.addEventListener('frameupdate', onFrame);
    if (mode === 'hold') applyHold();
    var act = queue.onReady();
    applyAction(act);
    document.documentElement.classList.remove('sb-wait');
    post({ ev: 'ready' });
    return true;
  }

  function wait() {
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    if (waitRaf) { cancelAnimationFrame(waitRaf); waitRaf = null; }
    if (ready()) return;
    if (Date.now() - waitStart > 3000) {
      document.documentElement.classList.remove('sb-wait');
      post({ ev: 'error', err: 'no player' });
      return;
    }
    waitRaf = requestAnimationFrame(wait);
    waitTimer = setTimeout(wait, 25);
  }
  wait();

  addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || d.sb !== 1) return;
    var res = queue.receive(d);
    if (res && res.action) {
      applyAction(res);
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!P) return;
    if (document.hidden) {
      wasPlaying = P.isPlaying && P.isPlaying();
      stopKick();
      P.pause();
    } else if (wasPlaying && queue.getMode() !== 'done' && queue.getMode() !== 'hold') {
      startSoon();
    }
  });
})();
