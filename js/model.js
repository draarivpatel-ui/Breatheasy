/* BreatheEasy: on-device personal trigger model (pure functions, no DOM, no network).
 *
 * A small L2-regularised logistic regression, trained in the browser on the user's own
 * daily check-ins. Each check-in is labelled "rough day" when the action-plan zone was
 * yellow or red. Features are the day's conditions (ozone AQI, PM2.5 AQI, pollen level,
 * high temperature, humidity) plus whether the previous day was rough.
 *
 * It is deliberately simple and transparent: every prediction is broken into per-feature
 * contributions (weight x standardised value), so the user can see *why* the outlook says
 * what it says. It is a personal pattern-finder, not a diagnostic device.
 */
(function (root) {
  'use strict';

  var FEATURES = [
    { key: 'aqiO3', label: 'ozone' },
    { key: 'aqiPM25', label: 'pm25' },
    { key: 'pollenLevel', label: 'pollen' },
    { key: 'tempMaxF', label: 'heat' },
    { key: 'humidity', label: 'humidity' },
    { key: 'prevBad', label: 'yesterday' }
  ];
  var MIN_DAYS = 14, MIN_EACH_CLASS = 3;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

  /** Rough day = yellow or red zone. */
  function label(entry) { return entry.zone === 'yellow' || entry.zone === 'red' ? 1 : 0; }

  /** Build raw feature rows from check-ins sorted by date. Missing values stay null. */
  function rows(entries) {
    var sorted = entries.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var byDate = {};
    sorted.forEach(function (e) { byDate[e.date] = e; });
    return sorted.map(function (e) {
      var prev = byDate[prevDate(e.date)];
      var r = {};
      FEATURES.forEach(function (f) {
        r[f.key] = f.key === 'prevBad' ? (prev ? label(prev) : null) : (isNum(e[f.key]) ? e[f.key] : null);
      });
      return { x: r, y: label(e), date: e.date };
    });
  }

  function prevDate(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /** Mean / std per feature over non-null values; nulls are imputed with the mean (z = 0). */
  function scaler(data) {
    var s = {};
    FEATURES.forEach(function (f) {
      var v = data.map(function (d) { return d.x[f.key]; }).filter(isNum);
      var m = v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : 0;
      var sd = v.length > 1 ? Math.sqrt(v.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (v.length - 1)) : 0;
      s[f.key] = { mean: m, std: sd > 1e-9 ? sd : 1, seen: v.length };
    });
    return s;
  }

  function z(x, sc) {
    return FEATURES.map(function (f) {
      var v = x[f.key];
      return isNum(v) ? (v - sc[f.key].mean) / sc[f.key].std : 0;
    });
  }

  /** Full-batch gradient descent. Deterministic: same data -> same weights. */
  function fit(data, opts) {
    opts = opts || {};
    var lambda = opts.lambda != null ? opts.lambda : 0.1;
    var lr = opts.lr || 0.3, iters = opts.iters || 1500;
    var sc = scaler(data);
    var X = data.map(function (d) { return z(d.x, sc); });
    var y = data.map(function (d) { return d.y; });
    var n = X.length, k = FEATURES.length;
    var w = new Array(k).fill(0), b = 0;
    var pos = y.reduce(function (a, c) { return a + c; }, 0);
    if (pos > 0 && pos < n) b = Math.log(pos / (n - pos)); // start at the base rate
    for (var t = 0; t < iters; t++) {
      var gw = new Array(k).fill(0), gb = 0;
      for (var i = 0; i < n; i++) {
        var p = sigmoid(b + dot(w, X[i]));
        var e = p - y[i];
        for (var j = 0; j < k; j++) gw[j] += e * X[i][j];
        gb += e;
      }
      for (var j2 = 0; j2 < k; j2++) w[j2] -= lr * (gw[j2] / n + lambda * w[j2]);
      b -= lr * (gb / n);
    }
    return { w: w, b: b, scaler: sc, n: n, positives: pos };
  }

  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  /** Probability plus an explanation: contributions sorted by absolute size. */
  function predict(model, x) {
    var zx = z(x, model.scaler);
    var contrib = FEATURES.map(function (f, j) {
      return { feature: f.label, key: f.key, value: isNum(x[f.key]) ? x[f.key] : null, contribution: model.w[j] * zx[j] };
    }).sort(function (a, b) { return Math.abs(b.contribution) - Math.abs(a.contribution); });
    return { p: sigmoid(model.b + dot(model.w, zx)), contributions: contrib };
  }

  /** Learned weights, labelled, strongest first. Positive = linked with rougher days. */
  function weights(model) {
    return FEATURES.map(function (f, j) { return { feature: f.label, key: f.key, weight: model.w[j], seen: model.scaler[f.key].seen }; })
      .sort(function (a, b) { return Math.abs(b.weight) - Math.abs(a.weight); });
  }

  /** Honest check: train on the earliest 75 % of days, test on the latest 25 %.
   *  Reports accuracy, the "always guess the most common answer" baseline, and Brier score. */
  function evaluate(data, opts) {
    if (data.length < 12) return null;
    var cut = Math.floor(data.length * 0.75);
    var train = data.slice(0, cut), test = data.slice(cut);
    var tp = train.reduce(function (a, d) { return a + d.y; }, 0);
    if (tp === 0 || tp === train.length) return null;
    var m = fit(train, opts);
    var correct = 0, brier = 0;
    var majority = tp * 2 >= train.length ? 1 : 0, base = 0;
    test.forEach(function (d) {
      var p = predict(m, d.x).p;
      if ((p >= 0.5 ? 1 : 0) === d.y) correct++;
      if (majority === d.y) base++;
      brier += (p - d.y) * (p - d.y);
    });
    return { testDays: test.length, accuracy: correct / test.length, baseline: base / test.length, brier: brier / test.length };
  }

  /** One call for the UI. Returns {status:'insufficient', need:{days,rough,good}} or a trained bundle. */
  function train(entries, opts) {
    var data = rows(entries);
    var pos = data.reduce(function (a, d) { return a + d.y; }, 0);
    var neg = data.length - pos;
    if (data.length < MIN_DAYS || pos < MIN_EACH_CLASS || neg < MIN_EACH_CLASS) {
      return { status: 'insufficient', days: data.length, rough: pos, good: neg,
        need: { days: Math.max(0, MIN_DAYS - data.length), rough: Math.max(0, MIN_EACH_CLASS - pos), good: Math.max(0, MIN_EACH_CLASS - neg) } };
    }
    var model = fit(data, opts);
    return { status: 'ready', model: model, weights: weights(model), evaluation: evaluate(data, opts), days: data.length, rough: pos, good: neg };
  }

  /** Risk band for display. Bands are a BreatheEasy design choice, not clinical thresholds. */
  function band(p) { return p >= 0.6 ? 'high' : p >= 0.35 ? 'elevated' : 'low'; }

  var api = {
    FEATURES: FEATURES, MIN_DAYS: MIN_DAYS, sigmoid: sigmoid, label: label, rows: rows, prevDate: prevDate,
    scaler: scaler, fit: fit, predict: predict, weights: weights, evaluate: evaluate, train: train, band: band
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Model = api;
})(this);
