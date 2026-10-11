// On-device trigger model: determinism, recovery of a planted pattern, honest evaluation, explanations.
const test = require('node:test'); const assert = require('node:assert/strict');
const M = require('../js/model.js'); const D = require('../js/demo.js');

test('needs enough days and both outcomes before predicting', () => {
  const few = D.generate('2026-10-10', 10, 400, 1);
  const r = M.train(few);
  assert.equal(r.status, 'insufficient'); assert.equal(r.need.days, 4);
  const allGood = Array.from({ length: 20 }, (_, i) => ({ date: D.addDays('2026-09-01', i), zone: 'green', aqiO3: 50 }));
  const r2 = M.train(allGood);
  assert.equal(r2.status, 'insufficient'); assert.equal(r2.need.rough, 3);
});
test('demo data is clearly synthetic', () => {
  const d = D.generate('2026-10-10', 75, 400, 42);
  assert.equal(d.length, 75); assert.ok(d.every(e => e.synthetic === true));
  assert.equal(d[d.length - 1].date, '2026-10-10');
});
test('training is deterministic', () => {
  const d = D.generate('2026-10-10', 75, 400, 42);
  assert.deepEqual(M.train(d).model.w, M.train(d).model.w);
});
test('recovers the planted pattern: ozone and pollen push toward rough days; beats baseline', () => {
  const r = M.train(D.generate('2026-10-10', 75, 400, 42));
  assert.equal(r.status, 'ready');
  const w = Object.fromEntries(r.weights.map(x => [x.feature, x.weight]));
  assert.ok(w.ozone > 0.3, 'ozone weight ' + w.ozone);
  assert.ok(w.pollen > 0.3, 'pollen weight ' + w.pollen);
  assert.ok(Math.abs(w.humidity) < w.ozone && Math.abs(w.pm25) < w.ozone, 'unplanted features stay weaker');
  assert.ok(r.evaluation.accuracy > r.evaluation.baseline, JSON.stringify(r.evaluation));
});
test('higher ozone and pollen raise predicted risk, all else equal', () => {
  const r = M.train(D.generate('2026-10-10', 75, 400, 42));
  const base = { aqiO3: 50, aqiPM25: 45, pollenLevel: 0, tempMaxF: 82, humidity: 55, prevBad: 0 };
  const worse = Object.assign({}, base, { aqiO3: 160, pollenLevel: 3 });
  assert.ok(M.predict(r.model, worse).p > M.predict(r.model, base).p + 0.2);
});
test('explanations add up: logit = bias + sum of contributions', () => {
  const r = M.train(D.generate('2026-10-10', 75, 400, 42));
  const x = { aqiO3: 120, aqiPM25: 60, pollenLevel: 2, tempMaxF: 90, humidity: 70, prevBad: 1 };
  const p = M.predict(r.model, x);
  const logit = r.model.b + p.contributions.reduce((a, c) => a + c.contribution, 0);
  assert.ok(Math.abs(M.sigmoid(logit) - p.p) < 1e-12);
  assert.equal(p.contributions.length, 6);
  for (let i = 1; i < p.contributions.length; i++) assert.ok(Math.abs(p.contributions[i - 1].contribution) >= Math.abs(p.contributions[i].contribution));
});
test('missing features are imputed at the mean (zero contribution)', () => {
  const r = M.train(D.generate('2026-10-10', 75, 400, 42));
  const p = M.predict(r.model, { aqiO3: 100 });
  p.contributions.filter(c => c.key !== 'aqiO3').forEach(c => assert.ok(c.contribution === 0));
});
test('prevBad feature links each day to the day before', () => {
  const rows = M.rows([{ date: '2026-10-02', zone: 'green' }, { date: '2026-10-01', zone: 'yellow' }, { date: '2026-10-04', zone: 'red' }]);
  assert.deepEqual(rows.map(r => r.x.prevBad), [null, 1, null]);
  assert.equal(M.prevDate('2026-03-01'), '2026-02-28');
});
test('risk bands', () => {
  assert.equal(M.band(0.1), 'low'); assert.equal(M.band(0.35), 'elevated'); assert.equal(M.band(0.6), 'high');
});
