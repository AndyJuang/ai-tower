'use strict';
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const HOME = os.homedir();
// detached server may start with a thin PATH: make gh/git/node reachable (Homebrew, ~/.local/bin, system)
process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, '.local/bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin', process.env.PATH || ''].join(':');
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 << 20, timeout: opts.timeout || 60000, cwd: opts.cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...(opts.env || {}) } }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; err.message = `${cmd} ${args.join(' ').slice(0, 200)} → ${(stderr || err.message).toString().trim().slice(0, 400)}`; reject(err); }
      else resolve(stdout.toString());
    });
  });
}
function tpeStamp(t = Date.now(), withSec = true) { // local-time stamp 'YYYY-MM-DD HH:MM[:SS]' (machine time zone)
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` + (withSec ? ':' + p(d.getSeconds()) : '');
}
function readJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }
function writeJSON(f, v) { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f); }
module.exports = { run, tpeStamp, readJSON, writeJSON, HOME };
