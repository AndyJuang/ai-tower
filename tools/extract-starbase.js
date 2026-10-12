#!/usr/bin/env node
'use strict';
// Pull the shared Remotion Player bundle out of Andy's three scene HTML files.
// Usage: drop updated 01-stack.html / 02-fuel.html / 03-launch.html into
// public/starbase/src/ and rerun: node tools/extract-starbase.js
// src/ and starbase.js are gitignored (Remotion License is not OSI).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'starbase', 'src');
const OUT = path.join(ROOT, 'public', 'starbase', 'starbase.js');
const FILES = ['01-stack.html', '02-fuel.html', '03-launch.html'];

function extractScript(file) {
  const html = fs.readFileSync(file, 'utf8');
  const body = html.indexOf('<body');
  if (body < 0) throw new Error(path.basename(file) + ': no <body>');
  const start = html.indexOf('<script>', body);
  const end = html.lastIndexOf('</script>');
  if (start < 0 || end < 0 || end <= start) throw new Error(path.basename(file) + ': no <script> after <body>');
  return html.slice(start + '<script>'.length, end);
}

const scripts = FILES.map(name => {
  const file = path.join(SRC, name);
  if (!fs.existsSync(file)) {
    console.error('missing ' + path.relative(ROOT, file));
    process.exit(1);
  }
  return extractScript(file);
});

for (let i = 1; i < scripts.length; i++) {
  if (scripts[i] !== scripts[0]) {
    console.error('script mismatch: ' + FILES[i] + ' differs from ' + FILES[0]);
    process.exit(1);
  }
}

const js = scripts[0];
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, js);
console.log('EXTRACT_OK wrote ' + path.relative(ROOT, OUT) + ' ' + Buffer.byteLength(js) + ' bytes');
