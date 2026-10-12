// Primary-source audit (team-b r6, Oct 11 2026): EPA "Technical Assistance Document for the Reporting of Daily Air
// Quality - the AQI" (EPA-454/B-24-002, re-issued May 2026), https://document.airnow.gov/technical-assistance-document-for-the-reporting-of-daily-air-quailty.pdf
// Every expected number below is printed in that document.
const test = require('node:test'); const assert = require('node:assert/strict');
const A = require('../js/aqi.js'); const F = require('../js/forecast.js');

test('TAD Table 6 breakpoints (8-h O3 ppm, 24-h PM2.5 ug/m3) are exactly the ones in the code', () => {
  assert.deepEqual(A.O3_8H, [[0.000, 0.054, 0, 50], [0.055, 0.070, 51, 100], [0.071, 0.085, 101, 150], [0.086, 0.105, 151, 200], [0.106, 0.200, 201, 300]]);
  assert.deepEqual(A.PM25_24H, [[0.0, 9.0, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500]]);
});

test('TAD "values from multiple pollutants" example: O3 0.078 ppm -> 126, PM2.5 35.9 -> 102; the AQI is 126 with O3 as the main pollutant', () => {
  assert.equal(A.aqiO3ppm(0.078), 126);
  assert.equal(A.aqiPM25(35.9), 102);
  // Same example through the app's daily pipeline: a flat 0.078 ppm ozone day and a flat 35.9 ug/m3 PM2.5 day.
  const time = Array.from({ length: 48 }, (_, h) => `2026-07-0${1 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`);
  const ug = 0.078 * 1000 * 48.0 / 24.45 + 0.0001;   // ppm -> ug/m3 at 25 C, the inverse of A.o3UgToPpm
  const d = F.dailyAirQuality({ time, ozone: time.map(() => ug), pm2_5: time.map(() => 35.9) })[0];
  assert.equal(d.aqiO3, 126); assert.equal(d.aqiPM25, 102); assert.equal(d.aqi, 126); assert.equal(d.dominant, 'ozone');
});

test('TAD note 4 + FAQ: PM2.5 above 325.4 ug/m3 keeps the 301-500 slope (AQI above 500 is reported, not capped)', () => {
  assert.equal(A.aqiPM25(325.4), 500);
  const slope = (500 - 301) / (325.4 - 225.5);
  assert.equal(A.aqiPM25(350.0), Math.round(slope * (350.0 - 225.5) + 301));
  assert.ok(A.aqiPM25(350.0) > 500 && A.aqiPM25(500.0) > A.aqiPM25(350.0), 'still rises with the concentration');
  assert.equal(A.category(A.aqiPM25(400)).key, 'hazardous');
  // TAD note 2: 8-hour ozone does not define AQI values of 301 or more (1-hour ozone does), so it stays capped.
  assert.equal(A.aqiO3ppm(0.250), 300);
});

test('TAD FAQ (2015 ozone data handling): daily max 8-h ozone uses only the 17 periods that start 7 AM through 11 PM', () => {
  const time = Array.from({ length: 48 }, (_, h) => `2026-07-0${1 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`);
  const ppm = (p) => p * 1000 * 48.0 / 24.45 + 0.0001;
  // A late-night spike from midnight to 6 AM (0.100 ppm) and 0.040 ppm the rest of the day: the 12 AM-8 AM window
  // averages ~0.093 ppm, but EPA never counts a period starting before 7 AM, so the day stays Good.
  const oz = time.map((t, i) => (i < 7 ? ppm(0.100) : ppm(0.040)));
  const d = F.dailyAirQuality({ time, ozone: oz, pm2_5: time.map(() => 5) })[0];
  assert.equal(d.o3ppm, 0.040); assert.equal(d.aqiO3, A.aqiO3ppm(0.040));
  // A spike that starts at 7 AM is counted.
  const oz2 = time.map((t, i) => (i >= 7 && i < 15 ? ppm(0.090) : ppm(0.040)));
  assert.equal(F.dailyAirQuality({ time, ozone: oz2, pm2_5: time.map(() => 5) })[0].o3ppm, 0.090);
  // The 11 PM period (11 PM-7 AM next day) is the last one counted for the day.
  const oz3 = time.map((t, i) => (i >= 23 && i < 31 ? ppm(0.080) : ppm(0.040)));
  assert.equal(F.dailyAirQuality({ time, ozone: oz3, pm2_5: time.map(() => 5) })[0].o3ppm, 0.080);
});
