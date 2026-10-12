/* BreatheEasy: U.S. EPA Air Quality Index math (pure functions, no DOM).
 * Breakpoints: 40 CFR Part 58, Appendix G, Table 2 (as amended Feb 2024, effective May 6, 2024)
 * https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-58/appendix-Appendix%20G%20to%20Part%2058
 * PM2.5 update: https://www.epa.gov/system/files/documents/2024-02/pm-naaqs-air-quality-index-fact-sheet.pdf
 * Method + worked examples: EPA AQI Technical Assistance Document, https://document.airnow.gov/technical-assistance-document-for-the-reporting-of-daily-air-quailty.pdf
 */
(function (root) {
  'use strict';

  // [lowConc, highConc, lowAQI, highAQI]
  var PM25_24H = [
    [0.0, 9.0, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 500]
  ];
  // 8-hour ozone, ppm. EPA defines no 8-hour breakpoint above 0.200 ppm (1-hour values are used there).
  var O3_8H = [
    [0.000, 0.054, 0, 50],
    [0.055, 0.070, 51, 100],
    [0.071, 0.085, 101, 150],
    [0.086, 0.105, 151, 200],
    [0.106, 0.200, 201, 300]
  ];

  var CATEGORIES = [
    { key: 'good', min: 0, max: 50, color: '#00e400', ink: '#0b3d0b' },
    { key: 'moderate', min: 51, max: 100, color: '#ffff00', ink: '#3d3a00' },
    { key: 'usg', min: 101, max: 150, color: '#ff7e00', ink: '#3d1f00' },
    { key: 'unhealthy', min: 151, max: 200, color: '#ff0000', ink: '#ffffff' },
    { key: 'very', min: 201, max: 300, color: '#8f3f97', ink: '#ffffff' },
    { key: 'hazardous', min: 301, max: 500, color: '#7e0023', ink: '#ffffff' }
  ];

  function truncate(x, decimals) {
    var f = Math.pow(10, decimals);
    // small epsilon guards against float artefacts like 0.0549999999
    return Math.floor(x * f + 1e-9) / f;
  }

  function fromTable(c, table) {
    if (c == null || !isFinite(c) || c < 0) return null;
    for (var i = 0; i < table.length; i++) {
      var r = table[i];
      if (c >= r[0] && c <= r[1]) {
        return Math.round(((r[3] - r[2]) / (r[1] - r[0])) * (c - r[0]) + r[2]);
      }
    }
    // Above the top breakpoint. PM2.5 (AQI TAD May 2024/2026, Table 6 note 4 + FAQ): values above 500 use
    // Equation 1 with the 301-500 segment's slope, no cap ("Beyond the AQI" days in wildfire smoke stay honest).
    // 8-hour ozone defines no AQI of 301 or more (those come from 1-hour ozone), so it stays capped at 300.
    var top = table[table.length - 1];
    if (c > top[1]) return table === PM25_24H ? Math.round(((top[3] - top[2]) / (top[1] - top[0])) * (c - top[0]) + top[2]) : top[3];
    return null;
  }

  /** PM2.5 24-hour average (µg/m³) -> AQI. Concentration truncated to 0.1 µg/m³ per EPA. */
  function aqiPM25(ugm3) {
    if (ugm3 == null || !isFinite(ugm3)) return null;
    return fromTable(truncate(ugm3, 1), PM25_24H);
  }

  /** Ozone 8-hour average (ppm) -> AQI. Concentration truncated to 0.001 ppm per EPA. */
  function aqiO3ppm(ppm) {
    if (ppm == null || !isFinite(ppm)) return null;
    return fromTable(truncate(ppm, 3), O3_8H);
  }

  /** Ozone µg/m³ -> ppm at 25 °C and 1 atm: ppb = µg/m³ × 24.45 / 48.00. */
  function o3UgToPpm(ugm3) {
    if (ugm3 == null || !isFinite(ugm3)) return null;
    return (ugm3 * 24.45) / 48.0 / 1000;
  }

  function category(aqi) {
    if (aqi == null || !isFinite(aqi)) return null;
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (aqi <= CATEGORIES[i].max) return CATEGORIES[i];
    }
    return CATEGORIES[CATEGORIES.length - 1];
  }

  var api = {
    PM25_24H: PM25_24H,
    O3_8H: O3_8H,
    CATEGORIES: CATEGORIES,
    truncate: truncate,
    aqiPM25: aqiPM25,
    aqiO3ppm: aqiO3ppm,
    o3UgToPpm: o3UgToPpm,
    category: category
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_AQI = api;
})(this);
