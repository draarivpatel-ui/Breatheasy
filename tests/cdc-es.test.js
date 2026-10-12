// Spanish CDC wording: the plan_intro must name the CDC's Spanish asthma action plan and the NHLBI's English-only one, and EN must point at the same two plans.
const test = require('node:test'); const assert = require('node:assert');
const api = require('../js/i18n.js');
const dict = { en: api.en, es: api.es };
test('plan_intro EN/ES cite the same two plans and ES says which is in Spanish', () => {
  assert.ok(dict && dict.es && dict.en, 'dictionary exposed');
  const en = dict.en.plan_intro, es = dict.es.plan_intro;
  assert.match(en, /NHLBI/); assert.match(es, /NHLBI/); assert.match(es, /CDC/); assert.match(es, /cdc\.gov\/asthma/); // ES adds the CDC Spanish plan on purpose
  assert.match(es, /en ingl\u00e9s/); assert.match(es, /est\u00e1 en espa\u00f1ol/);
  assert.match(es, /gratuito/);
});
