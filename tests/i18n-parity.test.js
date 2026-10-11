// EN/ES key parity: same keys, same {placeholders}, and no English copied into the Spanish strings.
const test = require('node:test'); const assert = require('node:assert');
const I = require('../js/i18n.js');

const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

// Keys whose Spanish is legitimately identical to the English (place names, units, a statistic's name).
const SAME_OK = new Set(['loc_sugarland', 'loc_pasadena', 'pm25', 'sens_col_brier']);

// Proper nouns, codes and terms that may appear in Spanish text as-is.
const PROPER = ['BreatheEasy', 'Open-Meteo', 'Copernicus', 'CAMS', 'EPA', 'NHLBI', 'CDC', 'Brier', 'PM2.5', 'JSON', 'localStorage',
  'DSH Hacks V2', 'Houston', 'Sugar Land', 'Pasadena', 'TX', 'Phoenix', 'Delhi', 'PDF', 'L/min', 'smog', 'log-odds', 'SINTÉTICOS', 'SINTÉTICA', 'SINTÉTICO', 'IA'];

// Common English words that are not also Spanish words (so "no", "error", "plan", "real" are left out on purpose).
const ENGLISH = ['the', 'and', 'you', 'your', 'with', 'for', 'of', 'is', 'are', 'this', 'that', 'from', 'to', 'on', 'at', 'it', 'be',
  'data', 'search', 'city', 'find', 'offline', 'online', 'saved', 'loading', 'timeout', 'demo', 'synthetic', 'forecast', 'refresh',
  'tap', 'try', 'again', 'ago', 'just', 'now', 'seconds', 'minutes', 'requests', 'rate', 'limit', 'network', 'server', 'answer',
  'model', 'day', 'days', 'check', 'here', 'more', 'less', 'show', 'showing', 'last', 'new', 'cache', 'stale', 'results', 'place',
  'none', 'pick', 'found', 'available', 'within', 'didn', 'couldn', 'reach', 'too', 'many', 'made', 'up', 'people', 'air'];

test('EN and ES have exactly the same keys', () => {
  const en = Object.keys(I.en).sort(), es = Object.keys(I.es).sort();
  assert.deepEqual(es.filter(k => !(k in I.en)), [], 'keys only in ES');
  assert.deepEqual(en.filter(k => !(k in I.es)), [], 'keys only in EN');
});

test('every EN/ES pair uses the same placeholders', () => {
  Object.keys(I.en).forEach(k => assert.equal(ph(I.es[k]), ph(I.en[k]), 'placeholder mismatch: ' + k));
});

test('no Spanish string is a copy of the English one (except allowed proper nouns)', () => {
  const copied = Object.keys(I.en).filter(k => I.es[k] === I.en[k] && !SAME_OK.has(k));
  assert.deepEqual(copied, []);
});

test('no English words leak into Spanish strings (URLs, placeholders and proper nouns allowed)', () => {
  const words = new Set(ENGLISH), leaks = [];
  Object.keys(I.es).forEach(k => {
    let s = String(I.es[k]).replace(/https?:\/\/\S+/g, ' ').replace(/\b[\w.-]+\.(gov|org|com)(\/\S*)?/g, ' ').replace(/\{\w+\}/g, ' ');
    PROPER.forEach(p => { s = s.split(p).join(' '); });
    (s.toLowerCase().match(/[a-z\u00c0-\u024f']+/g) || []).forEach(w => { if (words.has(w)) leaks.push(k + ': ' + w); });
  });
  assert.deepEqual(leaks, []);
});

test('the guard itself catches English (sanity)', () => {
  const s = 'Showing the forecast saved on this device'.toLowerCase().match(/[a-z']+/g);
  assert.ok(s.some(w => ENGLISH.includes(w)));
});
