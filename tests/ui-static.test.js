'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const player = fs.readFileSync(path.join(ROOT, 'public', 'starbase', 'player.html'), 'utf8');
const bridge = fs.readFileSync(path.join(ROOT, 'public', 'starbase', 'bridge.js'), 'utf8');
const state = fs.readFileSync(path.join(ROOT, 'public', 'starbase-state.js'), 'utf8');
const extract = fs.readFileSync(path.join(ROOT, 'tools', 'extract-starbase.js'), 'utf8');
const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
const compact = s => s.replace(/\s+/g, '');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

check('bays are equal-width 4 columns', () => {
  if (!/\.bays\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(compact(css))) throw new Error('bays grid');
});

check('narrow breakpoints kept', () => {
  const c = compact(css);
  if (!c.includes('@media(max-width:1180px){.bays{grid-template-columns:repeat(2,minmax(0,1fr))}}')) throw new Error('1180');
  if (!c.includes('@media(max-width:640px){.bays{grid-template-columns:1fr}')) throw new Error('640');
});

check('two full-screen views Tower / StarBase', () => {
  if (!/id="view-tower"/.test(html)) throw new Error('view-tower');
  if (!/id="view-starbase"/.test(html)) throw new Error('view-starbase');
  if (!/id="tower-title"/.test(html) || !/id="sb-title"/.test(html)) throw new Error('title buttons');
  if (!/aria-label="切換到 StarBase 模式"/.test(html)) throw new Error('tower aria-label');
  if (!/aria-label="切換到 Tower 模式"/.test(html)) throw new Error('sb aria-label');
  if (!/inert/.test(html)) throw new Error('inert on hidden view');
  if (!/tower\.view/.test(js)) throw new Error('localStorage tower.view');
  if (!/\.view-tower/.test(css) || !/\.view-starbase/.test(css)) throw new Error('view css');
  if (!/rotateX/.test(css)) throw new Error('flip rotateX');
  if (!/body\.flipping/.test(css) && !/classList\.add\('flipping'\)/.test(js)) throw new Error('flipping class');
});

check('header version is v0.3.1', () => {
  if (!/v0\.3\.1/.test(html)) throw new Error('html version');
  const n = (html.match(/v0\.3\.1/g) || []).length;
  if (n < 2) throw new Error('version on both titles ' + n);
});

check('old overlay / SVG rockets removed', () => {
  if (/id="sb-toggle"/.test(html)) throw new Error('sb-toggle still in html');
  if (/sbStarship|sbFalcon|sbMcgregor/.test(js)) throw new Error('old SVG vehicle fn');
  if (/sb-steam|sb-plume|sb-fuel-bar/.test(js)) throw new Error('old steam/plume/fuel drawing');
  if (/tower\.starbaseOpen/.test(js)) throw new Error('old starbaseOpen key');
});

