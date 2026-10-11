// Strict-judge round 2 (Oct 11): the English and Spanish "Why BreatheEasy" cards must say the same things.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const M = require('../js/model.js');
function card(lang) {
  const m = html.match(new RegExp('<div class="card prose" data-only="' + lang + '"[^>]*>([\\s\\S]*?)</div>'));
  assert.ok(m, 'about card for ' + lang); return m[1];
}
const plain = s => s.replace(/<[^>]+>/g, '');
const WORDS = {
  en: { ozone: 'ozone AQI', pm25: 'PM2.5 AQI', pollen: 'pollen level', heat: 'high temperature', humidity: 'humidity', yesterday: 'whether yesterday was rough' },
  es: { ozone: 'ICA de ozono', pm25: 'ICA de PM2.5', pollen: 'nivel de polen', heat: 'temperatura máxima', humidity: 'humedad', yesterday: 'si el día anterior fue difícil' }
};
test('both languages list every model input the code actually uses', () => {
  for (const lang of ['en', 'es']) {
    const c = plain(card(lang));
    M.FEATURES.forEach(f => assert.ok(c.includes(WORDS[lang][f.label]), lang + ' missing input ' + f.label));
  }
});
test('both languages state the 14-day minimum with good AND rough days, the baseline, and Ozone Action Days', () => {
  assert.equal(M.MIN_DAYS, 14);
  const en = plain(card('en')), es = plain(card('es'));
  assert.ok(en.includes('at least 14 days with some good and some rough days'));
  assert.ok(es.includes('al menos 14 días, con algunos días buenos y algunos difíciles'));
  assert.ok(en.includes('naive baseline') && es.includes('línea base'));
  assert.ok(en.includes('Ozone Action Days') && es.includes('Ozone Action Days'));
});
test('EN and ES about cards cite the same numbers and links', () => {
  const nums = s => (plain(s).match(/\d+(\.\d+)?/g) || []).sort();
  assert.deepEqual(nums(card('es')), nums(card('en')));
  const hrefs = s => (s.match(/href="([^"]+)"/g) || []);
  assert.deepEqual(hrefs(card('es')), hrefs(card('en')));
});
