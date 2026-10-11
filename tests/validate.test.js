// SYNTHETIC model check: calibration (reliability + Brier) and sensitivity to the number of logged days.
const test = require('node:test'); const assert = require('node:assert/strict');
const V = require('../js/validate.js'); const D = require('../js/demo.js'); const M = require('../js/model.js');

const R = V.run(); // deterministic; ~0.3 s

test('Brier score math', () => {
  assert.equal(V.brier([{ p: 1, y: 1 }, { p: 0, y: 0 }]), 0);
  assert.equal(V.brier([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }]), 0.25);
  assert.equal(V.brier([{ q: 0.2, y: 0 }], 'q').toFixed(2), '0.04');
});
test('reliability bins: counts, means, and expected calibration error', () => {
  const preds = [{ p: 0.1, y: 0 }, { p: 0.15, y: 0 }, { p: 0.9, y: 1 }, { p: 0.95, y: 0 }, { p: 1, y: 1 }];
  const r = V.reliability(preds, 5);
  assert.equal(r.bins.length, 5);
  assert.deepEqual(r.bins.map(b => b.n), [2, 0, 0, 0, 3]); // p = 1 lands in the top bin
  assert.equal(r.bins[1].meanP, null);
  assert.ok(Math.abs(r.bins[4].observed - 2 / 3) < 1e-12);
  const want = (2 / 5) * 0.125 + (3 / 5) * Math.abs((0.9 + 0.95 + 1) / 3 - 2 / 3);
  assert.ok(Math.abs(r.ece - want) < 1e-12);
});
test('the check is synthetic, deterministic, and only scores days after the training window', () => {
  assert.equal(R.synthetic, true);
  assert.deepEqual(V.run().sensitivity.map(s => s.summary && s.summary.brier), R.sensitivity.map(s => s.summary && s.summary.brier));
  const rows = M.rows(D.generate('2026-10-10', 40, 400, 7, true));
  assert.equal(V.heldOut(rows, 20, 15).length, 15);
});
test('withTruth only adds the hidden probability; the app demo has none', () => {
  const plain = D.generate('2026-10-10', 30, 400, 42), truth = D.generate('2026-10-10', 30, 400, 42, true);
  assert.ok(plain.every(e => !('trueP' in e)));
  assert.ok(truth.every(e => e.trueP > 0 && e.trueP < 1));
  assert.deepEqual(truth.map(e => e.zone), plain.map(e => e.zone));
});
test('calibrated on held-out SYNTHETIC days: ECE under 6 points, mean prediction within 5 points of reality', () => {
  assert.ok(R.reliability.ece < 0.06, 'ECE ' + R.reliability.ece);
  assert.ok(Math.abs(R.reliability.meanP - R.reliability.observed) < 0.05);
  R.reliability.bins.filter(b => b.n >= 50).forEach(b => assert.ok(Math.abs(b.meanP - b.observed) < 0.12, JSON.stringify(b)));
});
test('Brier: beats guessing the base rate, and stays above the best possible score', () => {
  const s = R.calibrationSummary;
  assert.ok(s.brier < s.brierClimatology - 0.03, JSON.stringify(s));
  assert.ok(s.brier > s.brierOracle, 'cannot beat the generator itself');
  assert.ok(s.accuracy > s.baselineAccuracy + 0.1);
});
test('sensitivity: more logged days -> better Brier; 14 days is the weakest point', () => {
  const rows = R.sensitivity.filter(s => s.summary);
  const first = rows[0].summary.brier, last = rows[rows.length - 1].summary.brier;
  assert.equal(rows[0].days, 14);
  assert.ok(last < first - 0.05, first + ' -> ' + last);
  assert.ok(rows.every(r => r.summary.brier >= last - 0.01), 'no size is much better than the largest');
  assert.ok(rows[rows.length - 1].summary.accuracy > rows[0].summary.accuracy);
});
