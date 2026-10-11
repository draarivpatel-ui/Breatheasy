// Installable + offline: manifest, service worker, and the cache-busting stamp.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const S = require('../scripts/stamp.js');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('manifest has what browsers need to install the app', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone'); assert.equal(m.start_url, './'); assert.equal(m.scope, './');
  assert.ok(m.name && m.short_name && m.theme_color && m.background_color);
  const sizes = m.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  m.icons.forEach(i => assert.ok(fs.existsSync(path.join(ROOT, i.src)), i.src));
  assert.match(read('index.html'), /<link rel="manifest" href="manifest\.webmanifest">/);
});
test('cache-busting stamp is current (run `node scripts/stamp.js` after any change)', () => {
  const v = S.computeVersion(), c = S.current();
  assert.equal(c.sw, v);
  assert.ok(c.html.length >= 12, 'every script + stylesheet carries ?v=');
  c.html.forEach(x => assert.equal(x, v));
});
test('service worker precaches every script the page loads, and those files exist', () => {
  const html = read('index.html');
  const scripts = Array.from(html.matchAll(/<script src="([^"?]+)\?v=/g)).map(m => m[1]);
  const assets = S.swAssets(read('sw.js'));
  assert.deepEqual(scripts.slice().sort(), assets.filter(a => a.endsWith('.js')).sort());
  assert.ok(assets.includes('styles.css'));
  assets.forEach(a => assert.ok(fs.existsSync(path.join(ROOT, a)), a));
});
test('service worker never caches the forecast APIs and drops old caches', () => {
  const sw = read('sw.js');
  assert.match(sw, /url\.origin !== self\.location\.origin\) return;/);
  assert.match(sw, /caches\.delete/);
  assert.match(sw, /skipWaiting/); assert.match(sw, /clients\.claim/);
  assert.match(read('js/app.js'), /\/\^https\?:\$\/\.test\(location\.protocol\)/, 'only registers over http(s)');
});
