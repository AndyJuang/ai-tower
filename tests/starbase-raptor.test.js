'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../public/starbase-raptor');
const ROOT = path.join(__dirname, '..');
let failed = 0;
function check(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
const NOW = 1_800_000_000_000;

check('activeJob picks newest in_progress only', () => {
  assert.strictEqual(R.activeJob([{ id: 'q', status: 'queued' }]), null);
  const j = R.activeJob([{ id: 'a', status: 'in_progress', started_at: 1 }, { id: 'b', status: 'in_progress', started_at: 5 }, { id: 'c', status: 'done', started_at: 9 }]);
  assert.strictEqual(j.id, 'b');
});
check('explicit progress 0..1 and 0..100, capped below 1', () => {
  assert.strictEqual(R.jobProgress({ progress: 0.4 }, NOW), 0.4);
  assert.strictEqual(R.jobProgress({ progress: 40 }, NOW), 0.4);
  assert.strictEqual(R.jobProgress({ progress: 100 }, NOW), R.RAMP_CAP);
});
check('elapsed vs estimate', () => {
  assert.ok(Math.abs(R.jobProgress({ started_at: NOW - 300000, estimate_ms: 600000 }, NOW) - 0.5) < 1e-9);
  assert.ok(Math.abs(R.jobProgress({ started_at: NOW - 300000, estimate_min: 10 }, NOW) - 0.5) < 1e-9);
});
check('asymptotic ramp is monotonic and < cap', () => {
  let last = -1;
  for (const m of [0, 1, 5, 10, 30, 120, 1000]) { const p = R.jobProgress({ started_at: NOW - m * 60000 }, NOW); assert.ok(p >= last && p < R.RAMP_CAP + 1e-12); last = p; }
  assert.strictEqual(R.jobProgress({ status: 'in_progress' }, NOW), 0.05);
});
check('landing fires once per job id', () => {
  const seen = new Set(), prev = new Set(['j1']);
  const tasks = [{ id: 'j1', status: 'done', done_at: NOW - 1000 }];
  assert.deepStrictEqual(R.newLandings(tasks, seen, prev, NOW).map(t => t.id), ['j1']);
  assert.deepStrictEqual(R.newLandings(tasks, seen, prev, NOW), []);
});
check('stale done tasks on first load do not ignite but are marked seen', () => {
  const seen = new Set();
  assert.deepStrictEqual(R.newLandings([{ id: 'old', status: 'done', done_at: NOW - 3600e3 }], seen, new Set(), NOW), []);
  assert.ok(seen.has('old'));
  assert.strictEqual(R.newLandings([{ id: 'x', status: 'done', done_at: NOW - 3600e3 }], new Set(), new Set(['x']), NOW).length, 1);
});
check('allocate caps live engines, skips offscreen, prioritises launching/active', () => {
  const c = [
    { key: 'a', visible: true }, { key: 'b', visible: true, active: true }, { key: 'c', visible: false, active: true, launching: true },
    { key: 'd', visible: true, featured: true }, { key: 'e', visible: true, launching: true },
  ];
  const s = R.allocate(c, 3);
  assert.deepStrictEqual([...s].sort(), ['b', 'd', 'e']);
  assert.strictEqual(R.allocate(c, 0).size, 0);
  assert.strictEqual(R.MAX_LIVE, 3);
});
check('static SVG fallback reflects assemblies', () => {
  const svg = R.staticSvg(0.5);
  assert.ok(svg.startsWith('<svg') && svg.includes('6/11'));
});
check('engine asset ships with MIT attribution', () => {
  const eng = fs.readFileSync(path.join(ROOT, 'public/starbase/raptor/engine.html'), 'utf8');
  const lic = fs.readFileSync(path.join(ROOT, 'public/starbase/raptor/LICENSE-anatomy.txt'), 'utf8');
  assert.ok(/MIT License/.test(lic) && /Copyright \(c\) 2026 Ryan/.test(lic));
  assert.ok(eng.slice(0, 3000).includes('Copyright (c) 2026 Ryan'));
  assert.ok(/cmd === "complete"/.test(eng) && /tell\("landed"\)/.test(eng));
  assert.ok(!/(src|href)=["']https?:/.test(eng), 'engine must be self-contained');
});
check('UI wiring: script tag, toggle, controller hooks', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  assert.ok(html.indexOf('starbase-raptor.js') > 0 && html.indexOf('starbase-raptor.js') < html.indexOf('app.js'));
  assert.ok(html.includes('id="sb-raptor-toggle"'));
  assert.ok(js.includes('RAPTOR.sync(') && js.includes('RAPTOR.prune('));
});
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all raptor tests passed');
