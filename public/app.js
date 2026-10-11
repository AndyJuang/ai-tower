/* AI Tower v3 — dispatch board (vanilla JS, no deps) */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const API = qs.get('api') || '/api/strips';
  const FROZEN = qs.has('frozen');                       // static snapshot (screenshots)
  let TOKEN = (document.querySelector('meta[name=tower-token]') || {}).content || '';
  const POLL = 10000;
  const LANES = ['GK', 'CL', 'CX', 'AG'];
  const KEY = { GK: 'grok', CL: 'claude', CX: 'codex', AG: 'antigravity' };
  const CODE = { grok: 'GK', claude: 'CL', codex: 'CX', antigravity: 'AG' };
  const $ = s => document.querySelector(s);
  const live = $('#live');
  let data = null, loadedAt = Date.now(), busy = false, pendingRender = false, undoState = null, undoTimer = null;
  const open = new Set();
  const filt = Object.assign({ q: '', ms: '', repo: '' }, JSON.parse(localStorage.getItem('tower.filter') || '{}'));
  const SB_KEY = 'tower.starbaseOpen';
  const sbPlayed = new Set();
  const sbPrev = new Map();
  const sbLift = new Map();
  const sbLiftTimer = new Map();

  const now = () => FROZEN && data ? data.generatedAt + (Date.now() - loadedAt) : Date.now();
  const tpe = t => new Date(t + ((data && data.tzOffsetMin != null ? data.tzOffsetMin : -new Date().getTimezoneOffset()) * 60e3));
  const hm = t => t ? tpe(t).toISOString().slice(11, 16) : '--:--';
  const pad = n => String(n).padStart(2, '0');
  function dur(ms) { if (ms == null || ms < 0 || isNaN(ms)) return '--:--:--'; const s = Math.floor(ms / 1000); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); }
  function ago(t) { const m = Math.round((now() - t) / 60000); return m < 60 ? m + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h' + pad(m % 60) + ' ago' : Math.floor(m / 1440) + 'd ago'; }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const flap = (txt, cls = '') => `<span class="flap ${cls}">${String(txt).split('').map(ch => ch === ':' || ch === ' ' ? `<i class="sep">${ch === ' ' ? '&nbsp;' : ':'}</i>` : `<i>${esc(ch)}</i>`).join('')}</span>`;
  function announce(t) { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); }
  function toast(msg, kind) { const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + (kind || ''); t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 12000 : 6000); }
  const FRIENDLY = {
    'bad token': '塔台連線憑證已更新，自動重試也沒成功 — 請重新整理頁面（⌘R）再按一次',
    'manual issue': '需要實機的 issue 不能排進背景 agent',
    '需要實機的 issue 不能排進背景 agent': '需要實機的 issue 不能排進背景 agent',
    'bad origin': '請從 http://127.0.0.1 塔台網址開啟這個頁面再操作',
    'bad host': '請用 http://127.0.0.1 開啟塔台（不支援其他主機名稱）',
    'bad content-type': '瀏覽器送出的格式不對，請重新整理頁面',
  };
  async function refreshToken() {
    const r = await fetch('/api/token', { cache: 'no-store' }); if (!r.ok) return false;
    const j = await r.json().catch(() => ({})); if (!j.token) return false; TOKEN = j.token; return true;
  }
  async function post(p, body, retried) {
    if (FROZEN) return { ok: true, frozen: true };
    let r;
    try { r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tower-Token': TOKEN }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('連不到塔台伺服器（可能正在重新啟動），請稍候幾秒再試'); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 403 && j.error === 'bad token' && !retried && await refreshToken().catch(() => false)) return post(p, body, true);   // server restarted: new token, retry once
    if (!r.ok) throw Object.assign(new Error(FRIENDLY[j.error] || j.error || ('HTTP ' + r.status)), { data: j });
    return j;
  }

  // ---------- clock ----------
  function tick() {
    const d = tpe(now()).toISOString();
    $('#clock').innerHTML = flap(d.slice(11, 19), 'big');
    $('#clock-date').textContent = ((data && data.tzLabel) ? data.tzLabel + ' ' : '') + d.slice(0, 10);
    document.querySelectorAll('[data-since]').forEach(el => { el.innerHTML = flap(dur(now() - Number(el.dataset.since))); });
    document.querySelectorAll('[data-cd]').forEach(el => { el.innerHTML = flap(cd(Number(el.dataset.cd))); const l = el.previousElementSibling; if (l && Number(el.dataset.cd) <= now() && !l.dataset.done) { l.dataset.done = 1; l.textContent = '即將起飛'; } });
    document.querySelectorAll('[data-sb-elapsed]').forEach(el => { el.textContent = sbAgo(Number(el.dataset.sbElapsed)); });
    document.querySelectorAll('[data-sb-fuel]').forEach(el => {
      const started = Number(el.dataset.sbFuel) || now();
      el.style.setProperty('--p', Math.round((((now() - started) / 12e5) % 1) * 100) + '%');
    });
  }
  setInterval(tick, 1000);

  // ---------- data ----------
  async function load() {
    try {
      const r = await fetch(API, { cache: 'no-store' }); data = await r.json(); loadedAt = Date.now();
      if (!filt.repo && data.dispatchRepo) filt.repo = data.dispatchRepo;
      $('#feed').textContent = `${FROZEN ? 'SNAPSHOT' : data.demo ? 'DEMO' : 'LIVE'} · updated ${hm(data.generatedAt)} TPE · poll 10 s · runners ${data.capacity ? data.capacity.total + '/' + data.capacity.globalCap : '?'}${data.error ? ' · ERROR ' + data.error.slice(0, 80) : ''}${data.park && Object.keys(data.park.errors || {}).length ? ' · gh: ' + Object.values(data.park.errors)[0].slice(0, 80) : ''}`;
      if (busy) pendingRender = true; else render();
    } catch (e) { $('#feed').textContent = 'feed lost: ' + e; }
  }

  // ---------- pieces ----------
  const FIN = {
    grok: { body: '#0b0b0b', edge: '#f4f1e8', mark: '<path d="M10 25 L21 9" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' },
    claude: { body: '#D97757', edge: '#a9512f', mark: '<circle cx="15.5" cy="17" r="4.2" fill="#fff"/>' },
    codex: { body: '#10A37F', edge: '#0a7a5e', mark: '<path d="M11 13 L16 17 L11 21" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
    antigravity: { body: '#4285F4', edge: '#2a63c4', mark: '<path d="M15.5 11 L20.5 22 L10.5 22 Z" fill="#fff"/>' },
  };
  function fin(key, size) { const f = FIN[key] || { body: '#666', edge: '#444', mark: '' };
    return `<svg class="fin" width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true"><path d="M5 26 L11 3 L17 3 L25 26 Z" fill="${f.body}" stroke="${f.edge}" stroke-width="1.4" stroke-linejoin="round"/>${f.mark}</svg>`; }
  const CHIP = {
    TAKEOFF: s => `<span class="pulse"></span>TAKEOFF`, TAXI: s => `休息中${s.nextAt ? ' · 下一輪 ' + hm(s.nextAt) : ''}`,
    HOLDING: s => `HOLDING until ${hm(s.resumeAt)}`, SCHEDULED: s => s.etd ? `SCHEDULED · ${esc(s.etd)}` : 'SCHEDULED',
    LANDED: s => 'GOOD DAY ✓', STOPPED: s => 'STOPPED', DIVERTED: s => '⚠ DIVERTED',
  };
  function cd(t) { if (!t) return '--:--'; const ms = Math.max(0, t - now()); const d = dur(ms); return ms >= 3600e3 ? d : d.slice(3); }   // countdown mm:ss (h:mm:ss ≥ 1 h)
  function big(label, inner, attrs) { return `<span class="tbig"><small class="tl">${label}</small><b class="t"${attrs || ''}>${inner}</b></span>`; }
  function timeBlock(s) {
    const first = s.std ? `首飛 ${hm(s.std)}` : '';
    if (s.status === 'TAKEOFF') return big('航程', flap(dur(now() - (s.since || s.std))), ` data-since="${s.since || s.std}"`) + `<span>${s.attempt > 1 ? `第 ${s.attempt} 輪 · ` : ''}起飛 ${hm(s.since || s.std)}${s.attempt > 1 ? ' · ' + first : ''}</span>`;
    // READY: big = ETD (estimated time to enter TAKEOFF); small = 排入 (time it entered READY)
    const inR = s.readyAt ? `排入 ${hm(s.readyAt)}` : first;
    if (s.status === 'TAXI') return big('預計起飛', flap(s.nextAt ? hm(s.nextAt) : '--:--')) + `<span>休息中${s.attempt ? ` · 已飛 ${s.attempt} 輪` : ''}<br>${inR}</span>`;
    if (s.status === 'HOLDING') return big('預計起飛', flap(s.resumeAt ? hm(s.resumeAt) : '--:--')) + `<span>等額度恢復<br>${inR}</span>`;
    if (s.status === 'SCHEDULED') return big('預定', flap(s.etd || '--:--')) + `<span>預定出發</span>`;
    const fl = s.flightMin != null ? `航程 ${Math.floor(s.flightMin / 60)}:${pad(s.flightMin % 60)}` : '';
    const lab = s.status === 'LANDED' ? '落地' : s.status === 'STOPPED' ? '停止' : '結束';
    return big(lab, flap(hm(s.endedAt))) + `<span>${[s.status === 'DIVERTED' ? '異常結束' : '', fl].filter(Boolean).join(' · ')}${first ? '<br>' + first : ''}</span>`;
  }
  function detail(s) {
    const c = s.lastCommit, rows = []; const add = (k, v) => { if (v != null && v !== '') rows.push(`<dt>${k}</dt><dd>${v}</dd>`); };
    add('分支', `<code>${esc(s.branch || '—')}</code>`);
    add('Issue', (s.issueMeta || []).filter(m => m.title).map(m => `#${m.n} ${esc(m.title)}`).join('<br>'));
    add('進度', esc(s.progress && s.progress.status)); if (s.std) add('首次出發', hm(s.std)); if (s.attempt) add('回合', s.attempt);
    if (s.agentPid || s.runnerPid) add('PID', `agent ${s.agentPid || '—'} · runner ${s.runnerPid || '—'}`);
    if (c) add('最新 commit', `<code>${esc(c.hash)}</code> ${esc(ago(c.time))}<br>${esc(c.subject)}`);
    const ov = data.models && data.models.overrides && data.models.overrides[s.id];
    if (s.status !== 'LANDED' && s.status !== 'STOPPED' && s.status !== 'DIVERTED' && data.models && data.models.lanes) add('模型', `${ov ? esc([ov.model, ov.effort].filter(Boolean).join(' · ') || '—') + ' <small>(此航班覆寫)</small>' : '<small>跟隨航空公司設定</small>'} <button type="button" class="mdl-line" data-line="${esc(s.id)}" data-lane="${esc(CODE[s.airline.key] || '')}">⚙ 覆寫</button>`);
    if (s.reason) add('結束原因', esc(s.reason)); else if (s.lastEvent) add('最後事件', `<code>${esc(String(s.lastEvent).slice(0, 160))}</code>`);
    return `<dl>${rows.join('')}</dl>`;
  }
  function stripHTML(s) {
    const tags = (s.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const iss = (s.issueMeta || []).filter(m => m.n !== s.primary).slice(0, 3).map(m => `<a class="iss" href="${esc(m.url)}" target="_blank" rel="noopener" title="${esc(m.title || '')}">${esc(m.product ? m.product + ' ' : '')}#${esc(m.n)}</a>`).join('');
    const fade = s.status === 'LANDED' && s.endedAt && now() - s.endedAt > 30 * 60e3 ? ' fade' : '';   // dimmed after 30 min; the server hides GOOD DAY cards after goodDayHideHours (default 6 h)
    const pm = (s.issueMeta || []).find(m => m.n === s.primary);
    return `<li class="strip a-${s.airline.key} s-${s.status}${fade}${open.has(s.id) ? ' open' : ''}" data-id="${esc(s.id)}">
      <div class="band"></div><div class="main">
        <div class="flt">${fin(s.airline.key, 22)}${pm ? `<a class="fno" href="${esc(pm.url)}" target="_blank" rel="noopener" title="#${esc(pm.n)} ${esc(pm.title || '')}">${esc(s.flight)}</a>` : `<b class="fno">${esc(s.flight || s.airline.code)}</b>`}${prod(s.product)}<span class="aname">${esc(s.airline.name)}</span><span class="agentname">${esc(s.airline.agent || '')}</span></div>
        <div class="ttl" title="${esc(s.title)}">${esc(s.title || s.id)}</div><div class="line">${esc(s.callsign)}</div>
        <div class="time">${timeBlock(s)}</div>
        <div class="row"><span class="chip st-${s.status}">${CHIP[s.status](s)}</span>${iss}${tags}${s.bay === 'goodday' ? `<button type="button" class="dismiss" data-id="${esc(s.id)}" title="從 GOOD DAY 移除（5 秒內可撤銷）" aria-label="已知道，移除 ${esc(s.flight || s.id)}">✕ 已知道</button>` : ''}<button type="button" class="expand" aria-expanded="${open.has(s.id)}">${open.has(s.id) ? '收起 ▴' : '詳細 ▾'}</button></div>
      </div><div class="more">${detail(s)}</div></li>`;
  }
  function etdBlock(i) {
    const st = i.etdState, lab = { auto: '預計起飛', quota: '預計起飛', full: '等待空位', manual: '等你按 Takeoff', 'n/a': '無法派工' }[st] || '等待空位';
    const sub = st === 'quota' ? '等額度恢復' : st === 'auto' ? 'AUTO PILOT' : st === 'full' ? '滿載中' : st === 'manual' ? 'MANUAL' : '';
    return big(lab, flap(i.etd ? hm(i.etd) : '--:--')) + `<span>${sub ? sub + '<br>' : ''}排入 ${i.queuedAt ? hm(i.queuedAt) : hm(now())}</span>`;
  }
  function prod(p) { return p ? `<span class="prod"${p.color ? ` style="--pc:${esc(p.color)}"` : ''} title="${esc(p.name)}（${esc(p.repo)}）">${esc(p.short)}</span>` : ''; }
  function pshort(p) { return p ? p.short + ' ' : ''; }
  function manualHTML(i) {   // 實機驗證: needs a human on a real device — no handle, not draggable, no takeoff
    const ms = i.milestone ? `<span class="ms">${esc(i.milestone)}</span>` : '<span class="ms none">no milestone</span>';
    return `<li class="qitem manual" data-ref="${esc(i.ref)}" aria-disabled="true">
      <div class="band"></div><div class="main">
        <div class="flt"><b class="fno park">#${esc(i.number)}</b>${ms}${prod(i.product)}
          <a class="iss" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(pshort(i.product))}#${esc(i.number)} ↗</a></div>
        <div class="ttl">${esc(i.title || i.ref)}</div>
      </div>
      <div class="wstamp" title="需要實機 — 不能派給背景 agent"><span>🔧</span><small>實機</small></div></li>`;
  }
  function qitemHTML(i, lane) {
    const ms = i.milestone ? `<span class="ms">${esc(i.milestone)}</span>` : '<span class="ms none">no milestone</span>';
    const air = lane ? KEY[lane] : null;
    return `<li class="qitem${lane ? ' a-' + air : ''}" data-ref="${esc(i.ref)}" tabindex="-1">
      <div class="band"></div><div class="main">
        <div class="flt">${lane ? fin(air, 20) + `<b class="fno">${esc(i.flight || lane + ' ' + i.number)}</b>` : `<b class="fno park">#${esc(i.number)}</b>`}${ms}${prod(i.product)}
          <a class="iss" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(pshort(i.product))}#${esc(i.number)} ↗</a></div>
        <div class="ttl">${esc(i.title || i.ref)}</div>
        ${lane ? `<div class="time">${etdBlock(i)}</div>` : ''}
      </div>
      ${lane ? `<div class="tk"><button type="button" class="takeoff-btn" ${i.dispatchable === false ? 'disabled title="只能瀏覽：這台 Mac 上找不到這個 repo 的本機 clone"' : ''}>✈ Takeoff</button></div>` : ''}
      <button type="button" class="handle" aria-label="移動 #${esc(i.number)}：空白鍵拿起、上下鍵排序、左右鍵換跑道、空白鍵放下" aria-pressed="false" title="拖曳">≡</button></li>`;
  }

  // ---------- StarBase ----------
  function sbOpen() { try { const v = localStorage.getItem(SB_KEY); return v === null ? true : v === '1'; } catch { return true; } }
  function setSbOpen(on) {
    try { localStorage.setItem(SB_KEY, on ? '1' : '0'); } catch {}
    const el = $('#starbase'); if (!el) return;
    el.classList.toggle('collapsed', !on);
    document.body.classList.toggle('sb-on', on);
    const btn = $('#sb-toggle'); if (btn) { btn.setAttribute('aria-expanded', on); btn.textContent = on ? '▾' : '▸'; btn.title = on ? '收合 StarBase' : '展開 StarBase'; }
  }
  function reducedMotion() { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function sbAgo(t) {
    if (!t) return '—';
    const s = Math.max(0, Math.floor((now() - t) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h' + pad(Math.floor(s / 60) % 60);
  }
  function sbMain(tasks) {
    const live = tasks || [];
    const pick = st => live.filter(t => t.status === st).sort((a, b) => (b.updated_at || b.started_at || 0) - (a.updated_at || a.started_at || 0))[0];
    return pick('in_progress') || pick('queued') || pick('blocked') || null;
  }
  function sbLiftTask(agentName, tasks) {
    const list = tasks || [];
    if (reducedMotion()) { list.filter(t => t.status === 'done').forEach(t => sbPlayed.add(t.id)); return null; }
    const cur = sbLift.get(agentName);
    if (cur && now() < cur.until) return list.find(t => t.id === cur.id) || null;
    const cand = list.filter(t => t.status === 'done' && !sbPlayed.has(t.id));
    for (const t of cand) {
      const doneAt = t.done_at || t.updated_at;
      const recent = doneAt && (now() - doneAt) <= 90e3;
      const trans = sbPrev.get(t.id) && sbPrev.get(t.id) !== 'done';
      if (recent || trans) {
        sbLift.set(agentName, { id: t.id, until: now() + 2600 });
        clearTimeout(sbLiftTimer.get(agentName));
        sbLiftTimer.set(agentName, setTimeout(() => { sbPlayed.add(t.id); sbLift.delete(agentName); if (!busy) render(); }, 2700));
        return t;
      }
      sbPlayed.add(t.id);
    }
    return null;
  }
  const SB_CHIP = { queued: 'T- 待命', in_progress: '加注中', blocked: 'HOLD · 卡住', done: '已升空', empty: '待命' };
  function sbStars(seed) {
    let s = seed >>> 0, out = '';
    for (let i = 0; i < 42; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const x = s % 480;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const y = s % 118;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const r = 0.3 + (s % 8) / 16;
      out += `<circle class="sb-star t${(i % 3) + 1}" cx="${x}" cy="${y}" r="${r.toFixed(2)}" fill="#e8eef8"/>`;
    }
    return out;
  }
  function sbSky(id, seed) {
    return `<defs>
      <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05070e"/><stop offset=".55" stop-color="#101a2c"/><stop offset=".82" stop-color="#1a2436"/><stop offset="1" stop-color="#2a2218"/></linearGradient>
      <linearGradient id="${id}-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d949b"/><stop offset=".45" stop-color="#e4e7ea"/><stop offset="1" stop-color="#6e757c"/></linearGradient>
      <linearGradient id="${id}-white" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d8d4c8"/><stop offset=".5" stop-color="#f7f4ea"/><stop offset="1" stop-color="#c4c0b4"/></linearGradient>
      <radialGradient id="${id}-flood" cx=".5" cy="0" r="1"><stop offset="0" stop-color="#ffd48a" stop-opacity=".22"/><stop offset="1" stop-color="#ffd48a" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="480" height="150" fill="url(#${id}-sky)"/>${sbStars(seed)}
    <polygon points="0,20 70,122 20,122" fill="url(#${id}-flood)"/><polygon points="480,16 430,122 470,122" fill="url(#${id}-flood)"/>
    <rect x="0" y="122" width="480" height="28" fill="#1a1612"/><rect x="0" y="122" width="480" height="2" fill="#3a342c"/>
    <rect x="20" y="132" width="440" height="1" fill="#ffd48a" opacity=".28"/>
    <rect x="40" y="138" width="80" height="2" fill="#c9bc98" opacity=".35"/><rect x="200" y="138" width="90" height="2" fill="#c9bc98" opacity=".35"/><rect x="360" y="138" width="70" height="2" fill="#c9bc98" opacity=".35"/>
    <circle cx="28" cy="118" r="3.5" fill="#ffd48a" class="sb-lite"/><circle cx="452" cy="118" r="3.5" fill="#ffd48a" class="sb-lite"/>
    <g class="sb-far" opacity=".85">
      <rect x="392" y="86" width="22" height="36" rx="2" fill="#3a4048"/><rect x="418" y="74" width="18" height="48" rx="2" fill="#32383f"/>
      <ellipse cx="403" cy="86" rx="12" ry="5" fill="#4a515a"/><ellipse cx="427" cy="74" rx="10" ry="4" fill="#4a515a"/>
      <rect x="448" y="70" width="5" height="52" fill="#5a6570"/><circle cx="450.5" cy="66" r="6" fill="#cfd6dd" opacity=".35"/><circle cx="450.5" cy="66" r="2" fill="#ffd48a" class="sb-lite"/>
      <path d="M368 112 L380 88 L392 112 Z" fill="#2e353c"/><circle cx="380" cy="84" r="7" fill="none" stroke="#8a949e" stroke-width="1.4"/>
      <line x1="380" y1="77" x2="380" y2="91" stroke="#8a949e" stroke-width="1"/><line x1="373" y1="84" x2="387" y2="84" stroke="#8a949e" stroke-width="1"/>
    </g>`;
  }
  function sbStarship(id) {
    const mast = [18, 30, 42, 54, 66, 78, 90, 102];
    return `<g class="sb-tower">
      <rect x="232" y="10" width="18" height="112" fill="#4c5560"/>
      <rect x="228" y="8" width="26" height="8" fill="#6a7480"/>
      ${mast.map(y => `<line x1="232" y1="${y}" x2="250" y2="${y + 10}" stroke="#2e353c" stroke-width="1.6"/><line x1="250" y1="${y}" x2="232" y2="${y + 10}" stroke="#2e353c" stroke-width="1.6"/>`).join('')}
      <g class="sb-chop">
        <rect x="204" y="16" width="8" height="92" rx="2" fill="#c5ccd3" stroke="#6a7178" stroke-width=".6"/>
        <rect x="214" y="22" width="8" height="86" rx="2" fill="#b7bec6" stroke="#6a7178" stroke-width=".6"/>
        <rect x="210" y="20" width="24" height="6" fill="#8b949e"/>
        <rect x="210" y="70" width="24" height="6" fill="#8b949e"/>
      </g>
      <rect x="148" y="116" width="56" height="8" fill="#3a342c"/><rect x="152" y="114" width="48" height="4" fill="#5a5348"/>
    </g>
    <g class="sb-rocket">
      <path d="M180 4 L194 16 L166 16 Z" fill="url(#${id}-steel)" stroke="#6a7178" stroke-width=".5"/>
      <rect x="166" y="16" width="28" height="40" fill="url(#${id}-steel)" stroke="#6a7178" stroke-width=".5"/>
      <path d="M166 22 L158 30 L166 30 Z" fill="#9aa1a8"/><path d="M194 22 L202 30 L194 30 Z" fill="#9aa1a8"/>
      <path d="M166 46 L156 56 L166 56 Z" fill="#8a9198"/><path d="M194 46 L204 56 L194 56 Z" fill="#8a9198"/>
      <g class="sb-booster">
        <rect x="156" y="55" width="48" height="61" rx="3" fill="url(#${id}-steel)" stroke="#6a7178" stroke-width=".6"/>
        <rect x="160" y="62" width="40" height="2" fill="#6a7178" opacity=".5"/>
        <rect x="160" y="90" width="40" height="2" fill="#6a7178" opacity=".5"/>
      </g>
      ${[166, 180, 194].map(x => `<ellipse cx="${x}" cy="118" rx="6" ry="3" fill="#2a2a2a"/>`).join('')}
      <g class="sb-flame" transform="translate(180,120)"><ellipse cx="0" cy="10" rx="12" ry="16" fill="#ff7a2a"/><ellipse cx="0" cy="14" rx="6" ry="12" fill="#ffe08a"/></g>
    </g>`;
  }
  function sbFalcon(id) {
    const grid = (x, y) => `<g transform="translate(${x},${y})">
      <rect width="8" height="8" fill="#1a1a1a"/><path d="M0 2 H8 M0 4 H8 M0 6 H8 M2 0 V8 M4 0 V8 M6 0 V8" stroke="#888" stroke-width=".5"/>
    </g>`;
    return `<g class="sb-tower">
      <rect x="132" y="8" width="12" height="114" fill="#5a6570"/><rect x="128" y="8" width="20" height="7" fill="#6a7682"/>
      ${[20, 36, 52, 68, 84, 100].map(y => `<line x1="132" y1="${y}" x2="144" y2="${y + 10}" stroke="#2e353c" stroke-width="1.4"/>`).join('')}
      <rect class="sb-arm" x="144" y="48" width="36" height="4" fill="#c4a35a"/><rect x="176" y="44" width="6" height="12" fill="#8a7a48"/>
      <rect x="172" y="116" width="32" height="6" fill="#3a342c"/>
    </g>
    <g class="sb-rocket">
      <path d="M188 6 L196 22 L180 22 Z" fill="url(#${id}-white)" stroke="#c9c4b6" stroke-width=".5"/>
      <rect x="180" y="22" width="16" height="28" fill="url(#${id}-white)"/>
      <rect x="180" y="50" width="16" height="10" fill="#1a1a1a"/>
      <rect x="180" y="60" width="16" height="56" fill="url(#${id}-white)" stroke="#c9c4b6" stroke-width=".5"/>
      ${grid(172, 62)}${grid(196, 62)}${grid(172, 74)}${grid(196, 74)}
      <path d="M180 114 L172 122" stroke="#bbb" stroke-width="2"/><path d="M196 114 L204 122" stroke="#bbb" stroke-width="2"/>
      <ellipse cx="188" cy="118" rx="7" ry="3" fill="#2a2a2a"/>
      <g class="sb-flame" transform="translate(188,120)"><ellipse cx="0" cy="10" rx="8" ry="16" fill="#ff7a2a"/><ellipse cx="0" cy="14" rx="4" ry="12" fill="#ffe08a"/></g>
    </g>`;
  }
  function sbMcgregor(id) {
    return `<g class="sb-stand">
      <rect x="36" y="52" width="18" height="70" fill="#5a5348"/>
      <rect x="78" y="32" width="10" height="90" fill="#6a6e72"/><rect x="248" y="32" width="10" height="90" fill="#6a6e72"/>
      <rect x="78" y="32" width="180" height="10" fill="#8a8e92"/>
      <path d="M88 42 L248 88 M88 88 L248 42" stroke="#4a4e52" stroke-width="3"/>
      <rect x="70" y="112" width="200" height="10" fill="#3a342c"/>
      <path d="M258 96 L430 96 L430 122 L258 122 Z" fill="#2a241c"/>
      <rect x="258" y="96" width="172" height="4" fill="#4a4034"/>
    </g>
    <g class="sb-rocket sb-engine">
      <rect x="108" y="66" width="96" height="24" rx="4" fill="url(#${id}-steel)" stroke="#6a7178" stroke-width=".7"/>
      <rect x="118" y="70" width="16" height="16" fill="#3a3e42"/>
      <circle cx="126" cy="78" r="5" fill="#1a1a1a"/>
      <path class="sb-bell" d="M204 62 L252 52 L252 104 L204 94 Z" fill="#2e3236" stroke="#1a1a1a" stroke-width=".6"/>
      <circle cx="120" cy="118" r="6" fill="#222"/><circle cx="168" cy="118" r="6" fill="#222"/>
      <g class="sb-flame" transform="translate(252,78)"><ellipse cx="28" cy="0" rx="28" ry="14" fill="#ff7a2a"/><ellipse cx="36" cy="0" rx="22" ry="8" fill="#ffe08a"/></g>
    </g>`;
  }
  const SB_VEH = { starship: sbStarship, falcon9: sbFalcon, mcgregor: sbMcgregor };
  function sbMini() {
    return `<svg class="sb-mini" viewBox="0 0 10 16" aria-hidden="true"><path d="M5 1 L8 5 L8 13 L2 13 L2 5 Z" fill="#6b675a"/><rect x="3" y="13" width="4" height="2" fill="#8a5a00"/></svg>`;
  }
  function sbTaskRow(t, isMain) {
    const stClass = t.status === 'in_progress' ? 'TAKEOFF' : t.status === 'blocked' ? 'DIVERTED' : t.status === 'done' ? 'LANDED' : 'SCHEDULED';
    const mini = !isMain && t.status !== 'done' ? sbMini() : '';
    const chip = `<span class="sb-left">${mini}<span class="chip st-${stClass}">${esc(t.statusZh || SB_CHIP[t.status] || t.status)}</span></span>`;
    const tip = esc(t.task) + (t.note ? ' — ' + esc(t.note) : '');
    const title = t.link
      ? `<a class="ttl" href="${esc(t.link)}" target="_blank" rel="noopener" title="${tip}">${esc(t.task)}</a>`
      : `<span class="ttl" title="${tip}">${esc(t.task)}</span>`;
    const whenT = t.status === 'done' ? (t.done_at || t.updated_at) : (t.started_at || t.updated_at);
    return `<li class="sb-task ${t.status}${isMain ? ' main' : ''}" title="${tip}">${chip}${title}<span class="when" data-sb-elapsed="${whenT || ''}">${sbAgo(whenT)}</span></li>`;
  }
  function sbPad(agent) {
    const tasks = agent.tasks || [];
    const lifting = sbLiftTask(agent.name, tasks);
    const main = lifting || sbMain(tasks);
    const state = lifting ? 'liftoff' : !main ? 'empty' : main.status === 'in_progress' ? 'fueling' : main.status === 'blocked' ? 'hold' : main.status === 'queued' ? 'queued' : 'empty';
    const chipKind = lifting ? 'TAKEOFF' : !main ? 'SCHEDULED' : main.status === 'in_progress' ? 'TAKEOFF' : main.status === 'blocked' ? 'DIVERTED' : 'SCHEDULED';
    const chipTxt = lifting ? '升空' : SB_CHIP[main ? main.status : 'empty'];
    const live = tasks.filter(t => t.status !== 'done');
    const flown = tasks.filter(t => t.status === 'done' && !(lifting && t.id === lifting.id));
    const hideH = (data.starbase && data.starbase.hideHours) || 6;
    const flownShow = flown.filter(t => {
      const t0 = t.done_at || t.updated_at; return !t0 || (now() - t0) <= hideH * 3600e3;
    });
    const id = 'sb-' + agent.vehicle;
    const veh = (SB_VEH[agent.vehicle] || sbStarship)(id);
    const seed = agent.vehicle === 'starship' ? 7 : agent.vehicle === 'falcon9' ? 19 : 31;
    const fuelStart = main && main.status === 'in_progress' ? (main.started_at || now()) : '';
    const liveRows = [];
    if (main && !lifting) liveRows.push(sbTaskRow(main, true));
    live.filter(t => !main || t.id !== main.id).forEach(t => liveRows.push(sbTaskRow(t, false)));
    const extraN = Math.max(0, liveRows.length - 2);
    const shownLive = liveRows.slice(0, 2);
    tasks.forEach(t => sbPrev.set(t.id, t.status));
    return `<article class="sb-pad" data-agent="${esc(agent.name)}">
      <header class="sb-pad-head"><span class="nm">${esc(agent.name)}</span><span class="role">${esc(agent.role || '')}</span>
        <span class="chip st-${chipKind}">${esc(chipTxt)}</span><span class="count">${live.length}</span></header>
      <div class="sb-scene ${esc(agent.vehicle)} ${state}">
        <svg viewBox="0 0 480 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${sbSky(id, seed)}${veh}</svg>
        <div class="sb-steam"><i></i><i></i><i></i></div><div class="sb-plume"></div>
        <div class="sb-fuel" data-sb-fuel="${fuelStart}" style="--p:18%"><i class="sb-fuel-bar"><b></b></i><span>加注中</span></div>
        <div class="sb-hold-bar"></div><div class="sb-hold-tag">HOLD · 卡住</div>
        <div class="sb-empty">發射台待命</div>
      </div>
      ${agent.error ? `<p class="sb-err">讀檔容錯：${esc(agent.error)}</p>` : ''}
      <div class="sb-lists">
        <ol class="sb-list">${shownLive.join('')}</ol>
        ${extraN ? `<div class="sb-more">＋${extraN}</div>` : ''}
        ${flownShow.length ? `<div class="sb-flown-lab">已升空</div><ol class="sb-flown">${flownShow.map(t => sbTaskRow(t, false)).join('')}</ol>` : ''}
      </div>
    </article>`;
  }
  function renderStarbase() {
    const sb = data && data.starbase;
    const host = $('#sb-pads'); if (!host) return;
    if (!sb || !sb.agents) { host.innerHTML = ''; $('#sb-count').textContent = '0'; return; }
    const n = sb.agents.reduce((s, a) => s + ((a.tasks || []).filter(t => t.status !== 'done').length), 0);
    $('#sb-count').textContent = n;
    host.innerHTML = sb.agents.map(sbPad).join('');
  }

  // ---------- render ----------
  function render() {
    pendingRender = false; if (!data) return;
    renderStarbase();
    const focusRef = document.activeElement && document.activeElement.closest && document.activeElement.closest('.qitem') ? document.activeElement.closest('.qitem').dataset.ref : null;
    const strips = data.strips || [];
    // PARK
    const park = (data.park && data.park.issues) || [];
    const sel = $('#f-repo'); const repos = (data.park && data.park.repos) || [];
    sel.innerHTML = repos.map(r => `<option value="${esc(r)}"${r === filt.repo ? ' selected' : ''}>${esc(r.split('/')[1])}</option>`).join('') + `<option value="*"${filt.repo === '*' ? ' selected' : ''}>全部 repo</option>`;
    const inRepo = park.filter(i => filt.repo === '*' || i.repo === filt.repo);
    const mss = [...new Set(inRepo.map(i => i.milestone || '—'))];
    $('#f-ms').innerHTML = `<option value="">全部 milestone</option>` + mss.map(m => `<option value="${esc(m)}"${m === filt.ms ? ' selected' : ''}>${esc(m)}</option>`).join('');
    const q = filt.q.trim().toLowerCase();
    const shown = inRepo.filter(i => (!filt.ms || (i.milestone || '—') === filt.ms) && (!q || (i.title || '').toLowerCase().includes(q) || String(i.number).includes(q.replace('#', ''))));
    $('#park-rack').innerHTML = shown.map(i => qitemHTML(i, null)).join('');
    $('#park-count').textContent = shown.length + (shown.length !== park.length ? '/' + park.length : '');
    // 實機驗證 (needs a real device): same filters, separate collapsible section, never draggable
    const man = (data.park && data.park.manual) || [];
    const manShown = man.filter(i => (filt.repo === '*' || i.repo === filt.repo) && (!filt.ms || (i.milestone || '—') === filt.ms) && (!q || (i.title || '').toLowerCase().includes(q) || String(i.number).includes(q.replace('#', ''))));
    const msec = $('#manual-sec'); msec.hidden = !man.length;
    if (data.park && data.park.manualTitle) $('#manual-title').textContent = data.park.manualTitle;
    $('#manual-rack').innerHTML = manShown.map(manualHTML).join('');
    $('#manual-count').textContent = manShown.length + (manShown.length !== man.length ? '/' + man.length : '');
    // READY lanes
    const cap = data.capacity || { lanes: {} }; const lc = data.laneCfg || {}; const set = data.settings || { auto: {} };
    $('#lanes').innerHTML = LANES.map(k => {
      const c = cap.lanes[k] || { running: 0, cap: '?' }; const cfg = lc[k] || {}; const items = (data.lanes && data.lanes[k]) || [];
      const active = strips.filter(s => s.bay === 'ready' && CODE[s.airline.key] === k);
      const autoBtn = cfg.manualOnly ? `<span class="lock" title="manual Takeoff only">🔒 手動 · ${esc(cfg.idleLabel || 'manual only')}</span>`
        : `<button type="button" class="auto-sw ${set.auto[k] ? 'on' : ''}" data-lane="${k}" aria-pressed="${!!set.auto[k]}">AUTO ${set.auto[k] ? 'ON' : 'OFF'}</button>`;
      return `<section class="lane a-${KEY[k]}" data-lane="${k}">
        <header>${fin(KEY[k], 22)}<b class="fno">${k}</b><span class="aname">${esc(cfg.airline || '')}</span>
          ${mdlChip(k)}<span class="capb ${c.running >= c.cap ? 'full' : ''}${c.holding ? ' hold' : ''}" title="running runners / cap">${c.running}/${c.cap}${c.holding ? ' · HOLD ' + hm(c.until) : ''}</span>${autoBtn}</header>
        ${active.length ? `<ol class="lane-active">${active.map(stripHTML).join('')}</ol>` : ''}
        <ol class="rack lane-rack" data-drop="${k}" data-empty="拖 PARK 卡片到這裡排班">${items.map(i => qitemHTML(i, k)).join('')}</ol></section>`;
    }).join('');
    $('#ready-count').textContent = LANES.reduce((n, k) => n + ((data.lanes && data.lanes[k]) || []).length, 0);
    // TAKEOFF / GOOD DAY
    const take = strips.filter(s => s.bay === 'takeoff').sort((a, b) => (a.std || 0) - (b.std || 0));
    const RANK = { DIVERTED: 0, LANDED: 1, STOPPED: 2 };
    const gd = strips.filter(s => s.bay === 'goodday').sort((a, b) => RANK[a.status] - RANK[b.status] || (b.endedAt || 0) - (a.endedAt || 0));
    const sched = strips.filter(s => s.bay === 'park');   // runner alive but waiting for its start time
    $('#takeoff-rack').innerHTML = take.map(stripHTML).join('');
    $('#takeoff-count').textContent = take.length;
    $('#goodday-rack').innerHTML = gd.map(stripHTML).join('');
    $('#goodday-count').textContent = gd.length;
    $('#park-sched').innerHTML = sched.map(stripHTML).join('');
    const div = gd.filter(s => s.status === 'DIVERTED');
    const al = $('#alert'); al.hidden = !div.length;
    al.innerHTML = div.length ? `<b>⚠ ${div.length} DIVERTED</b> — runner 結束但未達「可整合」：${div.map(s => esc(s.flight + ' ' + (s.title || s.id))).join('、')}` : '';
    // header: mode, airlines, autopilot hint
    $('#mode').querySelectorAll('button').forEach(b => { const on = b.dataset.mode === set.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    $('#airlines').innerHTML = LANES.map(k => {
      const mine = strips.filter(s => CODE[s.airline.key] === k); const fly = mine.filter(s => s.status === 'TAKEOFF').length; const rest = mine.filter(s => s.status === 'TAXI' || s.status === 'HOLDING').length;
      const queued = ((data.lanes && data.lanes[k]) || []).length; const cfg = lc[k] || {};
      const txt = (fly || rest) ? `<span class="n">${fly}</span> 飛行中${rest ? ` · <span class="n">${rest}</span> 休息中` : ''}` : (cfg.manualOnly ? esc(cfg.idleLabel || 'manual only') + ' · <span class="n">0</span>' : '閒置 · <span class="n">0</span>');
      return `<span class="airline ${fly ? 'busy' : ''}">${fin(KEY[k], 20)}<span class="code">${k}</span><b>${esc(cfg.airline || k)}</b> · ${txt}${queued ? ` · ${queued} 排班` : ''}</span>`;
    }).join('');
    const ap = data.autopilot || {}; const nx = ap.next;
    $('#ap-hint').innerHTML = set.mode !== 'AUTO' ? 'MANUAL — 在 READY 按 ✈ Takeoff 起飛'
      : !nx ? 'AUTO PILOT · 沒有可自動起飛的排班'
      : nx.blocked ? `AUTO PILOT · 下一班 <b>${esc(nx.flight)}</b> 等待：${esc(nx.blocked)}` : `AUTO PILOT · 下一班 <b>${esc(nx.flight)}</b> 在 ${hm(nx.eta)}`;
    if (ap.note) $('#ap-hint').innerHTML += ` <small>· ${esc(ap.note)}</small>`;
    if (focusRef) { const h = document.querySelector(`.qitem[data-ref="${CSS.escape(focusRef)}"] .handle`); h && h.focus(); }
    tick();
  }

  // ---------- filters / toggles / expand ----------
  function saveFilt() { localStorage.setItem('tower.filter', JSON.stringify(filt)); render(); }
  { const m = $('#manual-sec'); try { m.open = localStorage.getItem('tower.manualOpen') === '1'; } catch {} m.addEventListener('toggle', () => { try { localStorage.setItem('tower.manualOpen', m.open ? '1' : '0'); } catch {} }); }
  { const btn = $('#sb-toggle'); if (btn) btn.addEventListener('click', () => setSbOpen(!sbOpen())); setSbOpen(sbOpen()); }
  $('#f-q').value = filt.q;
  $('#f-q').addEventListener('input', e => { filt.q = e.target.value; saveFilt(); });
  $('#f-ms').addEventListener('change', e => { filt.ms = e.target.value; saveFilt(); });
  $('#f-repo').addEventListener('change', e => { filt.repo = e.target.value; filt.ms = ''; saveFilt(); });
  $('#mode').addEventListener('click', async e => { const b = e.target.closest('button'); if (!b) return;
    try { await post('/api/settings', { mode: b.dataset.mode }); toast(b.dataset.mode === 'AUTO' ? 'AUTO PILOT 開啟' : 'MANUAL'); load(); } catch (er) { toast('設定失敗：' + er.message, 'err'); } });
  document.addEventListener('click', async e => {
    const sw = e.target.closest('.auto-sw');
    if (sw) { const k = sw.dataset.lane; const cur = data.settings.auto[k]; try { await post('/api/settings', { auto: { [k]: !cur } }); load(); } catch (er) { toast(er.message, 'err'); } return; }
    const tb = e.target.closest('.takeoff-btn'); if (tb) { openConfirm(tb); return; }
    const dm = e.target.closest('.dismiss');
    if (dm) { const id = dm.dataset.id; const st = (data.strips || []).find(x => x.id === id); const label = st ? (st.flight || id) : id;
      data.strips = (data.strips || []).filter(x => x.id !== id); render(); showUndo({ dismiss: id, label }); announce(`${label} 已從 GOOD DAY 移除`);
      try { await post('/api/dismiss', { id }); } catch (er) { toast('移除失敗：' + er.message, 'err'); load(); } return; }
    const mb = e.target.closest('.mdl, .mdl-line'); if (mb) { openModels(mb); return; }
    if (e.target.closest('.handle, a, button, .pop')) { if (!e.target.closest('.expand')) return; }
    const li = e.target.closest('.strip'); if (!li) return;
    const id = li.dataset.id; open.has(id) ? open.delete(id) : open.add(id); li.classList.toggle('open', open.has(id));
    const b = li.querySelector('.expand'); if (b) { b.setAttribute('aria-expanded', open.has(id)); b.textContent = open.has(id) ? '收起 ▴' : '詳細 ▾'; }
  });

  // ---------- model / effort popover ----------
  function mdlText(m) { return [m.model || 'CLI 預設', m.effort].filter(Boolean).join(' · '); }
  function mdlChip(k) {
    const m = data.models && data.models.lanes && data.models.lanes[k]; if (!m) return '';
    return `<button type="button" class="mdl ${m.effective.source === 'tower' ? 'set' : ''}" data-lane="${k}" title="模型與推理強度（下一輪生效）">⚙ ${esc(mdlText(m.effective))}</button>`;
  }
  function openModels(btn) {
    const k = btn.dataset.lane, line = btn.dataset.line || null; const m = data.models.lanes[k]; if (!m) return;
    const cur = line ? (data.models.overrides[line] || {}) : m.set; const cat = m.catalog;
    closePop(); busy = true;
    const pop = document.createElement('div'); pop.className = 'pop'; pop.setAttribute('role', 'dialog');
    const effOpts = model => { const l = (cat.perModel && model && cat.perModel[model]) || cat.efforts || []; return l; };
    const base = line ? `航空公司設定（${esc(mdlText(m.effective))}）` : `runner／CLI 預設（${esc(mdlText({ model: m.runnerDefault.model || (m.effective.source !== 'tower' ? m.effective.model : null), effort: m.runnerDefault.effort || (m.effective.source !== 'tower' ? m.effective.effort : null) }))}）`;
    const draw = () => {
      const model = pop.querySelector('#m-model') ? pop.querySelector('#m-model').value : cur.model || '';
      const effort = pop.querySelector('#m-eff') ? pop.querySelector('#m-eff').value : cur.effort || '';
      const effs = effOpts(model || m.effective.model);
      pop.innerHTML = `<div class="pop-title">${fin(KEY[k], 22)} ${line ? esc(line) + ' 模型覆寫' : esc(k) + ' ' + esc((data.laneCfg[k] || {}).airline || '') + ' 模型'}</div>
        <label class="fld">模型<select id="m-model"><option value="">${base}</option>${cat.models.map(x => `<option value="${esc(x)}"${x === model ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label class="fld">推理強度 effort<select id="m-eff"><option value="">預設</option>${effs.map(x => `<option value="${esc(x)}"${x === effort ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        ${cat.note ? `<p class="hint">${esc(cat.note)}</p>` : ''}${cat.error ? `<p class="warn">⚠ 讀不到 CLI 模型清單：${esc(cat.error)}</p>` : ''}
        <p class="hint">⏱ 下一輪生效 — 正在跑的 agent 不會被中斷。${data.models.hook ? '' : '<br>第一次儲存會在 runner 腳本加入讀設定的 hook（先備份、bash -n 檢查）；在那之前就已啟動的 runner 要等下次重新啟動才會套用。'}</p>
        <div class="pop-actions"><button type="button" class="cancel">取消</button><button type="button" class="go save">儲存</button></div>`;
      pop.querySelector('#m-model').onchange = draw;
      pop.querySelector('.cancel').onclick = closePop;
      pop.querySelector('.save').onclick = async () => {
        const body = { model: pop.querySelector('#m-model').value || null, effort: pop.querySelector('#m-eff').value || null }; if (line) body.line = line; else body.lane = k;
        try { await post('/api/models', body); closePop(); toast(`⚙ ${line || k} 模型設定已儲存：${mdlText({ model: body.model || '預設', effort: body.effort })} — 下一輪生效`); load(); }
        catch (er) { pop.querySelector('.pop-actions').insertAdjacentHTML('beforebegin', `<p class="warn err">✖ ${esc(er.message)}</p>`); }
      };
      place(pop, btn);
    };
    document.body.appendChild(pop); draw(); pop.querySelector('#m-model').focus();
  }

  function uniqMsgs(arr) {
    const out = []; const seen = new Set();
    for (const x of arr || []) { const s = String(x); if (seen.has(s)) continue; seen.add(s); out.push(s); }
    return out;
  }
  function jumpToStrip(id) {
    closePop();
    const el = document.querySelector(`.strip[data-id="${CSS.escape(id)}"]`);
    if (!el) { toast('找不到卡片 ' + id, 'err'); return; }
    el.classList.add('jump');
    el.scrollIntoView({ block: 'center' });
    setTimeout(() => el.classList.remove('jump'), 2500);
  }
  // ---------- takeoff confirm popover ----------
  async function openConfirm(btn) {
    const li = btn.closest('.qitem'); const ref = li.dataset.ref; const lane = li.closest('[data-drop]').dataset.drop;
    closePop(); busy = true;
    const pop = document.createElement('div'); pop.className = 'pop'; pop.setAttribute('role', 'dialog'); pop.innerHTML = '<div class="pop-body">讀取中…</div>';
    document.body.appendChild(pop); place(pop, btn);
    try {
      const p = await post('/api/preview', { ref, lane });
      const warns = uniqMsgs(p.warn || []);
      const flying = p.flying && p.line;
      pop.innerHTML = `<div class="pop-title">${fin(KEY[lane], 22)} 確認起飛 ${esc(lane)} ${esc(p.issue ? p.issue.number : '')}</div>
        <dl><dt>Agent</dt><dd>${esc(p.airline)} · ${esc(p.agent)}</dd><dt>Issue</dt><dd>#${esc(p.issue.number)} ${esc(p.issue.title)}</dd>
        <dt>Branch</dt><dd><code>${esc(p.branch)}</code></dd><dt>Line</dt><dd><code>${esc(p.line)}</code></dd><dt>Base</dt><dd><code>${esc(p.base)}</code></dd>${p.product ? `<dt>Product</dt><dd>${prod(p.product)} ${esc(p.product.name)} <small>${esc(p.repo)}</small></dd>` : ''}</dl>
        ${warns.map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join('')}
        <div class="pop-actions">${flying ? `<button type="button" class="jump-btn" title="這條已經在飛">跳到該卡片</button>` : ''}<button type="button" class="cancel">取消</button><button type="button" class="go"${flying ? ' disabled' : ''}>✈ 確認起飛</button></div>`;
      place(pop, btn);
      pop.querySelector('.cancel').onclick = closePop;
      const jb = pop.querySelector('.jump-btn'); if (jb) jb.onclick = () => jumpToStrip(p.line);
      const go = pop.querySelector('.go'); if (go && !flying) go.focus();
      if (go) go.onclick = async () => {
        go.disabled = true; go.textContent = '起飛中…（建立 worktree、寫 prompt、啟動 runner）';
        try {
          const r = await post('/api/takeoff', { ref, lane }); closePop();
          toast(r.reuse ? `✈ 重用 ${r.line} 起飛（既有 worktree／branch）` : `✈ ${lane} ${ref.split('#')[1]} 已起飛 → ${r.line}（${r.branch}）。看到 agent 程序後會移到 TAKEOFF。`);
          load();
        } catch (er) {
          go.disabled = false; go.textContent = '✈ 重試';
          pop.querySelectorAll('.warn.err').forEach(n => n.remove());
          const fly = er.data && er.data.flying && er.data.line;
          const msg = uniqMsgs([er.message])[0];
          pop.querySelector('.pop-actions').insertAdjacentHTML('beforebegin', `<p class="warn err">✖ ${esc(msg)}${er.data && er.data.steps && er.data.steps.length ? '<br>已完成：' + esc(er.data.steps.join('；')) : ''}</p>`);
          if (fly && !pop.querySelector('.jump-btn')) {
            pop.querySelector('.pop-actions').insertAdjacentHTML('afterbegin', `<button type="button" class="jump-btn" title="這條已經在飛">跳到該卡片</button>`);
            pop.querySelector('.jump-btn').onclick = () => jumpToStrip(er.data.line);
          }
        }
      };
    } catch (er) { pop.innerHTML = `<p class="warn err">✖ ${esc(er.message)}</p><div class="pop-actions"><button type="button" class="cancel">關閉</button></div>`; pop.querySelector('.cancel').onclick = closePop; }
  }
  function place(pop, btn) { const r = btn.getBoundingClientRect(); const w = Math.min(380, innerWidth - 24); pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px'; const h = pop.offsetHeight; pop.style.top = (r.bottom + h + 12 < innerHeight ? r.bottom + 8 : Math.max(12, r.top - h - 8)) + 'px'; }
  function closePop() { document.querySelectorAll('.pop').forEach(p => p.remove()); busy = false; }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.pop')) closePop(); });

  // ---------- lanes state from DOM ----------
  const lanesFromDOM = () => Object.fromEntries(LANES.map(k => [k, [...document.querySelectorAll(`.lane-rack[data-drop=${k}] > .qitem`)].map(li => li.dataset.ref)]));
  const curLanes = () => Object.fromEntries(LANES.map(k => [k, ((data.lanes && data.lanes[k]) || []).map(i => i.ref)]));
  async function commitLanes(before, after, ref, from, to) {
    if (JSON.stringify(before) === JSON.stringify(after)) { render(); announce('沒有變更'); return; }
    // optimistic local update
    const byRef = {}; (data.park.issues || []).forEach(i => { byRef[i.ref] = i; }); LANES.forEach(k => (data.lanes[k] || []).forEach(i => { byRef[i.ref] = i; }));
    for (const k of LANES) data.lanes[k] = after[k].map(r => ({ ...byRef[r], flight: `${k} ${byRef[r] && byRef[r].product && data.products && byRef[r].product.short !== data.products.primary ? byRef[r].product.short + '-' : ''}${r.split('#')[1]}` }));
    const inLanes = new Set(Object.values(after).flat()); data.park.issues = Object.values(byRef).filter(i => !inLanes.has(i.ref)).sort((a, b) => (a.milestone || '~').localeCompare(b.milestone || '~', undefined, { numeric: true }) || a.number - b.number);
    render(); showUndo(before);
    announce(to === 'park' ? `#${ref.split('#')[1]} 移回 PARK` : `#${ref.split('#')[1]} 排入 ${to} 第 ${after[to].indexOf(ref) + 1} 位`);
    try { await post('/api/lanes', { lanes: after }); load(); } catch (e) { toast('儲存失敗：' + e.message, 'err'); }
  }
  function showUndo(before) {
    undoState = before && before.dismiss ? before : { lanes: before }; const u = $('#undo'); u.hidden = false;
    $('#undo-btn').textContent = undoState.dismiss ? `↩ 撤銷：把 ${undoState.label} 放回 GOOD DAY` : '↩ 撤銷剛才的排序調整';
    const bar = u.querySelector('.undo-bar'); bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
    clearTimeout(undoTimer); undoTimer = setTimeout(() => { u.hidden = true; undoState = null; }, 5000);
  }
  $('#undo-btn').addEventListener('click', async () => {
    if (!undoState) return; const before = undoState; undoState = null; $('#undo').hidden = true; clearTimeout(undoTimer);
    if (before.dismiss) { try { await post('/api/dismiss', { id: before.dismiss, undo: true }); } catch (e) { toast(e.message, 'err'); } announce('已放回 GOOD DAY'); load(); return; }
    try { await post('/api/lanes', { lanes: before.lanes }); } catch (e) {} announce('排程已撤銷'); load();
  });

  // ---------- placeholder hint ----------
  function hint(ph, ref, from, to, beforeIds) {
    const rack = ph.parentElement; const n = ref.split('#')[1];
    if (to === 'park') { ph.textContent = `↩ #${n} 移回 PARK（取消排班）`; return; }
    const after = [...rack.children].filter(x => x === ph || (x.classList.contains('qitem') && !x.classList.contains('lifted'))).map(x => x === ph ? ref : x.dataset.ref);
    const pos = after.indexOf(ref) + 1; const name = (data.laneCfg && data.laneCfg[to] || {}).airline || to;
    let msg, delayed;
    if (from === to) {
      if (JSON.stringify(after) === JSON.stringify(beforeIds)) { ph.textContent = '原位置 · 沒有變更'; return; }
      delayed = after.filter((r, i) => r !== ref && i > beforeIds.indexOf(r));
      if (!delayed.length) delayed = [ref];
      msg = `${to} 第 ${pos} 位`;
    } else { delayed = after.slice(pos); msg = `${from === 'park' ? '排入' : '改派'} ${to} ${name} 第 ${pos} 位`; }
    ph.textContent = msg + (delayed.length ? ` · ⟂ ${to} ${delayed[0].split('#')[1]}${delayed.length > 1 ? ' +' + (delayed.length - 1) : ''} will be delayed` : '');
  }

  // ---------- pointer drag (handle only; PARK ↔ lanes, within lanes) ----------
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const h = e.target.closest('.qitem .handle'); if (!h || e.button !== 0 || FROZEN && !qs.has('dragtest')) return;
    const li = h.closest('.qitem'); const rack = li.closest('[data-drop]');
    e.preventDefault(); h.setPointerCapture(e.pointerId);
    const r = li.getBoundingClientRect(); const from = rack.dataset.drop;
    const ph = document.createElement('li'); ph.className = 'placeholder'; ph.style.minHeight = Math.min(r.height, 90) + 'px';
    const beforeIds = [...rack.querySelectorAll(':scope > .qitem')].map(x => x.dataset.ref);
    li.after(ph); document.body.appendChild(li);
    li.classList.add('lifted'); li.style.width = r.width + 'px'; li.style.left = r.left + 'px'; li.style.top = r.top + 'px';
    drag = { li, ph, from, to: from, ref: li.dataset.ref, dy: e.clientY - r.top, dx: e.clientX - r.left, before: curLanes(), beforeIds };
    busy = true; document.body.classList.add('dragging'); hint(ph, drag.ref, from, from, beforeIds);
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return; const { li, ph } = drag;
    if (e.clientY > innerHeight - 50) scrollBy(0, 14); else if (e.clientY < 50) scrollBy(0, -14);   // auto-scroll near edges
    li.style.top = (e.clientY - drag.dy) + 'px'; li.style.left = (e.clientX - drag.dx) + 'px';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const zone = el && (el.closest('[data-drop]') || (el.closest('.lane') && el.closest('.lane').querySelector('[data-drop]')) || (el.closest('.bay[data-bay=park]') && $('#park-rack')));
    document.querySelectorAll('.no-drop').forEach(x => x.classList.remove('no-drop'));
    if (!zone) { const bay = el && el.closest('.bay'); if (bay) bay.classList.add('no-drop'); drag.to = null; ph.textContent = '✖ 不能放在這裡（TAKEOFF／GOOD DAY 由系統管理）'; return; }
    const to = zone.dataset.drop; drag.to = to;
    if (to === 'park') { if (ph.parentElement !== zone) zone.prepend(ph); }
    else {
      const sibs = [...zone.querySelectorAll(':scope > .qitem')];
      let target = null; for (const s of sibs) { const b = s.getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { target = s; break; } }
      if (target) { if (ph.nextElementSibling !== target) zone.insertBefore(ph, target); } else if (ph.parentElement !== zone || ph !== zone.lastElementChild) zone.appendChild(ph);
    }
    hint(ph, drag.ref, drag.from, to, to === drag.from ? drag.beforeIds : []);
  });
  function endDrag(cancel) {
    if (!drag) return; const d = drag; drag = null;
    document.querySelectorAll('.no-drop').forEach(x => x.classList.remove('no-drop')); document.body.classList.remove('dragging');
    d.li.remove(); const to = cancel ? null : d.to;
    if (!to) { d.ph.remove(); busy = false; render(); announce('已取消'); return; }
    const after = JSON.parse(JSON.stringify(d.before)); if (d.from !== 'park') after[d.from] = after[d.from].filter(r => r !== d.ref);
    if (to !== 'park') { const zone = d.ph.parentElement; const ids = [...zone.children].filter(x => x === d.ph || x.classList.contains('qitem')).map(x => x === d.ph ? d.ref : x.dataset.ref); after[to] = ids.filter((r, i, a) => a.indexOf(r) === i); }
    d.ph.remove(); busy = false; commitLanes(d.before, after, d.ref, d.from, to);
  }
  document.addEventListener('pointerup', () => endDrag(false));
  document.addEventListener('pointercancel', () => endDrag(true));

  // ---------- keyboard: space pick · ↑↓ reorder · ←→ change lane/PARK · space drop · esc cancel ----------
  let kb = null; const ZONES = ['park', ...LANES];
  document.addEventListener('keydown', e => {
    const h = e.target.closest && e.target.closest('.qitem .handle'); if (!h) return;
    const li = h.closest('.qitem');
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!kb) { kb = { ref: li.dataset.ref, from: li.closest('[data-drop]').dataset.drop, before: curLanes() }; busy = true; li.classList.add('picked'); h.setAttribute('aria-pressed', 'true'); announce(`拿起 #${kb.ref.split('#')[1]}：上下鍵排序、左右鍵換跑道、空白鍵放下、Esc 取消`); }
      else { const k = kb; kb = null; li.classList.remove('picked'); busy = false; const to = li.closest('[data-drop]').dataset.drop; const after = lanesFromDOM(); commitLanes(k.before, after, k.ref, k.from, to); }
    } else if (kb && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); const rack = li.parentElement; if (rack.dataset.drop === 'park') return;
      if (e.key === 'ArrowUp' && li.previousElementSibling) rack.insertBefore(li, li.previousElementSibling); else if (e.key === 'ArrowDown' && li.nextElementSibling) li.nextElementSibling.after(li);
      h.focus(); announce(`${rack.dataset.drop} 第 ${[...rack.children].indexOf(li) + 1} 位`);
    } else if (kb && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); const cur = li.closest('[data-drop]').dataset.drop; const i = ZONES.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : -1); if (i < 0 || i >= ZONES.length) { announce('不能移到 TAKEOFF／GOOD DAY'); return; }
      const z = ZONES[i]; const rack = z === 'park' ? $('#park-rack') : document.querySelector(`.lane-rack[data-drop=${z}]`); if (z === 'park') rack.prepend(li); else rack.appendChild(li);
      h.focus(); announce(z === 'park' ? '移回 PARK' : `排入 ${z}`);
    } else if (kb && e.key === 'Escape') { e.preventDefault(); kb = null; busy = false; render(); announce('已取消'); }
  });

  setInterval(() => { if (!busy && pendingRender) render(); }, 500);
  load(); if (!FROZEN) setInterval(load, POLL);
  tick();
})();