check('player.html is a thin 8:3 shell', () => {
  if (!/#root/.test(player)) throw new Error('#root');
  if (!/bridge\.js\?v=/.test(player)) throw new Error('bridge.js cache bust');
  if (!/starbase\.js\?v=/.test(player)) throw new Error('starbase.js cache bust');
  if (!/onerror/.test(player)) throw new Error('player.html onerror for missing bundle');
  if (!/min\(100vw,\s*calc\(100vh \* 8 \/ 3\)\)/.test(player) && !/min\(100vw,calc\(100vh \* 8 \/ 3\)\)/.test(compact(player))) throw new Error('8:3 width');
  if (/max-width:\s*1200px/.test(player)) throw new Error('old max-width 1200');
  if (/#05070d/.test(player) === false) throw new Error('bg');
});

check('player asset version is one constant across app + player.html', () => {
  const appV = (js.match(/SB_ASSET_V\s*=\s*'([^']+)'/) || [])[1];
  if (!appV) throw new Error('SB_ASSET_V missing');
  if (js.indexOf("player.html?v=' + SB_ASSET_V") < 0) throw new Error('specUrl does not use SB_ASSET_V');
  const bridgeV = (player.match(/bridge\.js\?v=([^"']+)/) || [])[1];
  const bundleV = (player.match(/starbase\.js\?v=([^"']+)/) || [])[1];
  if (!bridgeV) throw new Error('player.html bridge.js missing ?v=');
  if (!bundleV) throw new Error('player.html starbase.js missing ?v=');
  if (bridgeV !== appV) throw new Error('bridge.js v=' + bridgeV + ' != SB_ASSET_V ' + appV);
  if (bundleV !== appV) throw new Error('starbase.js v=' + bundleV + ' != SB_ASSET_V ' + appV);
});

check('bridge.js origin-checks postMessage', () => {
  if (!/e\.origin\s*!==\s*location\.origin/.test(bridge)) throw new Error('origin check');
  if (!/parent\.postMessage\(m,\s*origin\)/.test(bridge) && !/parent\.postMessage\(m, origin\)/.test(bridge)) throw new Error('post to origin');
  if (!/dataset\.scene/.test(bridge)) throw new Error('dataset.scene');
  if (!/mode === 'hold'|mode==='hold'/.test(bridge)) throw new Error('hold mode');
  if (!/visibilitychange/.test(bridge)) throw new Error('visibilitychange');
  if (!/__player/.test(bridge)) throw new Error('__player');
  if (!/function startSoon/.test(bridge)) throw new Error('startSoon watchdog');
  if (!/cmd === 'resume'|cmd==='resume'/.test(bridge)) throw new Error('resume cmd');
  if (!/3000/.test(bridge)) throw new Error('ready timeout ~3s');
  const hideAt = bridge.indexOf('Object.defineProperty(window, k');
  const playerAt = bridge.indexOf('window.__player');
  if (hideAt < 0 || playerAt < 0 || hideAt > playerAt) throw new Error('AudioContext must be hidden before __player is used');
  if (!/webkitAudioContext/.test(bridge)) throw new Error('webkitAudioContext stub');
  if (!/P\.mute/.test(bridge)) throw new Error('mute on ready');
});

check('starbase-state UMD + rules', () => {
  if (!/module\.exports/.test(state) || !/root\.StarbaseState/.test(state)) throw new Error('UMD');
  if (!/HOLD_FRAME/.test(state)) throw new Error('HOLD_FRAME');
  if (!/function next/.test(state)) throw new Error('next');
  if (!/fuelProgress/.test(state)) throw new Error('fuelProgress');
});

check('extract tool compares the three scene scripts', () => {
  if (!/01-stack\.html/.test(extract) || !/02-fuel\.html/.test(extract) || !/03-launch\.html/.test(extract)) throw new Error('src files');
  if (!/script mismatch/.test(extract)) throw new Error('mismatch check');
  if (!/starbase\.js/.test(extract)) throw new Error('output');
});

check('dual iframe pads, never rebuilt on poll', () => {
  if (!/data-buf|dataset\.buf/.test(js)) throw new Error('dual buffer');
  if (/sandbox/.test(js)) throw new Error('iframe sandbox still present');
  if (!/loading = 'lazy'|loading="lazy"/.test(js)) throw new Error('lazy');
  if (!/aria-hidden/.test(js)) throw new Error('aria-hidden iframe');
  if (!/applyPadPlayer|dataset\.clip/.test(js)) throw new Error('player apply');
  if (!/about:blank/.test(js)) throw new Error('release with about:blank');
  if (!/dataset\.started/.test(js)) throw new Error('started signature so once-clips are not restarted');
  if (!/cmd: 'resume'|cmd:'resume'/.test(js)) throw new Error('resume instead of replay');
  if (!/refreshPadChrome/.test(js)) throw new Error('chip refresh on ended');
  if (!/動畫檔未安裝/.test(js)) throw new Error('missing-bundle placeholder');
});

check('featured agent FLIP + localStorage', () => {
  if (!/tower\.sbFeatured/.test(js)) throw new Error('sbFeatured key');
  if (!/featured/.test(js) || !/sub-1/.test(js)) throw new Error('slot classes');
  if (!/getBoundingClientRect/.test(js)) throw new Error('FLIP measure');
  if (!/\.sb-pad\.featured/.test(css)) throw new Error('featured css');
  if (!/aspect-ratio:8\/3/.test(css) && !/aspect-ratio:8\/3/.test(compact(css))) throw new Error('8:3 scene');
});

check('HOLD bar still overlays blocked pads', () => {
  if (!/\.sb-hold-bar\{/.test(css)) throw new Error('hold-bar css');
  if (!/height:1[4-6]px/.test(css)) throw new Error('hold height');
  if (!/sb-hold-tag/.test(js) && !/HOLD · 卡住/.test(js)) throw new Error('hold tag');
  if (!/grayscale/.test(css)) throw new Error('grayscale hold');
  const tag = compact(css).match(/\.sb-hold-tag\{[^}]+\}/);
  if (!(tag && /bottom:/.test(tag[0]) && /left:50%/.test(tag[0]))) throw new Error('hold-tag bottom center');
  if (tag && /top:/.test(tag[0])) throw new Error('hold-tag still top-left');
});

check('Remotion bundle is gitignored and missing-file UI exists', () => {
  if (!/public\/starbase\/starbase\.js/.test(gitignore)) throw new Error('gitignore starbase.js');
  if (!/public\/starbase\/src\//.test(gitignore)) throw new Error('gitignore src/');
  if (!/onerror/.test(player)) throw new Error('player onerror');
  if (!/sb-missing/.test(css)) throw new Error('sb-missing css');
  const tracked = spawnSync('git', ['ls-files', '--', 'public/starbase/starbase.js', 'public/starbase/src'], { cwd: ROOT, encoding: 'utf8' });
  if (tracked.status !== 0) throw new Error('git ls-files');
  if (tracked.stdout.trim()) throw new Error('Remotion files still tracked: ' + tracked.stdout.trim());
});

check('StarBase view is clipped to the viewport', () => {
  if (!/html,body\{[^}]*overflow:hidden/.test(compact(css))) throw new Error('html overflow hidden');
  if (!/\.view-starbase\{[^}]*overflow:hidden/.test(compact(css))) throw new Error('sb view overflow');
  if (!/\.view-starbase\{[^}]*max-height:100%/.test(compact(css))) throw new Error('sb view max-height');
});

check('flown list is a full line, not clipped to a sliver', () => {
  const rules = compact(css).match(/\.sb-flown\{[^}]+\}/g) || [];
  const sized = rules.find(r => /max-height:\d+px/.test(r));
  if (!sized) throw new Error('sb-flown sized rule');
  const max = sized.match(/max-height:(\d+)px/);
  const min = sized.match(/min-height:(\d+)px/);
  if (!(max && Number(max[1]) >= 28)) throw new Error('flown max-height ' + (max && max[1]));
  if (!(min && Number(min[1]) >= 24)) throw new Error('flown min-height');
});

check('reduced motion kills view flip and pad motion', () => {
  const block = css.split('@media (prefers-reduced-motion:reduce)')[1] || '';
  if (!/transition:none/.test(block)) throw new Error('no transition');
  if (!/reducedMotion/.test(js)) throw new Error('js reducedMotion');
  if (!/prefers-reduced-motion/.test(js)) throw new Error('matchMedia');
});

check('takeoff flying error can jump to the strip', () => {
  if (!/跳到該卡片/.test(js)) throw new Error('jump label');
  if (!/這條已經在飛/.test(js)) throw new Error('already flying');
  if (!(/strip\.jump|\.jump/.test(css) || /classList\.add\('jump'\)/.test(js))) throw new Error('jump class');
});

check('confirm errors are de-duplicated', () => {
  if (!/uniqMsgs|warn\.err/.test(js)) throw new Error('uniq');
  if (!(/querySelectorAll\('\.warn\.err'\)/.test(js) || /uniqMsgs/.test(js))) throw new Error('warn.err');
});

if (failed) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
