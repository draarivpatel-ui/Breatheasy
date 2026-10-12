// Saved-data guard: a copy saved by an older version or edited by hand never breaks the page (js/store.js).
const test = require('node:test'); const assert = require('node:assert/strict');
const S = require('../js/store.js'); const D = require('../js/demo.js');
const KEYS = ['sugarland', 'houston', 'pasadena'];
const fresh = (lang) => ({ lang, place: 'sugarland', custom: null, searched: null, plan: { triggers: [] }, entries: [] });

test('table: whatever is saved, the result is a state the app can render', () => {
  const TABLE = [ // [saved value, navigator.language, expected fields]
    [null, 'en-US', fresh('en')], [null, 'es-MX', fresh('es')], ['hello', 'en-US', fresh('en')], [42, 'es', fresh('es')],
    [[1, 2], 'en-US', fresh('en')], [true, 'en-US', fresh('en')], [{}, undefined, fresh('en')],
    [{ lang: 'fr' }, 'es-US', fresh('es')], [{ lang: 'constructor' }, 'en-US', fresh('en')], [{ lang: 'es' }, 'en-US', fresh('es')],
  ];
  for (const [raw, nav, want] of TABLE) assert.deepEqual(S.sanitize(raw, nav, KEYS), want, JSON.stringify(raw));
});
test('table: place ids', () => {
  const P = (raw) => { const s = S.sanitize(raw, 'en', KEYS); return [s.place, s.custom, s.searched]; };
  assert.deepEqual(P({ place: 'houston' }), ['houston', null, null]);
  assert.deepEqual(P({ place: 'atlantis' }), ['sugarland', null, null]);
  assert.deepEqual(P({ place: 'toString' }), ['sugarland', null, null]);
  assert.deepEqual(P({ place: 'mine', custom: { lat: 29.7, lon: -95.4 } }), ['mine', { lat: 29.7, lon: -95.4 }, null]);
  assert.deepEqual(P({ place: 'mine', custom: null }), ['sugarland', null, null]);
  assert.deepEqual(P({ place: 'mine', custom: { lat: '29', lon: -95 } }), ['sugarland', null, null]);
  assert.deepEqual(P({ place: 'mine', custom: { lat: 91, lon: 0 } }), ['sugarland', null, null]);
  assert.deepEqual(P({ place: 'search', searched: { name: 'Denver', lat: 39.74, lon: -104.98 } }), ['search', null, { lat: 39.74, lon: -104.98, name: 'Denver' }]);
  assert.deepEqual(P({ place: 'search', searched: { lat: 39.74, lon: -104.98 } }), ['sugarland', null, null]); // no name to show
});
test('table: the plan keeps good fields and resets bad ones', () => {
  const pl = (p) => S.sanitize({ plan: p }, 'en', KEYS).plan;
  assert.deepEqual(pl('x'), { triggers: [] });
  assert.deepEqual(pl({ triggers: 'ozone' }), { personalBest: null, triggers: [] });
  assert.deepEqual(pl({ triggers: ['ozone', 'ozone', 'toString', 5, 'pollen'] }).triggers, ['ozone', 'pollen']);
  for (const [best, want] of [[400, 400], [50, 50], [900, 900], [49, null], [901, null], [410.5, null], [99999, null], ['400', null], [0, null], [-5, null], [NaN, null]])
    assert.equal(pl({ personalBest: best }).personalBest, want, String(best));
  assert.deepEqual(pl({ green: 'Flovent 2 puffs', red: 5, doctorPhone: '713-555-0100' }),
    { personalBest: null, triggers: [], green: 'Flovent 2 puffs', doctorPhone: '713-555-0100' });
});
test('table: diary rows: bad rows are dropped one by one, never the whole diary', () => {
  const good = { date: '2026-10-09', peakFlow: 380, personalBest: 400, percent: 95, symptoms: [], zone: 'green', reliever: false };
  const E = (list) => S.sanitize({ entries: list }, 'en', KEYS).entries;
  assert.deepEqual(E({ a: 1 }), []);
  assert.deepEqual(E('x'), []);
  assert.deepEqual(E([null, 5, 'x', { date: 'x' }, { date: '2026-02-30' }, { date: '2026-10-08', zone: 'purple' }, { date: '2026-10-07' }, good]), [good]);
  assert.deepEqual(E([{ date: '2026-10-08', zone: 'yellow', peakFlow: '300', symptoms: 'cough' }]), [{ date: '2026-10-08', zone: 'yellow', peakFlow: null, symptoms: [] }]);
  // one row per day (later copy wins), oldest first
  assert.deepEqual(E([{ ...good, peakFlow: 300 }, { ...good, date: '2026-10-01' }, good]).map(e => [e.date, e.peakFlow]), [['2026-10-01', 380], ['2026-10-09', 380]]);
});
test('a diary the app itself wrote passes through unchanged (incl. the SYNTHETIC demo)', () => {
  const demo = D.generate('2026-10-10', 75, 400, 42);
  assert.deepEqual(S.demo(demo), demo);
  assert.deepEqual(S.sanitize({ lang: 'es', place: 'pasadena', plan: { personalBest: 400, triggers: ['ozone'] }, entries: demo }, 'en', KEYS).entries, demo);
  assert.equal(S.demo([]), null); assert.equal(S.demo('x'), null); assert.equal(S.demo(null), null);
});
test('table: ?today= accepts real days only', () => {
  for (const [s, ok] of [['2026-10-10', true], ['2024-02-29', true], ['2026-02-29', false], ['2026-02-30', false], ['2026-13-45', false],
    ['0000-00-00', false], ['2026-00-10', false], ['2026-10-00', false], ['2026-04-31', false], ['2026-10-10x', false], ['', false], [null, false]])
    assert.equal(S.validDay(s), ok, String(s));
});
