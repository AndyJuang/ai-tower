'use strict';
// Products: which product a repo (and so an issue or a line) belongs to. config.products = { "owner/repo": { name, short, color? } }.
// The primary product (config.primaryProduct, default = the dispatch repo's product) gets plain flight numbers ("GK 131");
// every other product carries its short code so numbers can't collide across repos ("GK TR-12").
const CFG = require('./config').load();
const MAP = CFG.products || {};
function productOf(repo) {
  if (!repo) return null;
  const p = MAP[repo]; const name = repo.split('/').pop();
  if (p) return { repo, name: p.name || name, short: String(p.short || name.slice(0, 2)).toUpperCase(), color: p.color || null };
  return { repo, name, short: name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '??', color: null };
}
const PRIMARY = (CFG.primaryProduct || (productOf(CFG.dispatchRepo) || {}).short || '').toUpperCase();
function repoForProject(project) {   // extra runners name a project; match it to a product name
  if (!project) return null;
  const want = String(project).toLowerCase();
  for (const [repo, p] of Object.entries(MAP)) if ((p.name || '').toLowerCase() === want || repo.split('/').pop().toLowerCase() === want) return repo;
  return null;
}
function flightLabel(code, repo, n) { const p = productOf(repo); return `${code} ${p && p.short !== PRIMARY ? p.short + '-' : ''}${n}`; }
function list() { return Object.entries(MAP).map(([repo]) => productOf(repo)); }
module.exports = { productOf, flightLabel, repoForProject, PRIMARY, list };
