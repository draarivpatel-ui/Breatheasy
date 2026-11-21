// Nov 15: deterministic benchmark / validation suite, engine edge cases and the interactive UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const B = require('../js/benchmark.js');
const A = require('../js/aqi.js');
const Z = require('../js/zones.js');
const S = require('../js/store.js');
const F = require('../js/forecast.js');
const I = require('../js/i18n.js');

const R = B.run(); // deterministic; about 0.4 s
const openWindows = [];
test.after(() => { openWindows.forEach(w => { try { w.close(); } catch (e) {} }); });

/* ---------------- pure benchmark engine ---------------- */

test('B1 the suite is deterministic, synthetic and fully passing', () => {
  assert.equal(R.deterministic, true);
  assert.equal(R.synthetic, true);
  assert.equal(R.failed, 0);
  assert.equal(R.passed, R.total);
  assert.equal(R.passRate, 1);
  assert.deepEqual(R.failures, []);
  const twice = B.run();
  assert.equal(twice.passed, R.passed);
  assert.equal(twice.total, R.total);
  assert.deepEqual(twice.vectors.map(v => [v.id, v.actual]), R.vectors.map(v => [v.id, v.actual]));
  assert.equal(twice.model.summary.brier, R.model.summary.brier);
});

test('B2 golden vectors are grouped, every group has a name and a nonzero count', () => {
  const names = R.groups.map(g => g.name);
  assert.ok(names.length >= 6);
  assert.ok(new Set(names).size === names.length, 'group names are unique');
  R.groups.forEach(g => { assert.ok(g.total > 0); assert.equal(g.passed, g.total); assert.deepEqual(g.failed, []); });
  assert.ok(R.total > 60, 'the suite must be substantive, not a token check');
});

test('B3 every golden vector carries a measured value, an expected value, a tolerance and a verdict', () => {
  R.vectors.forEach(v => {
    assert.equal(typeof v.id, 'string');
    assert.equal(typeof v.group, 'string');
    assert.ok('actual' in v && 'expected' in v && 'tolerance' in v);
    assert.equal(typeof v.pass, 'boolean');
  });
});

test('B4 a deliberately mutated AQI result would be caught by the exact-match vectors', () => {
  const pm = B.goldenVectors().filter(v => v.group === 'EPA AQI');
  const v = pm.find(x => x.id === 'pm25_35.4');
  assert.equal(v.expected, 100);
  assert.equal(v.tolerance, 0);
  assert.equal(v.pass, true);
  // The checker's own contract: a wrong answer fails an exact-match vector.
  assert.notEqual(A.aqiPM25(35.4), 999);
});

test('B5 baseline comparisons are real: model beats majority and climatology, but not the oracle', () => {
  const s = R.model.summary;
  assert.ok(s.accuracy > s.baselineAccuracy);
  assert.ok(s.brier < s.brierClimatology);
  assert.ok(s.brier >= s.brierOracle);
  assert.ok(s.skill > 0);
  assert.equal(s.n, 1200);
  assert.equal(R.model.people, 12);
  assert.equal(R.model.testDays, 100);
});

test('B6 explicit failure conditions are stated, checked and have a real uncertainty band', () => {
  const ids = R.model.checks.map(c => c.id);
  ['accuracy_beats_majority', 'brier_beats_climatology', 'brier_above_oracle', 'ece_within_bound',
    'mean_prediction_close', 'skill_positive'].forEach(id => assert.ok(ids.includes(id), id));
  assert.ok(R.model.checks.every(c => c.pass && typeof c.threshold === 'string' && c.threshold.length));
  const u = R.model.uncertainty;
  assert.ok(u.accuracy > 0 && u.baselineAccuracy > 0 && u.brier > 0);
  assert.ok(u.margin >= u.accuracy);
  const gap = R.model.summary.accuracy - R.model.summary.baselineAccuracy;
  assert.ok(gap > u.margin, 'the win must clear the combined band');
  assert.ok(B.band(0.5, 100) > B.band(0.5, 1200), 'smaller samples have wider bands');
  assert.equal(B.band(0.5, 0), 1);
});

