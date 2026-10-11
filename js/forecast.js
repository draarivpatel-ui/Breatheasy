/* BreatheEasy: turn Open-Meteo hourly air-quality + daily weather into per-day summaries.
 * Air Quality API: https://open-meteo.com/en/docs/air-quality-api (free, no key, CORS enabled)
 * Weather API:     https://open-meteo.com/en/docs (free, no key, CORS enabled)
 * Daily AQI follows EPA reporting rules: PM2.5 uses the 24-hour average; ozone uses the highest
 * 8-hour running average that begins during the day. A day's AQI is the higher of the two.
 */
(function (root) {
  'use strict';
  var AQI = (typeof module !== 'undefined' && module.exports) ? require('./aqi.js') : root.BE_AQI;

  var AQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  var WX_BASE = 'https://api.open-meteo.com/v1/forecast';
  var POLLEN_VARS = ['alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'olive_pollen', 'ragweed_pollen'];

  function aqUrl(lat, lon) {
    return AQ_BASE + '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&hourly=pm2_5,ozone,us_aqi,' + POLLEN_VARS.join(',') +
      '&timezone=auto&past_days=7&forecast_days=4';
  }
  function wxUrl(lat, lon) {
    return WX_BASE + '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&daily=temperature_2m_max,relative_humidity_2m_mean,precipitation_sum' +
      '&temperature_unit=fahrenheit&timezone=auto&past_days=7&forecast_days=4';
  }

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function mean(arr) {
    var v = arr.filter(isNum);
    if (!v.length) return null;
    return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
  }

  /** Highest 8-hour running mean of ozone (µg/m³) whose window *begins* on `date`.
   *  A window needs at least 6 of 8 valid hours (EPA 75% completeness rule). */
  function maxOzone8h(times, ozone, date) {
    var best = null;
    for (var i = 0; i < times.length; i++) {
      if (times[i].slice(0, 10) !== date) continue;
      if (i + 8 > times.length) break;
      var win = ozone.slice(i, i + 8).filter(isNum);
      if (win.length < 6) continue;
      var m = win.reduce(function (a, b) { return a + b; }, 0) / win.length;
      if (best == null || m > best) best = m;
    }
    return best;
  }

  /**
   * hourly: Open-Meteo `hourly` object. Returns [{date, pm25, o3ppm, aqiPM25, aqiO3, aqi,
   * dominant, openMeteoMaxAqi, pollen:{type:max}|null}], one per calendar date.
   */
  function dailyAirQuality(hourly) {
    if (!hourly || !hourly.time) return [];
    var times = hourly.time;
    var dates = [];
    times.forEach(function (t) { var d = t.slice(0, 10); if (dates.indexOf(d) === -1) dates.push(d); });
    return dates.map(function (date) {
      var idx = [];
      times.forEach(function (t, i) { if (t.slice(0, 10) === date) idx.push(i); });
      var pmVals = idx.map(function (i) { return hourly.pm2_5 ? hourly.pm2_5[i] : null; }).filter(isNum);
      var pm25 = pmVals.length >= 18 ? mean(pmVals) : null; // 75% of 24 h
      var o3ug = hourly.ozone ? maxOzone8h(times, hourly.ozone, date) : null;
      var o3ppm = AQI.o3UgToPpm(o3ug);
      var aPM = AQI.aqiPM25(pm25);
      var aO3 = AQI.aqiO3ppm(o3ppm);
      var aqi = null, dominant = null;
      if (aPM != null || aO3 != null) {
        if ((aO3 || 0) >= (aPM || 0)) { aqi = aO3; dominant = 'ozone'; } else { aqi = aPM; dominant = 'pm25'; }
      }
      var omMax = null;
      if (hourly.us_aqi) {
        idx.forEach(function (i) { var v = hourly.us_aqi[i]; if (isNum(v) && (omMax == null || v > omMax)) omMax = v; });
      }
      var pollen = null;
      POLLEN_VARS.forEach(function (k) {
        if (!hourly[k]) return;
        var mx = null;
        idx.forEach(function (i) { var v = hourly[k][i]; if (isNum(v) && (mx == null || v > mx)) mx = v; });
        if (mx != null) { pollen = pollen || {}; pollen[k.replace('_pollen', '')] = mx; }
      });
      return {
        date: date, hours: idx.length,
        pm25: pm25 == null ? null : Math.round(pm25 * 10) / 10,
        o3ppm: o3ppm == null ? null : Math.round(o3ppm * 1000) / 1000,
        aqiPM25: aPM, aqiO3: aO3, aqi: aqi, dominant: dominant,
        openMeteoMaxAqi: omMax, pollen: pollen
      };
    });
  }

  /** Pollen grains/m³ -> 0..3 level. Thresholds are the U.S. National Allergy Bureau ranges the
   *  Houston Health Department reports with (low/moderate/high), simplified to the max across types. */
  var NAB = {
    tree: [15, 90, 1500], grass: [5, 20, 200], weed: [10, 50, 500]
  };
  var TYPE_GROUP = { alder: 'tree', birch: 'tree', olive: 'tree', grass: 'grass', mugwort: 'weed', ragweed: 'weed' };
  function pollenLevel(pollen) {
    if (!pollen) return null;
    var lvl = 0;
    Object.keys(pollen).forEach(function (k) {
      var g = NAB[TYPE_GROUP[k]]; var v = pollen[k];
      if (!g || !isNum(v) || v <= 0) return;
      var l = v < g[0] ? 1 : v < g[1] ? 2 : 3;
      if (l > lvl) lvl = l;
    });
    return lvl;
  }

  /** Merge AQ days with weather `daily` arrays into one record per date. */
  function mergeDays(aqDays, wxDaily) {
    var wx = {};
    if (wxDaily && wxDaily.time) {
      wxDaily.time.forEach(function (d, i) {
        wx[d] = {
          tempMaxF: wxDaily.temperature_2m_max ? wxDaily.temperature_2m_max[i] : null,
          humidity: wxDaily.relative_humidity_2m_mean ? wxDaily.relative_humidity_2m_mean[i] : null,
          precip: wxDaily.precipitation_sum ? wxDaily.precipitation_sum[i] : null
        };
      });
    }
    return aqDays.map(function (d) {
      var w = wx[d.date] || {};
      var out = {};
      Object.keys(d).forEach(function (k) { out[k] = d[k]; });
      out.tempMaxF = isNum(w.tempMaxF) ? w.tempMaxF : null;
      out.humidity = isNum(w.humidity) ? w.humidity : null;
      out.precip = isNum(w.precip) ? w.precip : null;
      out.pollenLevel = pollenLevel(d.pollen);
      return out;
    });
  }

  function fetchJson(url, fetchImpl) {
    return (fetchImpl || fetch)(url).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.error) throw new Error((j && j.reason) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  /** Fetch both APIs and return merged days. Weather failure is tolerated (features become null). */
  function load(lat, lon, fetchImpl) {
    var aq = fetchJson(aqUrl(lat, lon), fetchImpl);
    var wx = fetchJson(wxUrl(lat, lon), fetchImpl).catch(function () { return null; });
    return Promise.all([aq, wx]).then(function (res) {
      return { days: mergeDays(dailyAirQuality(res[0].hourly), res[1] && res[1].daily), timezone: res[0].timezone, fetchedAt: new Date().toISOString() };
    });
  }

  var api = {
    aqUrl: aqUrl, wxUrl: wxUrl, maxOzone8h: maxOzone8h, dailyAirQuality: dailyAirQuality,
    pollenLevel: pollenLevel, mergeDays: mergeDays, load: load, POLLEN_VARS: POLLEN_VARS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Forecast = api;
})(this);
