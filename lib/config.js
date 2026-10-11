'use strict';
// Loads config.json (local, gitignored) or falls back to config.example.json. "~" and {baseDir}/{logsDir} are expanded.
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
function load() {
  const file = process.env.TOWER_CONFIG || (fs.existsSync(path.join(ROOT, 'config.json')) ? path.join(ROOT, 'config.json') : path.join(ROOT, 'config.example.json'));
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const exp = v => typeof v === 'string' ? v.replace(/^~(?=\/|$)/, os.homedir()) : v;
  c.baseDir = exp(c.baseDir || '~');
  const sub = v => typeof v === 'string' ? exp(v).replace(/\{baseDir\}/g, c.baseDir).replace(/\{logsDir\}/g, c.logsDir || '') : v;
  c.logsDir = sub(c.logsDir || '{baseDir}/_logs');
  c.starbaseDir = sub(c.starbaseDir || '{logsDir}/starbase/agents');
  if (c.starbaseDir && !path.isAbsolute(c.starbaseDir)) c.starbaseDir = path.join(ROOT, c.starbaseDir);
  for (const k of ['mainCheckout', 'worktreePattern', 'promptTemplate', 'titlesFile', 'dataDir']) if (c[k]) c[k] = sub(c[k]);
  c.dataDir = c.dataDir ? (path.isAbsolute(c.dataDir) ? c.dataDir : path.join(ROOT, c.dataDir)) : path.join(ROOT, 'data');
  if (c.titlesFile && !path.isAbsolute(c.titlesFile)) c.titlesFile = path.join(ROOT, c.titlesFile);
  if (c.promptTemplate && !path.isAbsolute(c.promptTemplate)) c.promptTemplate = path.join(ROOT, c.promptTemplate);
  const tpl = v => { const x = sub(v); return x && !path.isAbsolute(x) ? path.join(ROOT, x) : x; };
  c.promptTemplateOther = tpl(c.promptTemplateOther || 'prompt-template.example.md');   // template for repos other than dispatchRepo
  for (const r of Object.values(c.repos || {})) { if (r.clone) r.clone = sub(r.clone); if (r.promptTemplate) r.promptTemplate = tpl(r.promptTemplate); }
  c.port = Number(process.env.TOWER_PORT || c.port || 4777);
  c.demo = !!(process.env.TOWER_DEMO || c.demo || process.argv.includes('--demo'));
  c._file = file;
  fs.mkdirSync(c.dataDir, { recursive: true });
  return c;
}
module.exports = { load, ROOT };
