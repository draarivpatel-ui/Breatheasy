/* BreatheEasy: deterministic benchmark and validation suite (pure functions, no DOM, no network).
 *
 * Two kinds of checks, both reproducible from shipped code:
 *   1. Golden vectors: EPA AQI breakpoints, zone boundaries, calendar-day validation and saved-state
 *      guards are compared with independently written expected values. A mutation in any engine breaks
 *      exactly one expectation, and the report names it.
 *   2. A held-out model score on SYNTHETIC people: the model, three reference baselines (always
 *      guess the common answer, guess the training base rate, and the generator's own hidden
 *      probability) and explicit pass/fail bounds with an uncertainty margin.
 *
 * "Uncertainty bounds" here are honest: with n held-out days, a rate has a binomial standard error
 * of sqrt(p*(1-p)/n), so a 95 percent band is about 1.96 times that. A baseline comparison only
 * counts as a real win when the gap is larger than the combined band, not just larger than zero.
 *
 * Everything is computed from the same modules the app runs. Baseline constants below are pinned
 * values from the prior base release (Nov 14, 2026); they are the comparison target, not the
 * result of this run. There are no random draws, no clock reads and no hidden inputs.
 */
(function (root) {
  'use strict';
  function load(name, key) {
    if (typeof require !== 'undefined') return require(name);
    return root[key];
  }
  var A = null, Z = null, S = null, F = null, V = null, M = null, D = null;
  function modules() {
    if (!A) {
      A = load('./aqi.js', 'BE_AQI'); Z = load('./zones.js', 'BE_Zones'); S = load('./store.js', 'BE_Store');
      F = load('./forecast.js', 'BE_Forecast'); V = load('./validate.js', 'BE_Validate');
      M = load('./model.js', 'BE_Model'); D = load('./demo.js', 'BE_Demo');
    }
    return { A: A, Z: Z, S: S, F: F, V: V, M: M, D: D };
  }

  var ID = 'breatheasy-benchmark-v1';

  /* Baselines pinned from the prior base release. These are the numbers a regression must not cross. */
  var BASELINE = {
    id: ID,
    label: 'Prior base release (Nov 14, 2026)',
    aqiPm25: { 0: 0, 9.0: 50, 9.1: 51, 12.0: 56, 35.4: 100, 35.5: 101, 55.4: 150, 55.5: 151, 125.4: 200, 125.5: 201, 225.4: 300, 225.5: 301, 325.4: 500 },
    aqiO3: { 0: 0, 0.054: 50, 0.055: 51, 0.070: 100, 0.071: 101, 0.085: 150, 0.086: 151, 0.105: 200, 0.106: 201, 0.200: 300 },
    model: { accuracy: 0.75, brier: 0.172, climatologyBrier: 0.252, oracleBrier: 0.157, ece: 0.038 },
    /* Tolerances are explicit. AQI must match exactly; model scores may drift only this much. */
    tolerance: { aqi: 0, accuracy: 0.02, brier: 0.005, climatologyBrier: 0.005, oracleBrier: 0.005, ece: 0.005 }
  };

  function approx(a, b, tol) { return Math.abs(a - b) <= tol + 1e-12; }

  function goldenVectors() {
    var m = modules(), checks = [];
    function add(name, group, actual, expected, tol) {
      var ok = typeof expected === 'number'
        ? (tol === 0 ? actual === expected : approx(actual, expected, tol))
        : String(actual) === String(expected);
      checks.push({ id: name, group: group, actual: actual, expected: expected, tolerance: tol, pass: ok });
    }
    Object.keys(BASELINE.aqiPm25).forEach(function (c) {
      add('pm25_' + c, 'EPA AQI', m.A.aqiPM25(+c), BASELINE.aqiPm25[c], 0);
    });
    Object.keys(BASELINE.aqiO3).forEach(function (c) {
      add('o3_' + c, 'EPA AQI', m.A.aqiO3ppm(+c), BASELINE.aqiO3[c], 0);
    });
    // Independent inverse checks: a concentration just above a breakpoint must not go down in AQI.
    [9.0, 35.4, 55.4, 125.4, 225.4].forEach(function (c) {
      add('pm25_monotone_' + c, 'EPA AQI', m.A.aqiPM25(c + 0.1) >= m.A.aqiPM25(c) ? 1 : 0, 1, 0);
    });
    [0.054, 0.070, 0.085, 0.105].forEach(function (c) {
      add('o3_monotone_' + c, 'EPA AQI', m.A.aqiO3ppm(c + 0.001) >= m.A.aqiO3ppm(c) ? 1 : 0, 1, 0);
    });
    add('pm25_above_500_uncapped', 'EPA AQI', m.A.aqiPM25(350) > 500 ? 1 : 0, 1, 0);
    add('o3_capped_at_300', 'EPA AQI', m.A.aqiO3ppm(0.25), 300, 0);
    add('o3_conversion_100ug', 'EPA AQI', Math.abs(m.A.o3UgToPpm(100) - 0.050938) < 1e-5 ? 1 : 0, 1, 0);
    add('category_120_orange', 'EPA AQI', m.A.category(120).color, '#ff7e00', 0);

    // Zone logic: NHLBI 80 percent / 50 percent of personal best.
    [[400, 'green'], [399, 'yellow'], [250, 'yellow'], [249, 'red']].forEach(function (p) {
      add('zone_pf_' + p[0], 'Action-plan zones', m.Z.assess({ peakFlow: p[0], personalBest: 500, symptoms: [] }).zone, p[1], 0);
    });
    add('zone_danger_wins', 'Action-plan zones', m.Z.assess({ peakFlow: 480, personalBest: 500, symptoms: ['blue_lips'] }).zone, 'red', 0);
    add('zone_danger_flag', 'Action-plan zones', m.Z.assess({ peakFlow: 480, personalBest: 500, symptoms: ['blue_lips'] }).danger ? 1 : 0, 1, 0);
    add('zone_threshold_green', 'Action-plan zones', m.Z.thresholds(400).greenMin, 320, 0);
    add('zone_threshold_yellow', 'Action-plan zones', m.Z.thresholds(400).yellowMin, 200, 0);
    add('zone_bad_best', 'Action-plan zones', m.Z.thresholds(0), null, 0);

    // Calendar dates and saved-state guards: hand-edited or older copies must not break the page.
    [['2026-02-28', 1], ['2026-02-30', 0], ['2026-13-01', 0], ['2024-02-29', 1], ['2023-02-29', 0], ['1899-12-31', 0], ['2026-1-1', 0]].forEach(function (p) {
      add('validDay_' + p[0], 'Saved-data guards', m.S.validDay(p[0]) ? 1 : 0, p[1], 0);
    });
    var st = m.S.sanitize({ lang: 'fr', place: 'nowhere', plan: { personalBest: 99999 }, entries: [{ date: '2026-02-30', zone: 'green' }, { date: '2026-01-05', zone: 'red' }] }, 'en', ['sugarland', 'houston', 'pasadena']);
    add('sanitize_lang_fallback', 'Saved-data guards', st.lang, 'en', 0);
    add('sanitize_place_fallback', 'Saved-data guards', st.place, 'sugarland', 0);
    add('sanitize_drops_bad_row', 'Saved-data guards', st.entries.length, 1, 0);
    add('sanitize_caps_best', 'Saved-data guards', st.plan.personalBest, null, 0);

    // Forecast aggregation: the EPA 7 AM to 11 PM rule and 75 percent completeness.
    var time = [];
    for (var h = 0; h < 48; h++) time.push('2026-07-0' + (1 + Math.floor(h / 24)) + 'T' + String(h % 24).padStart(2, '0') + ':00');
    var ug = 0.078 * 1000 * 48.0 / 24.45 + 0.0001;
    var day = m.F.dailyAirQuality({ time: time, ozone: time.map(function () { return ug; }), pm2_5: time.map(function () { return 35.9; }) })[0];
    add('forecast_tad_example_aqi', 'Forecast parsing', day.aqi, 126, 0);
    add('forecast_tad_example_dominant', 'Forecast parsing', day.dominant, 'ozone', 0);
    add('forecast_tad_example_pm25', 'Forecast parsing', day.aqiPM25, 102, 0);
    var nightSpike = time.map(function (t, i) { return i < 7 ? 0.100 * 1000 * 48.0 / 24.45 + 0.0001 : ug * 0.5; });
    var nd = m.F.dailyAirQuality({ time: time, ozone: nightSpike, pm2_5: time.map(function () { return 5; }) })[0];
    add('forecast_ignores_pre_7am_spike', 'Forecast parsing', nd.aqiO3 <= 50 ? 1 : 0, 1, 0);
    add('pollen_level_high', 'Forecast parsing', m.F.pollenLevel({ grass: 250 }), 3, 0);
    add('pollen_level_null', 'Forecast parsing', m.F.pollenLevel(null), null, 0);

    // Model minimum and the honest held-out rule: no peeking at future days.
    add('model_min_days', 'Personal model', m.M.MIN_DAYS, 14, 0);
    var entries = m.D.generate('2026-10-10', 40, 400, 7, true);
    var rows = m.M.rows(entries);
    rows.forEach(function (r, i) { r.trueP = entries[i].trueP; });
    add('heldout_only_future_days', 'Personal model', m.V.heldOut(rows, 20, 15).length, 15, 0);
    add('heldout_rejects_short_train', 'Personal model', m.V.heldOut(rows, 3, 15), null, 0);
    return checks;
  }

  /* 95 percent binomial band for a rate measured on n days. */
  function band(rate, n) { return n > 0 ? 1.96 * Math.sqrt(Math.max(0, rate * (1 - rate)) / n) : 1; }

  function modelSuite() {
    var m = modules(), r = m.V.run(), s = r.calibrationSummary, rel = r.reliability;
    var n = s.n;
    var se = {
      accuracy: band(s.accuracy, n),
      baselineAccuracy: band(s.baselineAccuracy, n),
      brier: Math.sqrt(1 / (4 * n)) // conservative spread of a mean of bounded squared errors
    };
    /* Combined uncertainty for "model minus baseline": the two rates are not independent, but adding
       the bands is deliberately conservative. A win must clear that margin to count. */
    var margin = se.accuracy + se.baselineAccuracy;
    var gap = s.accuracy - s.baselineAccuracy;
    var checks = [
      { id: 'accuracy_beats_majority', label: 'Held-out accuracy beats the common-answer baseline', actual: s.accuracy, baseline: s.baselineAccuracy,
        threshold: 'gap > ' + margin.toFixed(4) + ' (combined 95 percent band)', pass: gap > margin, note: 'n = ' + n + ' held-out SYNTHETIC days' },
      { id: 'brier_beats_climatology', label: 'Brier score beats guessing the base rate', actual: s.brier, baseline: s.brierClimatology,
        threshold: 'lower by at least 0.03', pass: s.brier < s.brierClimatology - 0.03, note: 'lower is better' },
      { id: 'brier_above_oracle', label: 'Brier score stays above the best possible score', actual: s.brier, baseline: s.brierOracle,
        threshold: 'model >= generator oracle', pass: s.brier >= s.brierOracle, note: 'cannot beat the hidden pattern itself' },
      { id: 'ece_within_bound', label: 'Calibration error stays under 6 percentage points', actual: rel.ece, baseline: 0.06,
        threshold: 'ECE < 0.06', pass: rel.ece < 0.06, note: 'expected calibration error, 5 equal-width bins' },
      { id: 'mean_prediction_close', label: 'Mean prediction tracks the observed rate', actual: rel.meanP, baseline: rel.observed,
        threshold: 'absolute gap < 0.05', pass: Math.abs(rel.meanP - rel.observed) < 0.05, note: 'synthetic cohort only' },
      { id: 'skill_positive', label: 'Brier skill score is positive', actual: s.skill, baseline: 0,
        threshold: 'skill > 0', pass: s.skill > 0, note: '1 minus Brier over climatology' }
    ];
    var regression = [
      { id: 'regression_accuracy', metric: 'accuracy', actual: s.accuracy, baseline: BASELINE.model.accuracy, tolerance: BASELINE.tolerance.accuracy, pass: s.accuracy >= BASELINE.model.accuracy - BASELINE.tolerance.accuracy },
      { id: 'regression_brier', metric: 'brier', actual: s.brier, baseline: BASELINE.model.brier, tolerance: BASELINE.tolerance.brier, pass: s.brier <= BASELINE.model.brier + BASELINE.tolerance.brier },
      { id: 'regression_climatology', metric: 'climatologyBrier', actual: s.brierClimatology, baseline: BASELINE.model.climatologyBrier, tolerance: BASELINE.tolerance.climatologyBrier, pass: approx(s.brierClimatology, BASELINE.model.climatologyBrier, BASELINE.tolerance.climatologyBrier) },
      { id: 'regression_oracle', metric: 'oracleBrier', actual: s.brierOracle, baseline: BASELINE.model.oracleBrier, tolerance: BASELINE.tolerance.oracleBrier, pass: approx(s.brierOracle, BASELINE.model.oracleBrier, BASELINE.tolerance.oracleBrier) },
      { id: 'regression_ece', metric: 'ece', actual: rel.ece, baseline: BASELINE.model.ece, tolerance: BASELINE.tolerance.ece, pass: rel.ece <= BASELINE.model.ece + BASELINE.tolerance.ece }
    ];
    return {
      n: n, people: r.people, testDays: r.testDays, reliabilityAt: r.reliabilityAt,
      summary: s, reliability: rel, sensitivity: r.sensitivity, uncertainty: { accuracy: se.accuracy, baselineAccuracy: se.baselineAccuracy, brier: se.brier, margin: margin },
      checks: checks, regression: regression
    };
  }

  /** Full report. Deterministic: the same code always produces the same numbers. */
  function run() {
    var vectors = goldenVectors(), model = modelSuite();
    var groups = {}, i;
    for (i = 0; i < vectors.length; i++) {
      var g = vectors[i].group;
      if (!groups[g]) groups[g] = { name: g, total: 0, passed: 0, failed: [] };
      groups[g].total++;
      if (vectors[i].pass) groups[g].passed++; else groups[g].failed.push(vectors[i].id);
    }
    var groupList = Object.keys(groups).map(function (k) { return groups[k]; });
    var modelChecks = model.checks.concat(model.regression);
    var modelGroup = { name: 'SYNTHETIC model validation', total: modelChecks.length, passed: modelChecks.filter(function (c) { return c.pass; }).length,
      failed: modelChecks.filter(function (c) { return !c.pass; }).map(function (c) { return c.id; }) };
    groupList.push(modelGroup);
    var total = vectors.length + modelChecks.length;
    var passed = vectors.filter(function (v) { return v.pass; }).length + modelGroup.passed;
    return {
      id: ID, deterministic: true, synthetic: true, label: 'BreatheEasy benchmark and validation suite',
      baseline: BASELINE.label, groups: groupList, vectors: vectors, model: model,
      total: total, passed: passed, failed: total - passed,
      passRate: total ? passed / total : 0,
      failures: groupList.reduce(function (a, g) { return a.concat(g.failed.map(function (f) { return g.name + ': ' + f; })); }, [])
    };
  }

  /** Compact, shareable text for the copy and download buttons. */
  function reportText(r) {
    var s = r.model.summary, rel = r.model.reliability, u = r.model.uncertainty;
    var L = [];
    L.push('BreatheEasy benchmark and validation suite');
    L.push('Baseline: ' + r.baseline);
    L.push('Result: ' + r.passed + '/' + r.total + ' checks passed, ' + r.failed + ' failed');
    L.push('');
    r.groups.forEach(function (g) { L.push(g.name + ': ' + g.passed + '/' + g.total + (g.failed.length ? ' (failed: ' + g.failed.join(', ') + ')' : '')); });
    L.push('');
    L.push('SYNTHETIC held-out model, ' + s.n + ' days after training, ' + r.model.people + ' made-up people:');
    L.push('  Accuracy ' + (s.accuracy * 100).toFixed(1) + '% vs common-answer baseline ' + (s.baselineAccuracy * 100).toFixed(1) + '%');
    L.push('  Brier ' + s.brier.toFixed(3) + ' vs climatology ' + s.brierClimatology.toFixed(3) + ' vs oracle ' + s.brierOracle.toFixed(3));
    L.push('  Calibration ECE ' + (rel.ece * 100).toFixed(1) + ' points; mean said ' + (rel.meanP * 100).toFixed(1) + '% vs observed ' + (rel.observed * 100).toFixed(1) + '%');
    L.push('  Uncertainty: 95 percent band on accuracy +/-' + (u.accuracy * 100).toFixed(1) + ' points; combined win margin ' + (u.margin * 100).toFixed(1) + ' points');
    L.push('');
    L.push('Failure conditions: any golden vector mismatch, ECE >= 6 points, Brier not beating climatology by 0.03,');
    L.push('accuracy not clearing the combined uncertainty band, or a model score drifting past its pinned tolerance.');
    L.push('Scope: SYNTHETIC data and published EPA thresholds. Not a clinical validation.');
    return L.join('\n');
  }

  var api = { ID: ID, BASELINE: BASELINE, goldenVectors: goldenVectors, modelSuite: modelSuite, band: band, run: run, reportText: reportText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Benchmark = api;
})(typeof window !== 'undefined' ? window : this);
