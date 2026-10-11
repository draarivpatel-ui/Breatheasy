const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../js/places.js');

// Real Open-Meteo Geocoding response for "London", saved 2026-10-11.
const london = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'geocode-london-2026-10-11.json'), 'utf8'));

test('place search URL: Open-Meteo geocoding, encoded name, language', () => {
  const u = P.searchUrl('  São Paulo ', 'es');
  assert.ok(u.startsWith('https://geocoding-api.open-meteo.com/v1/search?'));
  assert.ok(u.includes('name=S%C3%A3o%20Paulo&'), u);
  assert.ok(u.includes('language=es'));
  assert.ok(P.searchUrl('Pune', 'fr').includes('language=en'), 'unknown UI language falls back to en');
});

test('place ranking: biggest first, max 5, labelled with region and country', () => {
  const r = P.rank(london);
  assert.equal(r.length, 5);
  assert.deepEqual(r.map(x => x.name), [
    'London, England, United Kingdom',
    'London, Ontario, Canada',
    'London, Ohio, United States',
    'London, Kentucky, United States',
    'London, California, United States'
  ]);
  assert.ok(Math.abs(r[0].lat - 51.5) < 0.1 && Math.abs(r[0].lon + 0.13) < 0.1, JSON.stringify(r[0]));
});

test('place ranking: empty / malformed answers give no places', () => {
  assert.deepEqual(P.rank({}), []);
  assert.deepEqual(P.rank(null), []);
  assert.deepEqual(P.rank({ results: [{ name: 'X' }, { name: 'Y', latitude: 1, longitude: 'a' }] }), []);
});

test('place label skips a region that repeats the name', () => {
  assert.equal(P.label({ name: 'Singapore', admin1: 'Singapore', country: 'Singapore' }), 'Singapore, Singapore');
  assert.equal(P.label({ name: 'Sugar Land', admin1: 'Texas', country: 'United States' }), 'Sugar Land, Texas, United States');
});

test('every new UI string exists in English and Spanish', () => {
  const I = require('../js/i18n.js');
  ['place_label', 'place_btn', 'place_ph', 'place_searching', 'place_none', 'place_pick', 'place_error', 'place_set', 'try_demo', 'demo_tag']
    .forEach(k => ['en', 'es'].forEach(l => assert.ok(I.t(l, k) && I.t(l, k) !== k, l + ':' + k)));
  assert.match(I.t('en', 'try_demo'), /SYNTHETIC/);
  assert.match(I.t('es', 'try_demo'), /SINTÉTICOS/);
});
