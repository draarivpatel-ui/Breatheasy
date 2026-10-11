// Per-place forecast cache: 429 / outage fallback, 30-min fresh window, 3-h limit, honest "as of" labels.
const test = require('node:test'); const assert = require('node:assert/strict');
const C = require('../js/fccache.js'); const F = require('../js/forecast.js'); const I = require('../js/i18n.js');

function mem() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}
const MIN = 60000, T0 = Date.UTC(2026, 9, 11, 15, 0);
const DATA = { days: [{ date: '2026-10-12', aqi: 64 }], timezone: 'America/Chicago', fetchedAt: '2026-10-11T15:00:00Z' };
const SL = [29.6197, -95.6349], LON = [51.5085, -0.1257];
const rate429 = () => { const e = new Error('Minutely API request limit exceeded'); e.status = 429; e.rateLimited = true; return Promise.reject(e); };

test('placeKey rounds to ~1 km so the same city reuses one entry', () => {
  assert.equal(C.placeKey(29.61971, -95.63492), '29.62,-95.63');
  assert.equal(C.placeKey(...SL), C.placeKey(29.6201, -95.6311));
  assert.notEqual(C.placeKey(...SL), C.placeKey(...LON));
});

test('first load goes to the network and saves the answer for that place only', async () => {
  const s = mem(); let calls = 0;
  const r = await C.getForecast({ lat: SL[0], lon: SL[1], storage: s, now: T0, load: () => { calls++; return Promise.resolve(DATA); } });
  assert.equal(r.source, 'network'); assert.equal(r.ageMs, 0); assert.equal(calls, 1); assert.deepEqual(r.data, DATA);
  assert.ok(C.get(s, ...SL, T0)); assert.equal(C.get(s, ...LON, T0), null);
});

test('within 30 minutes the saved answer is used without a network call', async () => {
  const s = mem(); C.put(s, ...SL, DATA, T0);
  const r = await C.getForecast({ lat: SL[0], lon: SL[1], storage: s, now: T0 + 29 * MIN, load: () => { throw new Error('should not fetch'); } });
  assert.equal(r.source, 'cache'); assert.equal(r.ageMs, 29 * MIN);
});

test('Refresh (force) skips the fresh cache and asks the network', async () => {
  const s = mem(); C.put(s, ...SL, DATA, T0); let calls = 0;
  const r = await C.getForecast({ lat: SL[0], lon: SL[1], storage: s, now: T0 + 5 * MIN, force: true, load: () => { calls++; return Promise.resolve(DATA); } });
  assert.equal(r.source, 'network'); assert.equal(calls, 1);
});

test('after 30 minutes a 429 falls back to the saved answer, with its true age and the error', async () => {
  const s = mem(); C.put(s, ...SL, DATA, T0);
  const r = await C.getForecast({ lat: SL[0], lon: SL[1], storage: s, now: T0 + 95 * MIN, load: rate429 });
  assert.equal(r.source, 'fallback'); assert.equal(r.ageMs, 95 * MIN); assert.equal(r.savedAt, T0);
  assert.ok(r.error.rateLimited); assert.deepEqual(r.data, DATA);
});

test('a forced refresh that hits a 429 still falls back (even inside 30 min)', async () => {
  const s = mem(); C.put(s, ...SL, DATA, T0);
  const r = await C.getForecast({ lat: SL[0], lon: SL[1], storage: s, now: T0 + 2 * MIN, force: true, load: rate429 });
  assert.equal(r.source, 'fallback'); assert.equal(r.ageMs, 2 * MIN);
});

test('fallback stops at 3 hours: older answers are not shown (noData)', async () => {
  const s = mem(); C.put(s, ...SL, DATA, T0);
  const ok = await C.getForecast({ lat: SL[0], lon: SL[1], storage: s, now: T0 + 180 * MIN, load: rate429 });
  assert.equal(ok.source, 'fallback');
  await assert.rejects(C.getForecast({ lat: SL[0], lon: SL[1], storage: s, now: T0 + 181 * MIN, load: rate429 }),
    e => e.noData === true && e.rateLimited === true && /limit exceeded/.test(e.message));
});

test('no saved answer and a failed API -> noData error (never another place\u2019s forecast)', async () => {
  const s = mem(); C.put(s, ...LON, DATA, T0);
  await assert.rejects(C.getForecast({ lat: SL[0], lon: SL[1], storage: s, now: T0 + MIN, load: rate429 }), e => e.noData === true);
  await assert.rejects(C.getForecast({ lat: SL[0], lon: SL[1], storage: s, now: T0, load: () => Promise.reject('offline') }), e => e instanceof Error && e.noData);
});

