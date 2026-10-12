// Devpost-claims check: every number the frozen DSH Hacks V2 page quotes (https://devpost.com/software/breatheeasy-7y9qpg,
// submitted Oct 11, 2026) is re-computed here from the shipped code, so a later change cannot quietly make the page false.
const test = require('node:test'); const assert = require('node:assert/strict');
const F = require('../js/forecast.js'); const M = require('../js/model.js'); const D = require('../js/demo.js');
const V = require('../js/validate.js'); const Z = require('../js/zones.js');
const aq = require('./fixtures/airquality-sugarland-2026-10-10.json');
const pct = x => Math.round(x * 100);

test('"On the real Oct 10, 2026 Sugar Land forecast our EPA-method AQI is 140; Open-Meteo\'s own peak hourly U.S. AQI is 143"', () => {
  const d = F.dailyAirQuality(aq.hourly).find(x => x.date === '2026-10-10');
  assert.equal(d.aqi, 140); assert.equal(d.openMeteoMaxAqi, 143); assert.equal(d.dominant, 'ozone');
});
test('"scores 84% accuracy on 19 held-out days vs. a 68% baseline"; "ranks pollen and ozone as the top two links"', () => {
  const r = M.train(D.generate('2026-10-10', 75, 400, 42));
  assert.equal(r.evaluation.testDays, 19); assert.equal(pct(r.evaluation.accuracy), 84); assert.equal(pct(r.evaluation.baseline), 68);
  const top = r.weights.slice().sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 2).map(w => w.feature);
  assert.deepEqual(top.sort(), ['ozone', 'pollen']);
});
test('"Pollen level: High ▲ ×3.02 odds" (explain-a-day example exists on the SYNTHETIC demo)', () => {
  const d = D.generate('2026-10-10', 75, 400, 42);
  const hit = d.some(e => { const x = M.explainDay(d, e.date); return x.contributions.some(c => c.key === 'pollenLevel' && c.value === 3 && c.oddsRatio.toFixed(2) === '3.02'); });
  assert.ok(hit);
});
test('SYNTHETIC cohort: "12 made-up people, 100 later days each"; at 60 days ECE 3.8, said 57% / 55% rough, Brier 0.172 vs 0.252 vs 0.157', () => {
  const R = V.run(); const s = R.calibrationSummary;
  assert.equal(s.n, 1200);
  assert.equal((R.reliability.ece * 100).toFixed(1), '3.8');
  assert.equal(pct(R.reliability.meanP), 57); assert.equal(pct(R.reliability.observed), 55);
  assert.equal(s.brier.toFixed(3), '0.172'); assert.equal(s.brierClimatology.toFixed(3), '0.252'); assert.equal(s.brierOracle.toFixed(3), '0.157');
  const at = n => R.sensitivity.find(x => x.days === n).summary;
  assert.equal(pct(at(14).accuracy), 62); assert.equal(pct(at(60).accuracy), 75); assert.equal(pct(at(60).oracleAccuracy), 77);
});
test('"It refuses to predict until it has 14 days with some good and some rough days"', () => {
  assert.equal(M.train(D.generate('2026-10-10', 13, 400, 42)).status, 'insufficient');
  const allGood = Array.from({ length: 30 }, (_, i) => ({ date: D.addDays('2026-09-01', i), zone: 'green', aqiO3: 50 }));
  assert.equal(M.train(allGood).status, 'insufficient');
});
test('"sorts you into your plan\'s green, yellow or red zone using the NHLBI cut-offs (80% / 50% of personal best)"', () => {
  const z = pf => Z.assess({ peakFlow: pf, personalBest: 500, symptoms: [] }).zone;
  assert.equal(z(400), 'green'); assert.equal(z(399), 'yellow'); assert.equal(z(250), 'yellow'); assert.equal(z(249), 'red');
});
test('"the worse of peak flow and symptoms wins"', () => {
  const r = Z.assess({ peakFlow: 480, personalBest: 500, symptoms: ['blue_lips'] });
  assert.equal(r.zone, 'red'); assert.equal(r.danger, true);
});
