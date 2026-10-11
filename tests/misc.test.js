// Guidance selection, i18n completeness, calendar export.
const test = require('node:test'); const assert = require('node:assert/strict');
const G = require('../js/guidance.js'); const I = require('../js/i18n.js'); const ICS = require('../js/ics.js');

const keys = g => g.items.map(i => i.key);
test('good day: one line, no plan prompts', () => {
  assert.deepEqual(keys(G.build({ aqi: 30, dominant: 'ozone' }, {})), ['g_good']);
});
test('ozone USG day pulls EPA asthma line, morning tip, and the user\'s own pre-exercise text', () => {
  const g = G.build({ aqi: 128, dominant: 'ozone', tempMaxF: 85 }, { beforeExercise: '2 puffs albuterol 15 min before', triggers: ['ozone'] });
  assert.equal(g.category.key, 'usg');
  assert.deepEqual(keys(g), ['g_usg', 'g_follow_plan', 'g_morning', 'g_plan_exercise', 'g_trigger_ozone']);
  assert.equal(g.items[3].params.text, '2 puffs albuterol 15 min before');
});
test('no medication text is invented when the plan is empty', () => {
  const g = G.build({ aqi: 175, dominant: 'ozone' }, {});
  assert.ok(!keys(g).includes('g_plan_exercise'));
  const all = ['en', 'es'].flatMap(l => keys(g).map(k => I.t(l, k)));
  all.forEach(s => assert.ok(!/albuterol|puff|inhal|dose|mg\b/i.test(s), s));
});
test('heat + bad air adds EPA air-conditioning caution; pollen trigger adds NHLBI tip', () => {
  assert.ok(keys(G.build({ aqi: 160, dominant: 'ozone', tempMaxF: 97 }, {})).includes('g_heat_ac'));
  assert.ok(keys(G.build({ aqi: 40, dominant: 'pm25', pollenLevel: 3 }, { triggers: ['pollen'] })).includes('g_trigger_pollen'));
  assert.ok(!keys(G.build({ aqi: 40, dominant: 'pm25', pollenLevel: 3 }, { triggers: [] })).includes('g_trigger_pollen'));
});
test('model risk line only when elevated/high', () => {
  assert.ok(keys(G.build({ aqi: 60, dominant: 'ozone' }, {}, 'high')).includes('g_risk_high'));
  assert.ok(!keys(G.build({ aqi: 60, dominant: 'ozone' }, {}, 'low')).some(k => k.startsWith('g_risk')));
});
test('no data -> explicit no-data line', () => {
  assert.deepEqual(keys(G.build({}, {})), ['g_nodata']);
});
test('every English string has a Spanish translation with the same placeholders', () => {
  Object.keys(I.en).forEach(k => {
    assert.ok(I.es[k] != null, 'missing es: ' + k);
    const ph = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
    assert.equal(ph(I.es[k]), ph(I.en[k]), 'placeholder mismatch: ' + k);
  });
  Object.keys(I.es).forEach(k => assert.ok(I.en[k] != null, 'extra es key: ' + k));
});
test('t() interpolates and falls back', () => {
  assert.equal(I.t('en', 'pct_best', { pct: 72 }), '72% of your personal best');
  assert.equal(I.t('es', 'pct_best', { pct: 72 }), '72% de tu mejor marca');
  assert.equal(I.t('es', 'nope'), 'nope');
});
test('.ics: valid all-day event, escaped, folded, CRLF', () => {
  const s = ICS.allDayEvent('2026-10-11', 'BreatheEasy: AQI 128; ozone, USG', 'Line one\nLine two, with comma; and a long tail ' + 'x'.repeat(120), new Date('2026-10-10T12:00:00Z'));
  assert.ok(s.startsWith('BEGIN:VCALENDAR\r\n')); assert.ok(s.endsWith('END:VCALENDAR\r\n'));
  assert.ok(s.includes('DTSTART;VALUE=DATE:20261011')); assert.ok(s.includes('DTEND;VALUE=DATE:20261012'));
  assert.ok(s.includes('DTSTAMP:20261010T120000Z'));
  assert.ok(s.includes('SUMMARY:BreatheEasy: AQI 128\\; ozone\\, USG'));
  assert.ok(s.includes('Line one\\nLine two\\, with comma\\; and'));
  s.split('\r\n').forEach(l => assert.ok(l.length <= 75, 'line too long: ' + l.length));
});
test('.ics DTEND crosses month boundary', () => {
  assert.ok(ICS.allDayEvent('2026-10-31', 'a', 'b').includes('DTEND;VALUE=DATE:20261101'));
});

const SH = require('../js/share.js');
test('share note: heading, air line, bulleted guidance, footer; skips empty lines', () => {
  const s = SH.note({ heading: 'H', air: 'Air: AQI 140', items: ['a', '', 'b'], footer: ['Not medical advice.', 'Call 911.'] });
  assert.equal(s, 'H\nAir: AQI 140\n\u2022 a\n\u2022 b\n\nNot medical advice.\nCall 911.');
});
test('share note built from guidance invents no medication text', () => {
  const g = G.build({ aqi: 175, dominant: 'ozone', tempMaxF: 98 }, { triggers: ['ozone'] });
  ['en', 'es'].forEach(l => {
    const s = SH.note({ heading: 'x', items: g.items.map(i => I.t(l, i.key, i.params)), footer: [I.t(l, 'share_footer')] });
    assert.ok(!/albuterol|puff|inhal|dose|mg\b/i.test(s), s);
  });
});
