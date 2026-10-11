#!/usr/bin/env node
/* Cache-busting stamp. Hashes every app file and writes the hash into sw.js (VERSION) and into
 * index.html (?v= on each script and the stylesheet). Run after any change:  node scripts/stamp.js
 * `node scripts/stamp.js --check` exits 1 if the stamp is stale (the unit tests run the same check). */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');

function swAssets(sw) {
  const m = sw.match(/var ASSETS = \[([\s\S]*?)\];/);
  return m[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
}
function normalize(html) { return html.replace(/\?v=[\w-]+/g, '?v='); }
function normalizeSw(sw) { return sw.replace(/var VERSION = '[^']*';/, "var VERSION = '';"); }

function computeVersion() {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const icons = fs.readdirSync(path.join(ROOT, 'icons')).sort().map(f => 'icons/' + f);
  const files = ['manifest.webmanifest'].concat(icons, swAssets(sw));
  const h = crypto.createHash('sha256');
  h.update(normalize(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
  h.update(normalizeSw(sw));
  files.forEach(f => { h.update(f); h.update(fs.readFileSync(path.join(ROOT, f))); });
  return 'be-' + h.digest('hex').slice(0, 10);
}

function current() {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return { sw: (sw.match(/var VERSION = '([^']*)';/) || [])[1], html: Array.from(html.matchAll(/\?v=([\w-]+)/g)).map(m => m[1]) };
}

function stamp() {
  const v = computeVersion();
  const swp = path.join(ROOT, 'sw.js'), hp = path.join(ROOT, 'index.html');
  fs.writeFileSync(swp, fs.readFileSync(swp, 'utf8').replace(/var VERSION = '[^']*';/, "var VERSION = '" + v + "';"));
  let html = fs.readFileSync(hp, 'utf8');
  html = html.replace(/(<script src="(js\/[\w-]+\.js))(\?v=[\w-]+)?(")/g, '$1?v=' + v + '$4')
    .replace(/(<link rel="stylesheet" href="styles\.css)(\?v=[\w-]+)?(")/, '$1?v=' + v + '$3');
  fs.writeFileSync(hp, html);
  return v;
}

module.exports = { computeVersion, current, swAssets, stamp };
if (require.main === module) {
  if (process.argv.includes('--check')) {
    const v = computeVersion(), c = current();
    const ok = c.sw === v && c.html.length && c.html.every(x => x === v);
    console.log(ok ? 'stamp ok ' + v : 'stamp STALE: run node scripts/stamp.js (want ' + v + ', sw has ' + c.sw + ')');
    process.exit(ok ? 0 : 1);
  } else console.log('stamped ' + stamp());
}
