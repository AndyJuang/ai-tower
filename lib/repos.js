'use strict';
// Which issue repos can take off: a repo is dispatchable when it has a local clone (config.repos[repo].clone,
// the dispatch repo's mainCheckout, or a git clone directly under baseDir whose origin is that repo). Others are browse-only.
const fs = require('fs');
const path = require('path');
const { run } = require('./util');
let cache = { at: 0, clones: {} };
const norm = u => (u || '').trim().replace(/\.git$/, '').replace(/^.*github\.com[:/]/, '');
const expand = (cfg, p) => p && p.replace(/^~(?=\/)/, require('os').homedir()).replace(/\{baseDir\}/g, cfg.baseDir);
async function discover(cfg) {
  if (Date.now() - cache.at < 10 * 60e3) return cache.clones;
  const want = new Set([...(cfg.issueRepos || []), cfg.dispatchRepo].filter(Boolean)); const clones = {};
  for (const r of want) { const c = cfg.repos && cfg.repos[r] && expand(cfg, cfg.repos[r].clone); if (c && fs.existsSync(path.join(c, '.git'))) clones[r] = c; }
  if (cfg.dispatchRepo && !clones[cfg.dispatchRepo] && cfg.mainCheckout && fs.existsSync(cfg.mainCheckout)) clones[cfg.dispatchRepo] = cfg.mainCheckout;
  let dirs = []; try { dirs = fs.readdirSync(cfg.baseDir, { withFileTypes: true }).filter(d => d.isDirectory() && !/-wt-/.test(d.name)); } catch {}
  for (const d of dirs) {
    const full = path.join(cfg.baseDir, d.name); let st; try { st = fs.statSync(path.join(full, '.git')); } catch { continue; }
    if (!st.isDirectory()) continue;   // skip worktrees (.git file)
    try { const r = norm(await run('git', ['-C', full, 'remote', 'get-url', 'origin'], { timeout: 5000 })); if (want.has(r) && !clones[r]) clones[r] = full; } catch {}
  }
  cache = { at: Date.now(), clones }; return clones;
}
function clones() { return cache.clones; }
function dispatchable(repo) { return !!cache.clones[repo]; }
module.exports = { discover, clones, dispatchable };