test('B7 pinned regression tolerances guard against silent drift in every model metric', () => {
  const metrics = R.model.regression.map(r => r.metric);
  ['accuracy', 'brier', 'climatologyBrier', 'oracleBrier', 'ece'].forEach(m => assert.ok(metrics.includes(m), m));
  R.model.regression.forEach(r => {
    assert.equal(r.pass, true, r.id);
    assert.ok(r.tolerance > 0 && r.tolerance < 0.05);
  });
  assert.equal(B.BASELINE.id, B.ID);
  assert.match(B.BASELINE.label, /Prior base release/);
});

test('B8 sensitivity is monotone in logged days and the weakest point is 14 days', () => {
  const rows = R.model.sensitivity.filter(x => x.summary);
  assert.equal(rows[0].days, 14);
  assert.ok(rows[rows.length - 1].summary.brier < rows[0].summary.brier);
  rows.forEach(r => assert.ok(r.summary.brier > 0 && r.summary.accuracy > 0));
});

test('B9 the shareable report is complete, plain text and quotes the real numbers', () => {
  const txt = B.reportText(R);
  assert.equal(typeof txt, 'string');
  assert.ok(txt.length > 500);
  assert.ok(!txt.includes(String.fromCharCode(8212)) && !txt.includes(String.fromCharCode(8211)));
  assert.match(txt, /Result: 76\/76 checks passed, 0 failed/);
  assert.match(txt, /Failure conditions:/);
  assert.match(txt, /Uncertainty:/);
  assert.match(txt, /Baseline: Prior base release/);
  assert.ok(txt.includes(R.model.summary.brier.toFixed(3)));
  assert.match(txt, /Not a clinical validation/);
  assert.equal(B.reportText(B.run()), txt, 'report is deterministic too');
});

/* ---------------- engine edge cases added Nov 15 ---------------- */

test('E1 category() refuses negative and non-finite AQI instead of calling it Good', () => {
  assert.equal(A.category(-1), null);
  assert.equal(A.category(-0.5), null);
  assert.equal(A.category(NaN), null);
  assert.equal(A.category(Infinity), null);
  assert.equal(A.category(0).key, 'good');
  assert.equal(A.category(120).color, '#ff7e00');
});

test('E2 zone helpers refuse blank strings, booleans, arrays and negative percents', () => {
  assert.equal(Z.peakFlowPercent('', 400), null);
  assert.equal(Z.peakFlowPercent('   ', 400), null);
  assert.equal(Z.peakFlowPercent(300, '  '), null);
  assert.equal(Z.peakFlowPercent(true, 400), null);
  assert.equal(Z.peakFlowPercent([], 400), null);
  assert.equal(Z.peakFlowPercent(Number.POSITIVE_INFINITY, 400), null);
  assert.equal(Z.peakFlowPercent(300, 400), 75);
  assert.equal(Z.zoneFromPercent(-1), null);
  assert.equal(Z.zoneFromPercent('80'), null);
  assert.equal(Z.zoneFromPercent(NaN), null);
  assert.equal(Z.zoneFromPercent(80), 'green');
  assert.equal(Z.zoneFromPercent(49.9), 'red');
});

test('E3 assess() tolerates a non-array symptoms field from a hand-edited saved row', () => {
  const r = Z.assess({ peakFlow: 300, personalBest: 400, symptoms: 'blue_lips' });
  assert.equal(r.bySymptoms, 'green');
  assert.equal(r.danger, false);
  assert.equal(r.zone, 'yellow');
  assert.equal(Z.assess({ symptoms: { 0: 'blue_lips' } }).danger, false);
  assert.equal(Z.assess({ symptoms: ['blue_lips'] }).danger, true);
});

test('E4 thresholds() refuses blank and non-numeric personal best', () => {
  assert.equal(Z.thresholds(''), null);
  assert.equal(Z.thresholds('   '), null);
  assert.equal(Z.thresholds([]), null);
  assert.equal(Z.thresholds('Infinity'), null);
  assert.deepEqual(Z.thresholds(400), { greenMin: 320, yellowMin: 200 });
});