test('a good network answer replaces the old one and resets its age', async () => {
  const s = mem(); C.put(s, ...SL, DATA, T0);
  const fresh = Object.assign({}, DATA, { fetchedAt: 'new' });
  await C.getForecast({ lat: SL[0], lon: SL[1], storage: s, now: T0 + 40 * MIN, load: () => Promise.resolve(fresh) });
  const g = C.get(s, ...SL, T0 + 41 * MIN);
  assert.equal(g.data.fetchedAt, 'new'); assert.equal(g.ageMs, MIN); assert.equal(g.fresh, true);
});

test('cache prunes entries past 3 h, keeps at most 8 places, and survives junk or full storage', () => {
  const s = mem();
  C.put(s, ...LON, DATA, T0);
  for (let i = 0; i < 10; i++) C.put(s, 10 + i, 20, DATA, T0 + 200 * MIN + i);
  const all = JSON.parse(s.getItem(C.KEY));
  assert.equal(Object.keys(all).length, 8); assert.ok(!all[C.placeKey(...LON)]); assert.ok(all[C.placeKey(19, 20)]);
  s.setItem(C.KEY, 'not json'); assert.equal(C.get(s, ...SL, T0), null);
  s.setItem(C.KEY, JSON.stringify({ [C.placeKey(...SL)]: { savedAt: T0, data: { nope: 1 } } })); assert.equal(C.get(s, ...SL, T0), null);
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem() {} };
  assert.equal(C.put(full, ...SL, DATA, T0), false);
  C.clear(s); assert.equal(s.getItem(C.KEY), null);
});

test('a saved answer from the future (clock changed) is not trusted', () => {
  const s = mem(); C.put(s, ...SL, DATA, T0 + 60 * MIN);
  assert.equal(C.get(s, ...SL, T0), null);
});

test('"as of N min ago" label in English and Spanish', () => {
  const lab = (lang, ms) => { const a = C.ageParts(ms); return I.t(lang, a.key, { n: a.n, h: a.h, m: a.m }); };
  assert.equal(lab('en', 20000), 'as of just now'); assert.equal(lab('es', 20000), 'de hace un momento');
  assert.equal(lab('en', 12 * MIN + 59000), 'as of 12 min ago'); assert.equal(lab('es', 12 * MIN), 'de hace 12 min');
  assert.equal(lab('en', 95 * MIN), 'as of 1 h 35 min ago'); assert.equal(lab('es', 180 * MIN), 'de hace 3 h 0 min');
  assert.equal(C.ageParts(-5000).key, 'as_of_now');
});

test('status strings exist in both languages and fill every placeholder', () => {
  const p = { asof: 'as of 5 min ago', reason: 'too many requests', place: 'Sugar Land, TX' };
  ['fc_cached', 'fc_offline', 'fc_fallback', 'fc_nodata', 'reason_429', 'reason_offline', 'as_of_now', 'as_of_min', 'as_of_hm'].forEach(k => {
    assert.ok(I.en[k] && I.es[k], k);
    ['en', 'es'].forEach(l => assert.doesNotMatch(I.t(l, k, Object.assign({ n: 5, h: 1, m: 2 }, p)), /\{\w+\}/, l + ':' + k));
  });
  assert.match(I.t('en', 'fc_nodata', p), /No air-quality data for Sugar Land, TX/);
  assert.match(I.t('es', 'fc_nodata', p), /No hay datos de calidad del aire para Sugar Land, TX/);
});

test('fetchJson marks a 429 as rateLimited and keeps Open-Meteo\u2019s reason; tolerates a non-JSON body', async () => {
  const res = (status, body) => () => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(body) });
  await assert.rejects(F.fetchJson('x', res(429, '{"error":true,"reason":"Minutely API request limit exceeded"}')),
    e => e.rateLimited === true && e.status === 429 && e.message === 'Minutely API request limit exceeded');
  await assert.rejects(F.fetchJson('x', res(429, '<html>Too Many Requests</html>')), e => e.rateLimited && e.message === 'HTTP 429');
  await assert.rejects(F.fetchJson('x', () => Promise.reject(new TypeError('Failed to fetch'))), e => e.status === 0 && !e.rateLimited);
  assert.deepEqual(await F.fetchJson('x', res(200, '{"a":1}')), { a: 1 });
});
