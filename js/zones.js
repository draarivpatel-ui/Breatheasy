/* BreatheEasy: asthma action-plan zone logic (pure functions, no DOM).
 * Zone definitions follow the NHLBI Asthma Action Plan (Dec 2020, aligned with the
 * 2020 Focused Updates to the Asthma Management Guidelines):
 * https://www.nhlbi.nih.gov/sites/default/files/publications/Asthma-Action-Plan-2020_rev_508.pdf
 *   Green:  no symptoms; peak flow 80 percent or more of personal best
 *   Yellow: cough, wheeze, chest tightness, shortness of breath, night waking, or can do some
 *           but not all usual activities; peak flow 50 to 79 percent of personal best
 *   Red:    very short of breath, quick-relief medicine has not helped, cannot do usual
 *           activities, or symptoms same/worse after 24 h in yellow; peak flow < 50 percent
 *   Danger signs: trouble walking and talking due to shortness of breath; lips or fingernails blue
 *   (shown to the user in the CDC Asthma Action Plan's newer wording, 2024: trouble walking OR talking, lips or
 *   fingernails blue, pale, or gray -> go to the hospital or call 911 now:
 *   https://www.cdc.gov/asthma/action-plan/documents/asthma-action-plan-508.pdf)
 * This module only sorts inputs into the zones the plan defines. Treatment comes from the
 * user's own doctor-written plan, never from this code.
 */
(function (root) {
  'use strict';

  var YELLOW_SYMPTOMS = ['cough', 'wheeze', 'chest_tight', 'short_breath', 'night_wake', 'some_activities'];
  var RED_SYMPTOMS = ['very_short_breath', 'meds_not_helping', 'no_usual_activities', 'yellow_24h'];
  var DANGER_SIGNS = ['trouble_walk_talk', 'blue_lips'];
  var RANK = { green: 0, yellow: 1, red: 2 };

  /** Percent of personal best, rounded down to a whole percent (null if inputs invalid). */
  function peakFlowPercent(peakFlow, personalBest) {
    var pf = Number(peakFlow), best = Number(personalBest);
    if (!isFinite(pf) || !isFinite(best) || pf <= 0 || best <= 0) return null;
    return Math.floor((pf / best) * 100 + 1e-9);
  }

  function zoneFromPercent(pct) {
    if (pct == null) return null;
    if (pct >= 80) return 'green';
    if (pct >= 50) return 'yellow';
    return 'red';
  }

  function zoneFromSymptoms(symptoms) {
    var s = symptoms || [];
    var has = function (list) { return s.some(function (x) { return list.indexOf(x) !== -1; }); };
    if (has(DANGER_SIGNS) || has(RED_SYMPTOMS)) return 'red';
    if (has(YELLOW_SYMPTOMS)) return 'yellow';
    return 'green';
  }

  function worse(a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return RANK[a] >= RANK[b] ? a : b;
  }

  /**
   * Combine peak flow (optional) and symptoms. The worse of the two wins, as on the plan
   * ("symptoms ... -Or- peak flow ...").
   * Returns { zone, percent, byPeakFlow, bySymptoms, danger }
   */
  function assess(input) {
    input = input || {};
    var pct = peakFlowPercent(input.peakFlow, input.personalBest);
    var byPF = zoneFromPercent(pct);
    var bySym = zoneFromSymptoms(input.symptoms);
    var danger = (input.symptoms || []).some(function (x) { return DANGER_SIGNS.indexOf(x) !== -1; });
    return { zone: worse(byPF, bySym), percent: pct, byPeakFlow: byPF, bySymptoms: bySym, danger: danger };
  }

  /** Peak-flow numbers that mark the zone boundaries for a given personal best. */
  function thresholds(personalBest) {
    var best = Number(personalBest);
    if (!isFinite(best) || best <= 0) return null;
    return { greenMin: Math.ceil(best * 0.8), yellowMin: Math.ceil(best * 0.5) };
  }

  var api = {
    YELLOW_SYMPTOMS: YELLOW_SYMPTOMS,
    RED_SYMPTOMS: RED_SYMPTOMS,
    DANGER_SIGNS: DANGER_SIGNS,
    peakFlowPercent: peakFlowPercent,
    zoneFromPercent: zoneFromPercent,
    zoneFromSymptoms: zoneFromSymptoms,
    worse: worse,
    assess: assess,
    thresholds: thresholds
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Zones = api;
})(this);
