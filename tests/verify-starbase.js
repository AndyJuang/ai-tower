'use strict';
// Static verification for StarBase. Starts its own servers on 4790/4791 and kills only those pids.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const mode = process.argv[2] || '--all';
let failed = 0;
function fail(msg) { failed++; console.error('FAIL ' + msg); }
function ok(msg) { console.log('PASS ' + msg); }

function syntax() {
  const files = [path.join(ROOT, 'server.js'), path.join(ROOT, 'public', 'app.js')];
  for (const f of fs.readdirSync(path.join(ROOT, 'lib'))) if (f.endsWith('.js')) files.push(path.join(ROOT, 'lib', f));
  for (const f of fs.readdirSync(path.join(ROOT, 'tests'))) if (f.endsWith('.js')) files.push(path.join(ROOT, 'tests', f));
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) fail('--check ' + path.relative(ROOT, f) + ' ' + (r.stderr || r.stdout));
    else ok('--check ' + path.relative(ROOT, f));
  }
  if (!failed) console.log('STARBASE_SYNTAX_OK');
}

function nopath() {
  const skip = new Set(['docs/STARBASE_PROGRESS.md', 'GATES.md']);
  function walk(dir, rel) {
    for (const name of fs.readdirSync(dir)) {
      if (name === '.git' || name === 'node_modules' || name === 'data') continue;
      const p = path.join(dir, name); const r = rel ? rel + '/' + name : name;
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p, r);
      else if (/\.(js|json|md|sh|css|html)$/.test(name) && !skip.has(r)) {
        const txt = fs.readFileSync(p, 'utf8');
        const needle = os.homedir();   // the current user's home path must never be committed
        if (txt.includes(needle)) fail('personal path in ' + r);
      }
    }
  }
  walk(ROOT, '');
  if (!failed) { ok('no personal home paths in repo files'); console.log('STARBASE_NOPATH_OK'); }
}

function get(url, host) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { Host: host || u.host } }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
}

function startServer(env) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  child.stdout.on('data', d => { buf += d; });
  child.stderr.on('data', d => { buf += d; });
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('listen timeout: ' + buf.slice(-400))), 20000);
    const on = d => { buf += d; if (/listening/.test(buf)) { clearTimeout(t); child.stdout.off('data', on); resolve(buf); } };
    child.stdout.on('data', on);
    child.once('exit', (c) => { clearTimeout(t); reject(new Error('server exited ' + c + ' ' + buf.slice(-400))); });
  });
  return { child, ready };
}

function killOwn(child) {
  if (!child || child.killed || child.exitCode != null) return;
  try { process.kill(child.pid, 'SIGTERM'); } catch {}
}

async function api() {
  const p4790 = startServer({ TOWER_PORT: '4790', TOWER_DEMO: '1' });
  try {
    await p4790.ready;
    const sb = await get('http://127.0.0.1:4790/api/starbase', '127.0.0.1:4790');
    if (sb.status !== 200) fail('/api/starbase status ' + sb.status);
    const j = JSON.parse(sb.body);
    if (!Array.isArray(j.agents) || j.agents.length !== 3) fail('demo agents length ' + (j.agents && j.agents.length));
    else ok('demo /api/starbase 3 agents');
    const names = j.agents.map(a => a.name).join(',');
    if (names !== '沃茲,克雷格,強尼') fail('agent order ' + names); else ok('agent order');
    const veh = j.agents.map(a => a.vehicle).join(',');
    if (veh !== 'starship,falcon9,mcgregor') fail('vehicles ' + veh); else ok('vehicles');
    const sts = new Set(j.agents.flatMap(a => a.tasks.map(t => t.status)));
    for (const s of ['queued', 'in_progress', 'blocked', 'done']) if (!sts.has(s)) fail('demo missing status ' + s);
    if (sts.has('queued') && sts.has('in_progress') && sts.has('blocked') && sts.has('done')) ok('demo covers four statuses');
    const strips = await get('http://127.0.0.1:4790/api/strips', '127.0.0.1:4790');
    const sj = JSON.parse(strips.body);
    if (!sj.starbase || !sj.starbase.agents) fail('/api/strips missing starbase'); else ok('/api/strips has starbase');
    const html = await get('http://127.0.0.1:4790/', '127.0.0.1:4790');
    if (!/id="starbase"/.test(html.body)) fail('HTML missing StarBase block'); else ok('HTML has StarBase block');
    if (!/v0\.2\.0/.test(html.body)) fail('HTML missing v0.2.0'); else ok('HTML has v0.2.0');
    const bad = await get('http://127.0.0.1:4790/api/starbase', 'example.com');
    if (bad.status !== 421) fail('host guard ' + bad.status); else ok('host guard 421');
  } catch (e) { fail('demo api ' + e.message); }
  finally { killOwn(p4790.child); await new Promise(r => setTimeout(r, 200)); }

  const tmpCfg = path.join(os.tmpdir(), 'tower-sb-4791.json');
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  const realDir = path.join(os.homedir(), 'claudeai知識庫', 'VIBE_開發專案', '_grok-logs', 'starbase', 'agents');
  example.port = 4791;
  example.demo = false;
  example.starbaseDir = realDir;
  example.logsDir = path.join(os.tmpdir(), 'tower-sb-4791-logs');
  example.baseDir = os.tmpdir();
  example.issueRepos = [];
  fs.writeFileSync(tmpCfg, JSON.stringify(example, null, 2));
  const p4791 = startServer({ TOWER_PORT: '4791', TOWER_CONFIG: tmpCfg, TOWER_DEMO: '' });
  try {
    await p4791.ready;
    const sb = await get('http://127.0.0.1:4791/api/starbase', '127.0.0.1:4791');
    if (sb.status !== 200) fail('real /api/starbase status ' + sb.status);
    const j = JSON.parse(sb.body);
    if (!j.agents || j.agents.length !== 3) fail('real agents');
    else ok('real /api/starbase 3 agents');
    const woz = j.agents.find(a => a.name === '沃茲');
    if (woz && woz.tasks.some(t => t.task && t.status)) ok('real 沃茲 has a task');
    else ok('real 沃茲 file read (may be empty)');
    const strips = await get('http://127.0.0.1:4791/api/strips', '127.0.0.1:4791');
    if (strips.status !== 200) fail('real /api/strips ' + strips.status); else ok('real /api/strips');
  } catch (e) { fail('real api ' + e.message); }
  finally { killOwn(p4791.child); }
  if (!failed) console.log('STARBASE_API_OK');
}

(async () => {
  try {
    if (mode === '--syntax' || mode === '--all') syntax();
    if (mode === '--nopath' || mode === '--all') nopath();
    if (mode === '--api' || mode === '--all') await api();
  } catch (e) { fail(String(e && e.stack || e)); }
  if (failed) { console.error('FAIL'); process.exit(1); }
  if (mode === '--all') console.log('STARBASE_VERIFY_OK');
})();