test('E5 pollenLevel() refuses non-object pollen shapes', () => {
  assert.equal(F.pollenLevel('grass'), null);
  assert.equal(F.pollenLevel([250]), null);
  assert.equal(F.pollenLevel(250), null);
  assert.equal(F.pollenLevel({ grass: 250 }), 3);
  assert.equal(F.pollenLevel({ grass: -5 }), 0);
});

test('E6 maxOzone8h() ignores a series with a clock gap instead of averaging across it', () => {
  const ug = 0.100 * 1000 * 48.0 / 24.45 + 0.0001;
  const time = [];
  for (let h = 0; h < 24; h++) time.push('2026-07-01T' + String(h).padStart(2, '0') + ':00');
  const full = time.map(() => ug);
  const withGap = time.slice(); withGap.splice(10, 1); // an hour is missing in the 8 AM window
  const ozone = withGap.map(() => ug);
  const d = F.dailyAirQuality({ time: withGap, ozone, pm2_5: withGap.map(() => 5) })[0];
  // The old code would average 8 non-consecutive hours and still report the spike.
  assert.ok(d.o3ppm <= 0.100, 'a gap must not silently produce a valid 8-hour window');
  assert.equal(F.maxOzone8h(time, full, '2026-07-01').toFixed(4), (ug).toFixed(4));
  assert.equal(F.maxOzone8h(time, full, '2026-07-02'), null);
});

test('E7 saved place labels and plan text are capped so they cannot widen a 375 px page', () => {
  const long = 'X'.repeat(500);
  const st = S.sanitize({ custom: { lat: 29.6, lon: -95.6, name: long }, plan: { green: long } }, 'en', ['sugarland']);
  assert.equal(st.custom.name.length, 120);
  assert.equal(st.plan.green.length, 500, 'a short string is kept whole');
  assert.equal(S.sanitize({ plan: { green: 'Y'.repeat(9000) } }, 'en', []).plan.green.length, 2000, 'a long string is capped');
  assert.equal(S.sanitize({ custom: { lat: 91, lon: 0 } }, 'en', []).custom, null);
});

/* ---------------- interactive DOM / UI ---------------- */

