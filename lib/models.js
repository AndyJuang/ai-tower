'use strict';
// Per-airline model + reasoning-effort settings.
// The tower writes <logsDir>/tower-models.env (airline defaults) and <logsDir>/tower-models.d/<line>.env (per-line overrides).
// The runner sources them at the start of EVERY round (hook installed once into the runner script, backup + bash -n first),
// so a change applies to the next round / next takeoff and never touches a running agent.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run, tpeStamp } = require('./util');
const { execFile } = require('child_process');
// --help text: some CLIs (agy) print usage on stderr
const helpText = (cmd) => new Promise(res => execFile(cmd, ['--help'], { timeout: 15000, maxBuffer: 8 << 20 }, (e, o, er) => res(String(o || '') + String(er || ''))));

const KEYS = { GK: 'grok', CL: 'claude', CX: 'codex', AG: 'antigravity' };
const SAFE = /^[A-Za-z0-9._:\/-]{1,80}$/;
const HOOK_MARK = '# AI Tower: per-airline model/effort';

function files(cfg) {
  const L = cfg.logsDir;
  return { env: path.join(L, 'tower-models.env'), dir: path.join(L, 'tower-models.d'), runner: path.join(L, cfg.runnerScript), log: path.join(L, 'tower-dispatch.log') };
}
function parseEnv(txt) { const o = {}; for (const l of (txt || '').split('\n')) { const m = l.match(/^([A-Z_]+)='?([^'\n]*)'?\s*$/); if (m) o[m[1]] = m[2]; } return o; }
function readEnv(f) { try { return parseEnv(fs.readFileSync(f, 'utf8')); } catch { return {}; } }

// ---------- what the runner uses today (defaults baked into the agent command lines) ----------
function runnerDefaults(cfg) {
  let t = ''; try { t = fs.readFileSync(files(cfg).runner, 'utf8'); } catch {}
  const blk = re => (t.match(re) || [])[0] || '';
  const cx = blk(/codex(?:\.js)?"? exec[^\n]*/), cl = blk(/\bclaude -p[^\n]*/), gk = blk(/\bgrok -p[^\n]*/), ag = blk(/\bagy -p[^\n]*/);
  const pick = (s, re) => { const m = s.match(re); return m ? m[1] : null; };
  return {
    hook: t.includes(HOOK_MARK),
    CX: { model: pick(cx, /-m "?\$\{TM:-([^}"]+)\}|-m (\S+)/) || pick(cx, /-m (\S+)/), effort: pick(cx, /(?:EFFORT|TE):-([a-z]+)\}/) },
    CL: { model: pick(cl, /--model "?(?:\$\{TM:-)?([A-Za-z0-9._-]+)/), effort: null },
    GK: { model: pick(gk, /(?:^|\s)-m "?([A-Za-z0-9._-]+)/), effort: pick(gk, /--reasoning-effort "?([a-z]+)/) },
    AG: { model: pick(ag, /--model "?([A-Za-z0-9._-]+)/), effort: pick(ag, /--effort "?(?:\$\{TE:-)?([a-z]+)/) },
  };
}

// ---------- what each CLI actually accepts (discovered, cached 1 h) ----------
let catalog = null, catalogAt = 0, catalogBusy = false;
const bin = (cfg, k, d) => (cfg.agentBins && cfg.agentBins[k]) || d;
async function discover(cfg) {
  const out = { GK: { models: [], efforts: [], note: '' }, CL: { models: [], efforts: [] }, CX: { models: [], efforts: [], perModel: {} }, AG: { models: [], efforts: [] } };
  const H = os.homedir();
  try { // grok models: "* <model> (default)" / "- <model>"
    const t = await run(bin(cfg, 'grok', 'grok'), ['models'], { timeout: 30000 });
    out.GK.models = [...t.matchAll(/^\s*[*-]\s+([A-Za-z0-9._-]+)/gm)].map(m => m[1]); out.GK.default = (t.match(/Default model:\s*(\S+)/) || [])[1];
  } catch (e) { out.GK.error = e.message.slice(0, 120); }
  try { // grok --reasoning-effort takes a free string; the xAI API documents low / high
    const h = await helpText(bin(cfg, 'grok', 'grok'));
    if (/--reasoning-effort/.test(h)) { out.GK.efforts = ['low', 'high']; out.GK.note = 'grok CLI 不驗證 effort；xAI API 接受 low／high'; }
  } catch {}
  try { // claude --help: aliases in quotes on the --model line, effort levels in parentheses
    const h = await helpText(bin(cfg, 'claude', 'claude'));
    const mi = h.indexOf('--model <model>'); const mt = mi >= 0 ? h.slice(mi, mi + 400) : '';
    out.CL.models = [...mt.matchAll(/'([a-z][a-z0-9.-]*)'/g)].map(m => m[1]);
    const ei = h.indexOf('--effort <level>'); const et = ei >= 0 ? h.slice(ei, ei + 300) : '';
    out.CL.efforts = ((et.match(/\(([a-z, ]+)\)/) || [])[1] || '').split(',').map(s => s.trim()).filter(Boolean);
    try { const s = JSON.parse(fs.readFileSync(path.join(H, '.claude/settings.json'), 'utf8'));
      for (const m of [s.model, ...Object.keys(s.modelSettings || {})]) if (m && !out.CL.models.includes(m)) out.CL.models.push(m);
      out.CL.cliDefault = { model: s.model || null, effort: s.effortLevel || null }; } catch {}
  } catch (e) { out.CL.error = e.message.slice(0, 120); }
  try { // codex: the CLI's own model cache lists models + supported reasoning levels
    const d = JSON.parse(fs.readFileSync(path.join(H, '.codex/models_cache.json'), 'utf8'));
    for (const m of d.models || []) if (m.visibility === 'list') {
      out.CX.models.push(m.slug); out.CX.perModel[m.slug] = (m.supported_reasoning_levels || []).map(x => typeof x === 'string' ? x : x.effort).filter(Boolean);
    }
    out.CX.efforts = [...new Set(Object.values(out.CX.perModel).flat())];
    try { const t = fs.readFileSync(path.join(H, '.codex/config.toml'), 'utf8'); out.CX.cliDefault = { model: (t.match(/^model\s*=\s*"([^"]+)"/m) || [])[1] || null, effort: (t.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m) || [])[1] || null }; } catch {}
  } catch (e) { out.CX.error = 'no ~/.codex/models_cache.json'; }
  try { // agy models: "<id>\t<name>"; efforts from --help "(low|medium|high|xhigh|max)"
    const t = await run(bin(cfg, 'antigravity', 'agy'), ['models'], { timeout: 30000 });
    out.AG.models = [...t.matchAll(/^([a-z0-9][A-Za-z0-9._-]+)\t/gm)].map(m => m[1]);
    const h = await helpText(bin(cfg, 'antigravity', 'agy'));
    const ei = h.indexOf('--effort'); out.AG.efforts = (((ei >= 0 ? h.slice(ei, ei + 400) : '').match(/\(([a-z]+(?:\|[a-z]+)+)\)/) || [])[1] || '').split('|').filter(Boolean);
  } catch (e) { out.AG.error = e.message.slice(0, 120); }
  for (const [k, v] of Object.entries((cfg.modelCatalog || {}))) Object.assign(out[k] = out[k] || {}, v);   // optional static override
  return out;
}
function getCatalog(cfg) {
  if (!catalogBusy && (!catalog || Date.now() - catalogAt > 3600e3)) {
    catalogBusy = true; discover(cfg).then(c => { catalog = c; catalogAt = Date.now(); }).catch(() => {}).finally(() => { catalogBusy = false; });
  }
  return catalog;
}

// ---------- view for the snapshot ----------
function view(cfg) {
  const f = files(cfg); const env = readEnv(f.env); const def = runnerDefaults(cfg); const cat = getCatalog(cfg) || {};
  const lanes = {};
  for (const k of Object.keys(KEYS)) {
    const set = { model: env[`TOWER_${k}_MODEL`] || null, effort: env[`TOWER_${k}_EFFORT`] || null };
    const c = cat[k] || {}; const d = def[k] || {};
    const cliDef = c.cliDefault || (k === 'GK' ? { model: c.default || null } : {});
    lanes[k] = { set, runnerDefault: d, effective: { model: set.model || d.model || cliDef.model || null, effort: set.effort || d.effort || cliDef.effort || null,
      source: set.model || set.effort ? 'tower' : d.model || d.effort ? 'runner' : 'cli' }, catalog: { models: c.models || [], efforts: c.efforts || [], perModel: c.perModel || null, note: c.note || '', error: c.error || null } };
  }
  const overrides = {}; try { for (const n of fs.readdirSync(f.dir)) if (n.endsWith('.env')) { const e = readEnv(path.join(f.dir, n)); overrides[n.slice(0, -4)] = { model: e.TOWER_LINE_MODEL || null, effort: e.TOWER_LINE_EFFORT || null }; } } catch {}
  return { lanes, overrides, hook: def.hook, catalogReady: !!catalog };
}

// ---------- runner hook (installed once; backup + bash -n + atomic rename; running bash keeps its old inode) ----------
async function ensureHook(cfg) {
  const f = files(cfg); const t = fs.readFileSync(f.runner, 'utf8');
  if (t.includes(HOOK_MARK)) return null;
  const ra = t.indexOf('run_agent() {'); if (ra < 0) throw new Error('run_agent() { … } not found in runner — add the hook by hand (see examples/runner.example.sh)');
  const nl = t.indexOf('\n', ra) + 1;
  const hook = `  ${HOOK_MARK} — re-read every round; the tower writes these files (changes apply to the next round)
  TM=; TE=; [ -f "$L/tower-models.env" ] && . "$L/tower-models.env"
  case "$A" in codex-*) TM=\${TOWER_CX_MODEL:-}; TE=\${TOWER_CX_EFFORT:-};; claude-*) TM=\${TOWER_CL_MODEL:-}; TE=\${TOWER_CL_EFFORT:-};; grok-*) TM=\${TOWER_GK_MODEL:-}; TE=\${TOWER_GK_EFFORT:-};; antigravity-*) TM=\${TOWER_AG_MODEL:-}; TE=\${TOWER_AG_EFFORT:-};; esac
  TOWER_LINE_MODEL=; TOWER_LINE_EFFORT=; [ -f "$L/tower-models.d/$A.env" ] && . "$L/tower-models.d/$A.env"
  TM=\${TOWER_LINE_MODEL:-$TM}; TE=\${TOWER_LINE_EFFORT:-\${EFFORT:-$TE}}
`;
  let out = t.slice(0, nl) + hook + t.slice(nl);
  const edits = [
    [/(codex(?:\.js)?"? exec[^\n]*?)-m ([A-Za-z0-9._-]+)/, (m, a, b) => `${a}-m "\${TM:-${b}}"`],
    [/model_reasoning_effort=\\"\$\{EFFORT:-([a-z]+)\}\\"/, (m, a) => `model_reasoning_effort=\\"\${TE:-${a}}\\"`],
    [/(\bclaude -p[^\n]*?)--model ([A-Za-z0-9._-]+)/, (m, a, b) => `${a}--model "\${TM:-${b}}" \${TE:+--effort "$TE"}`],
    [/(\bgrok -p "\$\(cat "\$RP"\)")/, (m, a) => `${a} \${TM:+-m "$TM"} \${TE:+--reasoning-effort "$TE"}`],
    [/(\bagy -p[^\n]*?)--effort ([a-z]+)/, (m, a, b) => `${a}--effort "\${TE:-${b}}" \${TM:+--model "$TM"}`],
  ];
  const applied = [];
  for (const [re, fn] of edits) if (re.test(out)) { out = out.replace(re, fn); applied.push(re.source.slice(0, 18)); }
  const stamp = tpeStamp().replace(/[- :]/g, '').slice(0, 14);
  const bak = `${f.runner}.bak-tower-models-${stamp}`; fs.copyFileSync(f.runner, bak);
  const tmp = `${f.runner}.tower-tmp`; fs.writeFileSync(tmp, out, { mode: fs.statSync(f.runner).mode });
  try { await run('bash', ['-n', tmp]); } catch (e) { fs.unlinkSync(tmp); throw new Error('bash -n failed on hooked runner (not applied): ' + e.message); }
  fs.renameSync(tmp, f.runner);
  return { bak: path.basename(bak), applied: applied.length };
}

function validate(k, model, effort) {
  const c = (catalog || {})[k] || {};
  if (model && (!SAFE.test(model) || (c.models && c.models.length && !c.models.includes(model)))) throw new Error(`model ${model} is not offered by the ${KEYS[k]} CLI`);
  const effs = (c.perModel && model && c.perModel[model]) || c.efforts || [];
  if (effort && (!SAFE.test(effort) || (effs.length && !effs.includes(effort)))) throw new Error(`effort ${effort} is not supported${model ? ' by ' + model : ''}`);
}
function writeEnvFile(file, vars, header) {
  const body = Object.entries(vars).filter(([, v]) => v).map(([k, v]) => `${k}='${v}'`).join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!body) { try { fs.unlinkSync(file); } catch {} return; }
  fs.writeFileSync(file + '.tmp', `# ${header} — written by AI Tower ${tpeStamp()}\n${body}\n`); fs.renameSync(file + '.tmp', file);
}
// save airline default ({lane}) or per-line override ({line}); null/'' = back to runner / CLI default
async function save(cfg, { lane, line, model, effort }, LANE_OF_LINE) {
  const f = files(cfg); model = model || null; effort = effort || null;
  const k = lane || LANE_OF_LINE(line); if (!KEYS[k]) throw new Error('unknown lane');
  validate(k, model, effort);
  const hook = await ensureHook(cfg);
  if (line) {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(line)) throw new Error('bad line');
    writeEnvFile(path.join(f.dir, line + '.env'), { TOWER_LINE_MODEL: model, TOWER_LINE_EFFORT: effort }, `override for ${line}`);
  } else {
    const env = readEnv(f.env); env[`TOWER_${k}_MODEL`] = model; env[`TOWER_${k}_EFFORT`] = effort;
    writeEnvFile(f.env, env, 'per-airline model / effort, read by the runner every round');
  }
  fs.appendFileSync(f.log, `${tpeStamp()} MODELS ${line ? 'line=' + line : 'lane=' + k} model=${model || 'default'} effort=${effort || 'default'}${hook ? ` (runner hook installed, backup ${hook.bak}, bash -n ok)` : ''}\n`);
  return { ok: true, lane: k, line: line || null, model, effort, hookInstalled: !!hook };
}
module.exports = { view, save, getCatalog, ensureHook, HOOK_MARK };
