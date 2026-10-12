(function () {
  'use strict';
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
        if ((mode === 'once' || mode === 'loop') && P && !document.hidden) P.play();
      });
    });
    stopKick();
    kickTimer = setInterval(function () {
      if (!P || document.hidden || (mode !== 'once' && mode !== 'loop')) { stopKick(); return; }
      var f = P.getCurrentFrame();
      if (P.isPlaying() && f === kickAt) {
        P.pause();
        P.seekTo(f);
        requestAnimationFrame(function () {
          if ((mode === 'once' || mode === 'loop') && !document.hidden) P.play();
        });
      }
      kickAt = f;
    }, 300);
  }

  function onFrame(e) {
    var f = e && e.detail ? e.detail.frame : (P && P.getCurrentFrame ? P.getCurrentFrame() : 0);
    if (mode === 'once' && (f >= dur() - 2 || (last >= 0 && f < last))) {
      stopKick();
      P.pause();
      P.seekTo(dur() - 1);
      mode = 'done';
      post({ ev: 'ended' });
    }
    last = f;
  }

  function ready() {
    P = window.__player;
    if (!P) return false;
    P.addEventListener('frameupdate', onFrame);
    if (mode === 'hold') applyHold();
    else if (mode === 'once') { last = -1; if (hold) P.seekTo(hold); startSoon(); }
    else { startSoon(); }
    document.documentElement.classList.remove('sb-wait');
    post({ ev: 'ready' });
    return true;
  }

  function wait() {
    if (ready()) return;
    if (Date.now() - waitStart > 3000) {
      document.documentElement.classList.remove('sb-wait');
      post({ ev: 'error', err: 'no player' });
      return;
    }
    requestAnimationFrame(wait);
  }
  wait();

  addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || d.sb !== 1) return;
    if (!P) return;
    if (d.cmd === 'play') {
      mode = d.once ? 'once' : 'loop';
      last = -1;
      if (d.from != null) P.seekTo(d.from);
      startSoon();
    } else if (d.cmd === 'resume') {
      if ((mode === 'once' || mode === 'loop') && !P.isPlaying()) startSoon();
    } else if (d.cmd === 'pause') {
      stopKick();
      P.pause();
    } else if (d.cmd === 'seek') {
      stopKick();
      P.pause();
      P.seekTo(d.frame);
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!P) return;
    if (document.hidden) {
      wasPlaying = P.isPlaying && P.isPlaying();
      stopKick();
      P.pause();
    } else if (wasPlaying && mode !== 'done' && mode !== 'hold') {
      startSoon();
    }
  });
})();