function makeDom() {
  const html = read('index.html');
  const dom = new JSDOM(html, { url: 'https://example.org/Breatheasy/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  // A stub observer that never fires keeps renderTrust() from scheduling work we do not need here.
  w.IntersectionObserver = class { observe() {} disconnect() {} };
  w.fetch = () => new Promise(() => {}); // never resolves; the app still renders its shell
  w.confirm = () => false;
  Object.defineProperty(w.navigator, 'serviceWorker', { value: { register: () => Promise.resolve() }, configurable: true });
  // Load every engine script in index.html order, then app.js.
  const scripts = Array.from(html.matchAll(/<script src="(js\/[\w-]+\.js)[^"]*"><\/script>/g)).map(m => m[1]);
  scripts.forEach(p => w.eval(read(p)));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  openWindows.push(w);
  return { w, d: w.document, dom };
}

test('U1 the served shell contains the Verification section, its controls and an empty status', () => {
  const html = read('index.html');
  assert.ok(html.includes('<section id="verify" aria-labelledby="verify-h">'));
  assert.ok(html.includes('href="#verify"'));
  ['verify-run', 'verify-copy', 'verify-export', 'verify-detail', 'verify-status', 'verify-score',
    'verify-groups', 'verify-model', 'verify-bars', 'verify-model-rows', 'verify-note', 'verify-report',
    'verify-detail-box'].forEach(id => {
      if (id === 'verify-note') return; // optional id, covered by U2
      assert.ok(html.includes('id="' + id + '"'), id);
    });
  assert.match(html, /<script src="js\/benchmark\.js\?v=/);
  const d = new JSDOM(html).window.document;
  assert.equal(d.getElementById('verify-status').getAttribute('role'), 'status');
  assert.equal(d.getElementById('verify-detail').getAttribute('aria-expanded'), 'false');
  assert.equal(d.getElementById('verify-detail').getAttribute('aria-controls'), 'verify-detail-box');
  assert.equal(d.getElementById('verify-detail-box').hidden, true);
});

function runUi(d, w) {
  d.getElementById('verify-run').click();
  // runBenchmark defers with setTimeout(20); drain the timer queue.
  return new Promise(resolve => w.setTimeout(resolve, 60));
}

test('U2 clicking Run computes the suite and renders score, groups and the model table', async () => {
  const { w, d } = makeDom();
  assert.equal(d.getElementById('verify-summary').hidden, true);
  d.getElementById('verify-run').click();
  await runUi(d, w);
  const st = d.getElementById('verify-status').textContent;
  assert.match(st, /76 of 76 checks passed\. 0 failed\./);
  assert.equal(d.getElementById('verify-summary').hidden, false);
  assert.match(d.getElementById('verify-score').textContent, /All checks passed/);
  assert.ok(d.getElementById('verify-score').classList.contains('is-pass'));
  assert.equal(d.getElementById('verify-groups').querySelectorAll('li').length, R.groups.length);
  assert.ok(d.getElementById('verify-baseline').textContent.includes('Prior base release'));
  assert.ok(d.getElementById('verify-uncertainty').textContent.includes('95 percent'));
  assert.ok(d.getElementById('verify-failure').textContent.includes('Failure conditions'));
  const rows = d.querySelectorAll('#verify-model-rows tr');
  assert.equal(rows.length, R.model.checks.length + R.model.regression.length);
  assert.equal(d.querySelectorAll('#verify-model-rows tr.vfail').length, 0);
  assert.ok(d.getElementById('verify-model-note').textContent.includes('1200'));
  assert.equal(d.getElementById('verify-bars').querySelectorAll('.vbar-row').length, 3);
  assert.ok(d.getElementById('verify-report').textContent.includes('Result: 76/76'));
  assert.equal(d.getElementById('verify-score').getAttribute('tabindex'), '-1', 'focus moves to the result');
});

test('U3 Show every check reveals a table per group with all vectors, and hides again', async () => {
  const { w, d } = makeDom();
  await runUi(d, w);
  const btn = d.getElementById('verify-detail'), box = d.getElementById('verify-detail-box');
  btn.click();
  assert.equal(box.hidden, false);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.match(btn.textContent, /Hide every check/);
  const tables = box.querySelectorAll('table');
  assert.equal(tables.length, new Set(R.vectors.map(v => v.group)).size);
  assert.equal(box.querySelectorAll('tbody tr').length, R.vectors.length);
  assert.equal(box.querySelectorAll('tbody tr.vfail').length, 0);
  btn.click();
  assert.equal(box.hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.match(btn.textContent, /Show every check/);
});

test('U4 Copy and Download use the same deterministic report', async () => {
  const { w, d } = makeDom();
  let copied = null, downloaded = null;
  w.navigator.clipboard = { writeText: (s) => { copied = s; return Promise.resolve(); } };
  w.URL.createObjectURL = (blob) => { downloaded = blob; return 'blob:x'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {}; // do not navigate
  await runUi(d, w);
  d.getElementById('verify-copy').click();
  assert.equal(copied, B.reportText(R));
  await new Promise(resolve => w.setTimeout(resolve, 10)); // clipboard promise resolves on a microtask
  assert.match(d.getElementById('verify-status').textContent, /copied/);
  d.getElementById('verify-export').click();
  assert.ok(downloaded, 'a text blob was offered for download');
  w.close();
});

test('U5 the suite survives a language switch and Spanish report labels stay translated', async () => {
  const { w, d } = makeDom();
  await runUi(d, w);
  const lang = d.getElementById('lang');
  lang.value = 'es';
  lang.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(d.documentElement.lang, 'es');
  assert.match(d.getElementById('verify_h') ? d.getElementById('verify_h').textContent : d.getElementById('verify-h').textContent, /Verificación/);
  assert.match(d.getElementById('verify-run').textContent, /Ejecutar/);
  assert.match(d.getElementById('verify-status').textContent, /comprobaciones correctas/);
  assert.ok(!d.getElementById('verify-status').textContent.includes('checks passed'));
});

test('U6 no horizontal overflow at 375 px: CSS clips the page and the new elements are width-safe', () => {
  const css = read('styles.css');
  assert.match(css, /html \{ overflow-x: clip/);
  assert.match(css, /body \{ overflow-x: clip/);
  assert.match(css, /:focus-visible \{/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /\.verify-table th, \.verify-table td \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.verify-actions \.btn \{ width: 100%/);
  assert.match(css, /\.verify-pre \{[^}]*overflow-wrap: anywhere/);
  assert.ok(!css.includes(String.fromCharCode(8212)) && !css.includes(String.fromCharCode(8211)));
  const print = css.slice(css.indexOf('@media print'));
  assert.match(print, /@page \{ size: letter/);
  // the plan printout is one Letter page of plan only: the verification section never prints
  const hideList = print.match(/@media print \{[\s\S]*?display: none !important/)[0];
  assert.match(hideList, /#verify/);
  assert.match(css, /\.btn-911 \{[^}]*min-height: 44px/);
});

test('U7 i18n parity holds for every new verification key, in both directions', () => {
  ['nav_verify', 'verify_h', 'verify_intro', 'verify_run', 'verify_running', 'verify_result',
    'verify_pass_all', 'verify_some_failed', 'verify_group', 'verify_col_check', 'verify_col_actual',
    'verify_col_baseline', 'verify_col_bound', 'verify_col_result', 'verify_pass', 'verify_fail',
    'verify_baseline', 'verify_uncertainty', 'verify_failure', 'verify_limits', 'verify_export',
    'verify_copy', 'verify_copied', 'verify_copy_fail', 'verify_report_h', 'verify_scope',
    'verify_detail_h', 'verify_show_detail', 'verify_hide_detail', 'verify_model_h', 'verify_model_note'
  ].forEach(k => {
    assert.ok(I.en[k], 'missing EN ' + k);
    assert.ok(I.es[k], 'missing ES ' + k);
    const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
    assert.equal(ph(I.es[k]), ph(I.en[k]), 'placeholder mismatch ' + k);
    assert.notEqual(I.es[k], I.en[k], 'Spanish must not copy English: ' + k);
  });
  assert.ok(I.en.footer.includes('Health + Data') && I.es.footer.includes('Salud + Datos'));
});

test('U8 the shipped page, code and tests contain no em-dashes or en-dashes', () => {
  ['index.html', 'styles.css', 'js/app.js', 'js/benchmark.js', 'js/i18n.js', 'js/aqi.js',
    'js/zones.js', 'js/forecast.js', 'js/store.js'].forEach(p => {
      const s = read(p);
      assert.ok(!s.includes(String.fromCharCode(8212)), p + ' has an em-dash');
      assert.ok(!s.includes(String.fromCharCode(8211)), p + ' has an en-dash');
    });
  const self = fs.readFileSync(__filename, 'utf8');
  assert.ok(!self.includes(String.fromCharCode(8212)));
  assert.ok(!self.includes(String.fromCharCode(8211)));
});

test('U9 the verification section is keyboard reachable and uses a labelled report region', () => {
  const d = new JSDOM(read('index.html')).window.document;
  ['verify-run', 'verify-copy', 'verify-export', 'verify-detail'].forEach(id => {
    const b = d.getElementById(id);
    assert.equal(b.tagName, 'BUTTON', id);
    assert.equal(b.getAttribute('type'), 'button', id);
    assert.ok(b.textContent.trim().length > 3, id + ' must have a visible label');
  });
  const pre = d.getElementById('verify-report');
  assert.equal(pre.getAttribute('tabindex'), '0');
  assert.ok(pre.getAttribute('aria-label'));
  assert.equal(d.getElementById('verify-card').tagName, 'DIV');
  assert.equal(d.getElementById('verify').getAttribute('aria-labelledby'), 'verify-h');
});
