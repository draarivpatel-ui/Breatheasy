// 911 / danger-sign wording follows the CDC Asthma Action Plan (2024), EN and ES, and screen-reader labels and the
// page title follow the language switch.
// EN: https://www.cdc.gov/asthma/action-plan/documents/asthma-action-plan-508.pdf
// ES: https://www.cdc.gov/asthma/media/pdfs/2024/07/asthma-action-plan-es-508.pdf
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const I = require('../js/i18n.js');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

test('danger signs use the CDC 2024 wording (walking OR talking; blue, pale, or gray)', () => {
  for (const k of ['safety_911', 's_blue_lips']) assert.match(I.en[k], /blue, pale, or gray/, k);
  for (const k of ['safety_911', 's_blue_lips']) assert.match(I.es[k], /azules, p\u00e1lidos o grises/, k);
  assert.match(I.en.s_trouble_walk_talk, /walking or talking/);
  assert.match(I.es.s_trouble_walk_talk, /caminar o hablar/);
  assert.match(html, /blue, pale, or gray\? Call 911 now\./, 'static banner matches the string table');
  assert.ok(html.includes('cdc.gov/asthma/action-plan/documents/asthma-action-plan-508.pdf'), 'CDC plan cited in Sources');
});

test('EPA USG line names the symptoms in both languages', () => {
  assert.match(I.en.g_usg, /coughing or shortness of breath/);
  assert.match(I.es.g_usg, /tos o dificultad para respirar/);
});

test('aria-labels and the page title are translated', () => {
  for (const k of ['nav_label', 'strip_label', 'doc_title']) {
    assert.ok(I.en[k] && I.es[k] && I.en[k] !== I.es[k], k);
  }
  assert.match(html, /data-i18n-aria="nav_label"/);
  assert.match(html, /data-i18n-aria="strip_label"/);
  assert.match(app, /data-i18n-aria/);
  assert.match(app, /document\.title = t\('doc_title'\)/);
});
