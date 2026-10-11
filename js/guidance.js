/* BreatheEasy: which cited guidance lines apply to a given day (pure; returns i18n keys).
 * Sources (wording paraphrased in js/i18n.js, never extended):
 *  - EPA Air Quality Guide for Ozone (EPA-452/F-23-001, Feb 2023): https://document.airnow.gov/air-quality-guide-for-ozone.pdf
 *  - EPA AQI Basics: https://www.airnow.gov/aqi/aqi-basics/
 *  - NHLBI Asthma Action Plan (2020), page 2 trigger tips: https://www.nhlbi.nih.gov/sites/default/files/publications/Asthma-Action-Plan-2020_rev_508.pdf
 * Medication text only ever comes from what the user copied from their own doctor's plan.
 */
(function (root) {
  'use strict';
  var AQI = (typeof module !== 'undefined' && module.exports) ? require('./aqi.js') : root.BE_AQI;
  var ORDER = ['good', 'moderate', 'usg', 'unhealthy', 'very', 'hazardous'];

  function atLeast(cat, key) { return cat && ORDER.indexOf(cat.key) >= ORDER.indexOf(key); }

  /**
   * day:  {aqi, dominant, pollenLevel, tempMaxF}
   * plan: {beforeExercise, triggers:[...]} (user's own plan, may be empty)
   * risk: optional model band 'low'|'elevated'|'high'
   * returns {category, items:[{key, params}]}
   */
  function build(day, plan, risk) {
    plan = plan || {}; var triggers = plan.triggers || [];
    var cat = AQI.category(day && day.aqi);
    var items = [];
    if (!cat) return { category: null, items: [{ key: 'g_nodata' }] };
    items.push({ key: 'g_' + cat.key });
    if (atLeast(cat, 'usg')) items.push({ key: 'g_follow_plan' });
    if (day.dominant === 'ozone' && atLeast(cat, 'moderate')) items.push({ key: 'g_morning' });
    if (atLeast(cat, 'usg') && plan.beforeExercise) items.push({ key: 'g_plan_exercise', params: { text: plan.beforeExercise } });
    if (day.dominant === 'ozone' && atLeast(cat, 'moderate') && triggers.indexOf('ozone') !== -1) items.push({ key: 'g_trigger_ozone' });
    if (day.dominant === 'pm25' && atLeast(cat, 'moderate') && triggers.indexOf('smoke') !== -1) items.push({ key: 'g_trigger_pm' });
    if (day.pollenLevel != null && day.pollenLevel >= 2 && triggers.indexOf('pollen') !== -1) items.push({ key: 'g_trigger_pollen' });
    if (atLeast(cat, 'usg') && day.tempMaxF != null && day.tempMaxF >= 90) items.push({ key: 'g_heat_ac' });
    if (risk === 'high' || risk === 'elevated') items.push({ key: 'g_risk_' + risk });
    return { category: cat, items: items };
  }

  var api = { build: build, ORDER: ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Guidance = api;
})(this);
