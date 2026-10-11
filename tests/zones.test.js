// Zone logic per the NHLBI Asthma Action Plan (2020): green >=80%, yellow 50-79%, red <50%.
const test = require('node:test'); const assert = require('node:assert/strict');
const Z = require('../js/zones.js');

test('peak-flow percent of personal best', () => {
  assert.equal(Z.peakFlowPercent(400, 400), 100);
  assert.equal(Z.peakFlowPercent(319, 400), 79);
  assert.equal(Z.peakFlowPercent(320, 400), 80);
  assert.equal(Z.peakFlowPercent(null, 400), null);
  assert.equal(Z.peakFlowPercent(300, 0), null);
  assert.equal(Z.peakFlowPercent('abc', 400), null);
});
test('zone boundaries from percent', () => {
  assert.equal(Z.zoneFromPercent(100), 'green');
  assert.equal(Z.zoneFromPercent(80), 'green');
  assert.equal(Z.zoneFromPercent(79), 'yellow');
  assert.equal(Z.zoneFromPercent(50), 'yellow');
  assert.equal(Z.zoneFromPercent(49), 'red');
  assert.equal(Z.zoneFromPercent(null), null);
});
test('boundary values at the peak-flow edges for a best of 400', () => {
  assert.equal(Z.assess({ peakFlow: 320, personalBest: 400 }).zone, 'green');
  assert.equal(Z.assess({ peakFlow: 319, personalBest: 400 }).zone, 'yellow');
  assert.equal(Z.assess({ peakFlow: 200, personalBest: 400 }).zone, 'yellow');
  assert.equal(Z.assess({ peakFlow: 199, personalBest: 400 }).zone, 'red');
});
test('symptoms alone set the zone', () => {
  assert.equal(Z.zoneFromSymptoms([]), 'green');
  assert.equal(Z.zoneFromSymptoms(['cough']), 'yellow');
  assert.equal(Z.zoneFromSymptoms(['night_wake']), 'yellow');
  assert.equal(Z.zoneFromSymptoms(['meds_not_helping']), 'red');
  assert.equal(Z.zoneFromSymptoms(['yellow_24h']), 'red');
  assert.equal(Z.zoneFromSymptoms(['blue_lips']), 'red');
});
test('the worse of peak flow and symptoms wins', () => {
  assert.equal(Z.assess({ peakFlow: 380, personalBest: 400, symptoms: ['wheeze'] }).zone, 'yellow');
  assert.equal(Z.assess({ peakFlow: 150, personalBest: 400, symptoms: [] }).zone, 'red');
  assert.equal(Z.assess({ peakFlow: 300, personalBest: 400, symptoms: ['very_short_breath'] }).zone, 'red');
  assert.equal(Z.assess({ symptoms: [] }).zone, 'green', 'no peak flow, no symptoms');
});
test('danger signs are flagged', () => {
  const a = Z.assess({ peakFlow: 390, personalBest: 400, symptoms: ['trouble_walk_talk'] });
  assert.equal(a.zone, 'red'); assert.equal(a.danger, true);
  assert.equal(Z.assess({ symptoms: ['cough'] }).danger, false);
});
test('thresholds shown on the plan form', () => {
  assert.deepEqual(Z.thresholds(400), { greenMin: 320, yellowMin: 200 });
  assert.deepEqual(Z.thresholds(333), { greenMin: 267, yellowMin: 167 });
  assert.equal(Z.zoneFromPercent(Z.peakFlowPercent(267, 333)), 'green');
  assert.equal(Z.zoneFromPercent(Z.peakFlowPercent(266, 333)), 'yellow');
  assert.equal(Z.thresholds(0), null);
});
