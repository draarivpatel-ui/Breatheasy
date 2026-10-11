/* BreatheEasy: how much can the on-device model be trusted? (pure functions, no DOM, no network)
 *
 * Everything here runs on SYNTHETIC data only: a cohort of made-up people produced by js/demo.js,
 * whose hidden "true" risk for each day is known. That lets us measure three things honestly:
 *   1. Calibration: when the model says 30 %, do about 30 % of those days turn out rough?
 *      (reliability bins, expected calibration error, mean predicted vs observed rate)
 *   2. Brier score on held-out days, next to two reference points: guessing the base rate every day
 *      (climatology) and the best possible score, from the generator's own hidden probabilities.
 *   3. Sensitivity: how accuracy and Brier change with the number of logged days the model trains on.
 * Every test day comes AFTER the training days (no peeking at the future).
 * These numbers describe the method on made-up data. They are not a clinical validation.
 */
(function (root) {
  'use strict';
  var M = root.BE_Model || (typeof require !== 'undefined' ? require('./model.js') : null);
  var D = root.BE_Demo || (typeof require !== 'undefined' ? require('./demo.js') : null);

  var DEFAULTS = {
    seeds: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112], // 12 made-up people
    seriesDays: 200, testDays: 100,
    sizes: [14, 21, 30, 45, 60, 90], // logged days used for training
    reliabilityAt: 60, bins: 5, endDate: '2026-10-10'
  };

  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : NaN; }

  /** Brier score: mean squared gap between predicted probability and what happened (0 = perfect). */
  function brier(preds, key) {
    key = key || 'p';
    return mean(preds.map(function (r) { return (r[key] - r.y) * (r[key] - r.y); }));
  }

  /** Equal-width reliability bins over [0, 1]. Empty bins are kept with n = 0 so the plot is stable. */
  function reliability(preds, nBins) {
    nBins = nBins || 5;
    var bins = [];
    for (var b = 0; b < nBins; b++) bins.push({ lo: b / nBins, hi: (b + 1) / nBins, n: 0, sumP: 0, sumY: 0 });
    preds.forEach(function (r) {
      var i = Math.min(nBins - 1, Math.floor(r.p * nBins));
      bins[i].n++; bins[i].sumP += r.p; bins[i].sumY += r.y;
    });
    var ece = 0, total = preds.length;
    var out = bins.map(function (x) {
      var mp = x.n ? x.sumP / x.n : null, oy = x.n ? x.sumY / x.n : null;
      if (x.n) ece += (x.n / total) * Math.abs(mp - oy);
      return { lo: x.lo, hi: x.hi, n: x.n, meanP: mp, observed: oy };
    });
    return { bins: out, ece: total ? ece : NaN,
      meanP: mean(preds.map(function (r) { return r.p; })), observed: mean(preds.map(function (r) { return r.y; })) };
  }

  /** Mirror the app's rule: the model only speaks with >= MIN_DAYS days and >= 3 of each outcome. */
  function trainable(rows) {
    var pos = rows.reduce(function (a, r) { return a + r.y; }, 0);
    return rows.length >= M.MIN_DAYS && pos >= 3 && rows.length - pos >= 3;
  }

  /** Train on `n` days that end right before the test window, predict every test day. */
  function heldOut(rows, n, testDays) {
    var testStart = rows.length - testDays;
    var train = rows.slice(testStart - n, testStart), test = rows.slice(testStart);
    if (!trainable(train)) return null;
    var model = M.fit(train);
    var base = train.reduce(function (a, r) { return a + r.y; }, 0) / train.length;
    var majority = base >= 0.5 ? 1 : 0;
    return test.map(function (r) {
      return { p: M.predict(model, r.x).p, y: r.y, base: base, majority: majority, trueP: r.trueP };
    });
  }

  function summarize(preds) {
    var acc = mean(preds.map(function (r) { return (r.p >= 0.5 ? 1 : 0) === r.y ? 1 : 0; }));
    var baseAcc = mean(preds.map(function (r) { return r.majority === r.y ? 1 : 0; }));
    var oracleAcc = mean(preds.map(function (r) { return (r.trueP >= 0.5 ? 1 : 0) === r.y ? 1 : 0; }));
    var b = brier(preds), bClim = brier(preds, 'base'), bOracle = brier(preds, 'trueP');
    return { n: preds.length, accuracy: acc, baselineAccuracy: baseAcc, oracleAccuracy: oracleAcc,
      brier: b, brierClimatology: bClim, brierOracle: bOracle, skill: 1 - b / bClim };
  }

  /** The full SYNTHETIC check. Deterministic: same options -> same numbers. */
  function run(opts) {
    var o = {}; Object.keys(DEFAULTS).forEach(function (k) { o[k] = opts && opts[k] != null ? opts[k] : DEFAULTS[k]; });
    var people = o.seeds.map(function (seed) {
      var entries = D.generate(o.endDate, o.seriesDays, 400, seed, true);
      var rows = M.rows(entries);
      rows.forEach(function (r, i) { r.trueP = entries[i].trueP; }); // rows() keeps date order
      return rows;
    });
    var sensitivity = o.sizes.map(function (n) {
      var pooled = [], waited = 0;
      people.forEach(function (rows) {
        var p = heldOut(rows, n, o.testDays);
        if (p) pooled = pooled.concat(p); else waited++;
      });
      var s = pooled.length ? summarize(pooled) : null;
      return { days: n, people: o.seeds.length - waited, waited: waited, summary: s, preds: n === o.reliabilityAt ? pooled : null };
    });
    var at = sensitivity.filter(function (s) { return s.days === o.reliabilityAt; })[0];
    var rel = at && at.preds && at.preds.length ? reliability(at.preds, o.bins) : null;
    sensitivity.forEach(function (s) { delete s.preds; });
    return { synthetic: true, people: o.seeds.length, seriesDays: o.seriesDays, testDays: o.testDays,
      reliabilityAt: o.reliabilityAt, reliability: rel, calibrationSummary: at ? at.summary : null, sensitivity: sensitivity };
  }

  var api = { DEFAULTS: DEFAULTS, brier: brier, reliability: reliability, heldOut: heldOut, summarize: summarize, run: run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Validate = api;
})(this);
