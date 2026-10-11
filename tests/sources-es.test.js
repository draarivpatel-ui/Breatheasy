// The Sources list has an English and a Spanish version; both must cite exactly the same URLs, and the Spanish one must not leave link text in plain English.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function list(lang) {
  const m = html.match(new RegExp('<ul class="sources" data-only="' + lang + '"[^>]*>([\\s\\S]*?)</ul>'));
  assert.ok(m, 'sources list for ' + lang);
  return m[1];
}
const hrefs = s => (s.match(/href="([^"]+)"/g) || []);
test('EN and ES Sources cite the same URLs in the same order', () => {
  assert.deepEqual(hrefs(list('es')), hrefs(list('en')));
  assert.ok(hrefs(list('en')).length >= 10);
});
test('ES Sources: no ellipsis hrefs, English-language links say "en inglés"', () => {
  assert.ok(!/href="[^"]*(\u2026|\.\.\.)"/.test(html), 'no truncated href anywhere');
  const es = list('es');
  ['Asthma Action Plan', 'Most Recent National', 'AQI Basics', 'Air Quality Guide', 'Open-Meteo Weather API'].forEach(w => assert.ok(!es.includes(w), 'untranslated: ' + w));
  assert.ok((es.match(/en inglés/g) || []).length >= 6);
});
