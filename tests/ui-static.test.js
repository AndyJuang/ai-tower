'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

check('bays are equal-width 4 columns', () => {
  assert.ok(/\.bays\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(css.replace(/\s+/g, '')));
});

check('narrow breakpoints kept', () => {
  const c = css.replace(/\s+/g, '');
  assert.ok(c.includes('@media(max-width:1180px){.bays{grid-template-columns:repeat(2,minmax(0,1fr))}}'));
  assert.ok(c.includes('@media(max-width:640px){.bays{grid-template-columns:1fr}'));
});

check('scene SVG is wide (viewBox 480 and slice)', () => {
  assert.ok(/viewBox="0 0 480 150"/.test(js));
  assert.ok(/preserveAspectRatio="xMidYMax slice"/.test(js));
});

check('Starship has chopsticks + two stages', () => {
  assert.ok(/sb-chop/.test(js) || /筷子|chopstick/i.test(js));
  assert.ok(/sbStarship/.test(js));
  assert.ok(/superheavy|sb-booster|超重型/i.test(js));
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

check('fuel label sits beside a short bar', () => {
  assert.ok(/sb-fuel-bar/.test(js) && /sb-fuel-bar/.test(css));
  assert.ok(/height:[6-8]px/.test(css));
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
