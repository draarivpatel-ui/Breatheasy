// Link preview: when a judge or a parent pastes the link into a chat, it shows a title, a description and a real screenshot.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const meta = (k) => (html.match(new RegExp('<meta (?:property|name)="' + k + '" content="([^"]+)"')) || [])[1];

test('Open Graph + large Twitter card point at the live page and a 1280x800 screenshot in the repo', () => {
  assert.equal(meta('og:url'), 'https://aariv.me/Breatheasy/');
  assert.equal(meta('twitter:card'), 'summary_large_image');
  ['og:title', 'og:description', 'og:image:alt', 'description'].forEach(k => assert.ok((meta(k) || '').length > 20, k));
  const img = meta('og:image'); assert.ok(img.startsWith(meta('og:url')), img);
  const png = fs.readFileSync(path.join(ROOT, img.slice(meta('og:url').length)));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [Number(meta('og:image:width')), Number(meta('og:image:height'))]);
  assert.ok(png.length < 300e3, 'small enough for chat previews');
});
test('the page description no longer says Houston only (any-city search exists)', () => {
  assert.match(meta('description'), /any city you search/);
  assert.ok(fs.readFileSync(path.join(ROOT, 'js/places.js'), 'utf8').includes('geocoding-api.open-meteo.com'));
});
