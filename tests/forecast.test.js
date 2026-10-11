// Daily summaries from a real Open-Meteo response saved as a fixture (Sugar Land TX, fetched 2026-10-10).
const test = require('node:test'); const assert = require('node:assert/strict');
const F = require('../js/forecast.js');
const aq = require('./fixtures/airquality-sugarland-2026-10-10.json');
const wx = require('./fixtures/weather-sugarland-2026-10-10.json');

test('URLs request the variables the app reads, with no API key', () => {
  const u = F.aqUrl(29.6197, -95.6349);
  assert.match(u, /^https:\/\/air-quality-api\.open-meteo\.com\/v1\/air-quality\?/);
  ['pm2_5', 'ozone', 'us_aqi', 'grass_pollen', 'ragweed_pollen', 'past_days=7', 'forecast_days=4'].forEach(s => assert.ok(u.includes(s), s));
  assert.ok(!/key=/i.test(u));
  const w = F.wxUrl(29.6197, -95.6349);
  ['temperature_2m_max', 'relative_humidity_2m_mean', 'temperature_unit=fahrenheit'].forEach(s => assert.ok(w.includes(s), s));
});
test('one summary per date; 11 days in fixture', () => {
  const days = F.dailyAirQuality(aq.hourly);
  assert.equal(days.length, 11);
  assert.equal(days[0].date, '2026-10-03');
  assert.ok(days.every(d => d.hours === 24));
});
test('2026-10-10: ozone-driven Unhealthy-for-Sensitive-Groups day', () => {
  const d = F.dailyAirQuality(aq.hourly).find(x => x.date === '2026-10-10');
  assert.equal(d.dominant, 'ozone');
  assert.equal(d.o3ppm, 0.083);
  assert.equal(d.aqiO3, 140);
  assert.equal(d.aqi, 140);
  assert.equal(d.pm25, 18.1);
  assert.equal(d.aqiPM25, 68);
  assert.equal(d.openMeteoMaxAqi, 143);
  // our EPA-method daily AQI agrees with Open-Meteo's own hourly peak within a few points
  assert.ok(Math.abs(d.aqi - d.openMeteoMaxAqi) <= 5);
});
test('8-hour ozone window begins on the day and needs 6 of 8 valid hours', () => {
  const times = Array.from({ length: 30 }, (_, i) => `2026-01-0${i < 24 ? 1 : 2}T${String(i % 24).padStart(2, '0')}:00`);
  const oz = Array(30).fill(100);
  assert.equal(F.maxOzone8h(times, oz, '2026-01-01'), 100);
  const holes = oz.map((v, i) => (i % 8 < 3 ? null : v)); // only 5 of every 8 valid
  assert.equal(F.maxOzone8h(times, holes, '2026-01-01'), null);
});
test('PM2.5 day needs at least 18 valid hours', () => {
  const h = { time: Array.from({ length: 24 }, (_, i) => `2026-01-01T${String(i).padStart(2, '0')}:00`), pm2_5: Array(24).fill(null), ozone: Array(24).fill(null) };
  for (let i = 0; i < 17; i++) h.pm2_5[i] = 20;
  assert.equal(F.dailyAirQuality(h)[0].pm25, null);
  h.pm2_5[17] = 20;
  assert.equal(F.dailyAirQuality(h)[0].pm25, 20);
});
test('North America has no Open-Meteo pollen: pollen stays null, not zero', () => {
  const days = F.mergeDays(F.dailyAirQuality(aq.hourly), wx.daily);
  assert.ok(days.every(d => d.pollen === null && d.pollenLevel === null));
});
test('pollen level uses National Allergy Bureau ranges per type', () => {
  assert.equal(F.pollenLevel(null), null);
  assert.equal(F.pollenLevel({ grass: 0 }), 0);
  assert.equal(F.pollenLevel({ grass: 4 }), 1);
  assert.equal(F.pollenLevel({ grass: 5 }), 2);
  assert.equal(F.pollenLevel({ grass: 20 }), 3);
  assert.equal(F.pollenLevel({ birch: 89 }), 2);
  assert.equal(F.pollenLevel({ birch: 90 }), 3);
  assert.equal(F.pollenLevel({ ragweed: 9, birch: 14 }), 1);
});
test('weather merges by date', () => {
  const d = F.mergeDays(F.dailyAirQuality(aq.hourly), wx.daily).find(x => x.date === '2026-10-11');
  assert.equal(d.tempMaxF, 92.5); assert.equal(d.humidity, 65);
});
test('load() parses both APIs and tolerates a weather failure', async () => {
  const fake = url => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.includes('air-quality') ? aq : { error: true, reason: 'boom' }) });
  const res = await F.load(29.6197, -95.6349, fake);
  assert.equal(res.days.length, 11); assert.equal(res.days[0].tempMaxF, null);
});
test('load() surfaces the API error reason (e.g. rate limit)', async () => {
  const fake = () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: true, reason: 'Daily API request limit exceeded' }) });
  await assert.rejects(F.load(1, 2, fake), /limit exceeded/);
});
