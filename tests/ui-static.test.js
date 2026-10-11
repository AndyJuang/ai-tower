'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const compact = s => s.replace(/\s+/g, '');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

check('bays are equal-width 4 columns', () => {
  assert.ok(/\.bays\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(compact(css)));
});

check('narrow breakpoints kept', () => {
  const c = compact(css);
  assert.ok(c.includes('@media(max-width:1180px){.bays{grid-template-columns:repeat(2,minmax(0,1fr))}}'));
  assert.ok(c.includes('@media(max-width:640px){.bays{grid-template-columns:1fr}'));
});

check('scene SVG is 170–180px with meet (nose not sliced)', () => {
  assert.ok(/viewBox="0 0 480 17[0-9]"/.test(js));
  assert.ok(/preserveAspectRatio="xMidYMax meet"/.test(js));
  const m = css.match(/\.sb-scene\{[^}]*height:(\d+)px/);
  assert.ok(m, 'sb-scene height');
  const h = Number(m[1]);
  assert.ok(h >= 170 && h <= 180, 'scene height ' + h);
});

check('Starship has chopsticks + two stages + nose headroom', () => {
  assert.ok(/sb-chop/.test(js) || /筷子|chopstick/i.test(js));
  assert.ok(/sbStarship/.test(js));
  assert.ok(/superheavy|sb-booster|超重型/i.test(js));
  assert.ok(/M186 6 L202 22/.test(js), 'Starship nose starts at y=6 inside 176 viewBox');
});

check('McGregor is a horizontal engine stand', () => {
  assert.ok(/sbMcgregor/.test(js));
  assert.ok(/sb-bell|sb-engine/.test(js));
});

check('HOLD is a thin bar + tag, not a full banner over the rocket', () => {
  assert.ok(/\.sb-hold-bar\{/.test(css));
  assert.ok(/height:1[4-6]px/.test(css));
  assert.ok(/sb-hold-tag/.test(js) && /sb-hold-bar/.test(js));
  assert.ok(!/\.sb-hold-banner\{/.test(css) || /sb-hold-banner/.test(css) === false);
});

check('fuel is a thin vertical bar beside the tower', () => {
  assert.ok(/sb-fuel-bar/.test(js) && /sb-fuel-bar/.test(css));
  const fuel = compact(css).match(/\.sb-fuel\{[^}]+\}/);
  assert.ok(fuel && /flex-direction:column/.test(fuel[0]), 'vertical fuel stack');
  assert.ok(/\.sb-fuel-bar\{[^}]*width:7px/.test(compact(css)));
});

check('glow filter, meteor, lattice, frost/LOX', () => {
  assert.ok(/feGaussianBlur/.test(js));
  assert.ok(/sb-meteor/.test(js) && /sbMeteor/.test(css));
  assert.ok(/function sbX\(/.test(js));
  assert.ok(/sb-frost/.test(js));
  assert.ok(/sb-lox/.test(js) && /sb-lox/.test(css));
  assert.ok(/sb-beacon/.test(js));
});

check('liftoff is 3–4s; McGregor stays horizontal', () => {
  assert.ok(/sbLaunch 3\.[0-9]s/.test(css) || /sbLaunch 4s/.test(css));
  assert.ok(/sbMcFlame 3\.[0-9]s/.test(css) || /sbMcFlame 4s/.test(css));
  assert.ok(/until: now\(\) \+ 3700/.test(js));
});

check('flown row is a full line, not clipped', () => {
  const rules = compact(css).match(/\.sb-flown\{[^}]+\}/g) || [];
  const sized = rules.find(r => /max-height:\d+px/.test(r));
  assert.ok(sized, 'sb-flown sized rule');
  const max = sized.match(/max-height:(\d+)px/);
  const min = sized.match(/min-height:(\d+)px/);
  assert.ok(max && Number(max[1]) >= 28, 'flown max-height ' + (max && max[1]));
  assert.ok(min && Number(min[1]) >= 24, 'flown min-height');
  const task = compact(css).match(/\.sb-task\{[^}]*height:(\d+)px/);
  assert.ok(task && Number(task[1]) <= Number(max[1]), 'task fits in flown max-height');
});

check('reduced motion kills meteor, vapor, liftoff', () => {
  const block = css.split('@media (prefers-reduced-motion:reduce)')[1] || '';
  assert.ok(/sb-meteor/.test(block));
  assert.ok(/animation:none/.test(block));
  assert.ok(/sb-steam/.test(block));
});

check('header version is v0.2.1', () => {
  assert.ok(/v0\.2\.1/.test(html));
});

check('three pads stay under 600 SVG nodes', () => {
  const starN = Number((js.match(/SB_STAR_N\s*=\s*(\d+)/) || [])[1]);
  assert.ok(starN > 20 && starN <= 48, 'star count ' + starN);
  const per = starN + 15 + 3 + 12 + 12 + 36 + 28;
  assert.ok(per * 3 < 600, 'estimated SVG nodes ' + (per * 3));
});

check('takeoff flying error can jump to the strip', () => {
  assert.ok(/跳到該卡片/.test(js));
  assert.ok(/這條已經在飛/.test(js));
  assert.ok(/strip\.jump|\.jump/.test(css) || /classList\.add\('jump'\)/.test(js));
});

check('confirm errors are de-duplicated', () => {
  assert.ok(/uniqMsgs|warn\.err/.test(js));
  assert.ok(/querySelectorAll\('\.warn\.err'\)/.test(js) || /uniqMsgs/.test(js));
});

if (failed) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
