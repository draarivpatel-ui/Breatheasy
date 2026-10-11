// EPA AQI math. Expected values come from 40 CFR Part 58 App. G Table 2 (2024) and EPA's worked example.
const test = require('node:test'); const assert = require('node:assert/strict');
const A = require('../js/aqi.js');

test('EPA worked example: 8-h ozone 0.07853333 ppm -> truncate 0.078 -> AQI 126', () => {
  assert.equal(A.aqiO3ppm(0.07853333), 126);
});
test('ozone breakpoints map to category edges', () => {
  assert.equal(A.aqiO3ppm(0), 0);
  assert.equal(A.aqiO3ppm(0.054), 50);
  assert.equal(A.aqiO3ppm(0.055), 51);
  assert.equal(A.aqiO3ppm(0.070), 100);
  assert.equal(A.aqiO3ppm(0.0709), 100, 'truncation keeps 0.0709 in Moderate');
  assert.equal(A.aqiO3ppm(0.071), 101);
  assert.equal(A.aqiO3ppm(0.085), 150);
  assert.equal(A.aqiO3ppm(0.086), 151);
  assert.equal(A.aqiO3ppm(0.105), 200);
  assert.equal(A.aqiO3ppm(0.106), 201);
  assert.equal(A.aqiO3ppm(0.200), 300);
  assert.equal(A.aqiO3ppm(0.25), 300, 'no 8-h breakpoint above 0.200; capped');
});
test('PM2.5 uses the 2024 breakpoints (Good ends at 9.0)', () => {
  assert.equal(A.aqiPM25(9.0), 50);
  assert.equal(A.aqiPM25(9.1), 51);
  assert.equal(A.aqiPM25(12.0), 56, 'was Good (50) before 2024, Moderate now');
  assert.equal(A.aqiPM25(35.4), 100);
  assert.equal(A.aqiPM25(35.5), 101);
  assert.equal(A.aqiPM25(55.4), 150);
  assert.equal(A.aqiPM25(55.5), 151);
  assert.equal(A.aqiPM25(125.4), 200);
  assert.equal(A.aqiPM25(125.5), 201);
  assert.equal(A.aqiPM25(225.4), 300);
  assert.equal(A.aqiPM25(225.5), 301);
  assert.equal(A.aqiPM25(325.4), 500);
  assert.equal(A.aqiPM25(9.05), 50, 'truncated to 9.0');
});
test('invalid inputs return null', () => {
  [null, undefined, NaN, -1, Infinity].forEach(v => { assert.equal(A.aqiPM25(v), null); assert.equal(A.aqiO3ppm(v), null); });
});
test('ozone unit conversion at 25 C: 100 ug/m3 ~ 50.9 ppb', () => {
  assert.ok(Math.abs(A.o3UgToPpm(100) - 0.050938) < 1e-5);
  assert.equal(A.o3UgToPpm(null), null);
});
test('categories and colors follow EPA AQI Basics', () => {
  assert.equal(A.category(0).key, 'good'); assert.equal(A.category(50).key, 'good');
  assert.equal(A.category(51).key, 'moderate'); assert.equal(A.category(100).key, 'moderate');
  assert.equal(A.category(101).key, 'usg'); assert.equal(A.category(150).key, 'usg');
  assert.equal(A.category(151).key, 'unhealthy'); assert.equal(A.category(201).key, 'very');
  assert.equal(A.category(301).key, 'hazardous'); assert.equal(A.category(999).key, 'hazardous');
  assert.equal(A.category(120).color, '#ff7e00');
  assert.equal(A.category(null), null);
});
