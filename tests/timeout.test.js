// Slow / offline network: Open-Meteo requests give up after 8 s (AbortController), and the cache keeps the last answer.
const test = require('node:test'); const assert = require('node:assert/strict');
const F = require('../js/forecast.js'); const C = require('../js/fccache.js'); const I = require('../js/i18n.js');

const ok = body => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
// A fetch that never answers on its own, but rejects with AbortError when its signal fires (like the browser).
function hanging(seen) {
  return (url, init) => new Promise((resolve, reject) => {
    seen && seen.push(init);
    if (init && init.signal) init.signal.addEventListener('abort', () => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; reject(e); });
  });
}
function mem() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const DATA = { days: [{ date: '2026-10-12', aqi: 64 }], timezone: 'America/Chicago', fetchedAt: '2026-10-11T15:00:00Z' };

test('default Open-Meteo timeout is 8 seconds', () => {
  assert.equal(F.TIMEOUT_MS, 8000);
});

test('fetchJson passes an AbortSignal and aborts it when the timeout fires', async () => {
  const seen = [];
  const t0 = Date.now();
  await assert.rejects(F.fetchJson('https://air-quality-api.open-meteo.com/x', hanging(seen), 40),
    e => e.timedOut === true && e.status === 0 && e.rateLimited === false && /timeout/.test(e.message));
  assert.ok(Date.now() - t0 < 2000, 'gave up quickly');
  assert.ok(seen[0] && seen[0].signal, 'signal passed to fetch');
  assert.equal(seen[0].signal.aborted, true, 'request was aborted');
});

test('a fetch that ignores the signal still cannot hang: the timer rejects anyway', async () => {
  const deaf = () => new Promise(() => {});
  await assert.rejects(F.fetchJson('u', deaf, 30), e => e.timedOut === true);
});

test('a fast answer wins and is not marked as a timeout', async () => {
  const j = await F.fetchJson('u', () => ok({ hourly: {} }), 50);
  assert.deepEqual(j, { hourly: {} });
});

test('a 429 is still a rate limit, not a timeout', async () => {
  const fake = () => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve('{"error":true,"reason":"Minutely API request limit exceeded"}') });
  await assert.rejects(F.fetchJson('u', fake, 50), e => e.rateLimited === true && e.timedOut === false && e.status === 429);
});

test('a plain network failure (e.g. offline) is not a timeout', async () => {
  const down = () => Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(F.fetchJson('u', down, 50), e => e.timedOut === false && e.status === 0 && /Failed to fetch/.test(e.message));
});

test('load(): an air-quality timeout rejects with timedOut; a weather timeout alone is tolerated', async () => {
  await assert.rejects(F.load(1, 2, hanging(), 30), e => e.timedOut === true);
  const aq = { timezone: 'America/Chicago', hourly: { time: [], pm2_5: [], ozone: [] } };
  const mixed = (url, init) => (url.includes('air-quality') ? ok(aq) : hanging()(url, init));
  const res = await F.load(1, 2, mixed, 30);
  assert.ok(Array.isArray(res.days));
});

test('timeout + saved answer -> cache fallback keeps the last result, with the timeout error attached', async () => {
  const s = mem(), T0 = Date.UTC(2026, 9, 11, 15, 0);
  C.put(s, 29.6197, -95.6349, DATA, T0);
  const r = await C.getForecast({ lat: 29.6197, lon: -95.6349, storage: s, now: T0 + 40 * 60000,
    load: (lat, lon) => F.load(lat, lon, hanging(), 30) });
  assert.equal(r.source, 'fallback'); assert.deepEqual(r.data, DATA); assert.ok(r.error.timedOut);
});

test('timeout + nothing saved -> noData error that still says it timed out', async () => {
  await assert.rejects(C.getForecast({ lat: 1, lon: 2, storage: mem(), now: Date.now(), load: (a, b) => F.load(a, b, hanging(), 30) }),
    e => e.noData === true && e.timedOut === true);
});

test('timeout and offline messages exist in English and Spanish', () => {
  const en = I.t('en', 'fc_timeout', { s: 8, asof: 'as of 40 min ago' }), es = I.t('es', 'fc_timeout', { s: 8, asof: 'de hace 40 min' });
  assert.match(en, /didn\u2019t answer within 8 seconds/); assert.match(en, /last good forecast \(as of 40 min ago\)/);
  assert.match(es, /no respondi\u00f3 en 8 segundos/); assert.match(es, /de hace 40 min/);
  assert.match(I.t('en', 'reason_timeout', { s: 8 }), /8 seconds/);
  assert.match(I.t('es', 'reason_timeout', { s: 8 }), /8 segundos/);
  assert.match(I.t('en', 'fc_offline', { asof: 'x' }), /offline/); assert.match(I.t('es', 'fc_offline', { asof: 'x' }), /sin conexi\u00f3n/);
});
