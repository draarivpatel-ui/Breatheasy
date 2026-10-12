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
  // EPA daily max 8-hour ozone (2015 data handling, AQI TAD FAQ): only the 17 moving 8-hour periods that
  // START from 7 AM (7 AM-3 PM) through 11 PM (11 PM-7 AM next day), local time; each needs >= 6 of 8 hours.
  function maxOzone8h(times, ozone, date) {
    var best = null;
    for (var i = 0; i < times.length; i++) {
      if (times[i].slice(0, 10) !== date) continue;
      if (+times[i].slice(11, 13) < 7) continue;
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
        // Shown as the EPA-truncated values the AQI was computed from (0.1 ug/m3, 0.001 ppm), so the
        // numbers on screen reproduce the AQI by hand: 0.0826 ppm is shown as 82 ppb (AQI 140), not 83 (143).
        pm25: pm25 == null ? null : AQI.truncate(pm25, 1),
        o3ppm: o3ppm == null ? null : AQI.truncate(o3ppm, 3),
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

  /** How long we wait for Open-Meteo before giving up (then js/fccache.js serves the last good answer). */
  var TIMEOUT_MS = 8000;

  function isOffline() {
    return typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
  }

  /** GET JSON. A failed call throws an Error with .status (HTTP code, 0 for network), .rateLimited (429),
   *  .timedOut (no full answer within timeoutMs; the request is aborted) and .offline (browser says offline).
   *  Open-Meteo puts its reason in the body ({"error":true,"reason":"..."}); a non-JSON body is tolerated. */
  function fetchJson(url, fetchImpl, timeoutMs) {
    var ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : TIMEOUT_MS;
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null, timedOut = false;
    function fail(msg, extra) {
      var err = new Error(msg); err.status = 0; err.rateLimited = false; err.timedOut = false; err.offline = isOffline();
      Object.keys(extra || {}).forEach(function (k) { err[k] = extra[k]; });
      return err;
    }
    // The timer both aborts the request and rejects, so a fetch that ignores the signal cannot hang the app.
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        timedOut = true;
        if (ctl) { try { ctl.abort(); } catch (e) { /* ignore */ } }
        reject(fail('timeout after ' + Math.round(ms / 1000) + ' s', { timedOut: true, name: 'TimeoutError' }));
      }, ms);
    });
    var req = Promise.resolve().then(function () {
      return (fetchImpl || fetch)(url, ctl ? { signal: ctl.signal } : undefined);
    }).then(function (r) {
      var body = typeof r.text === 'function'
        ? r.text().then(function (txt) { try { return JSON.parse(txt); } catch (e) { return null; } })
        : r.json().catch(function () { return null; });
      return body.then(function (j) {
        if (!r.ok || !j || j.error) {
          var err = new Error((j && j.reason) || ('HTTP ' + r.status));
          err.status = r.status || 0; err.rateLimited = r.status === 429; err.timedOut = false; err.offline = false;
          err.httpError = true;
          throw err;
        }
        return j;
      });
    }).catch(function (e) {
      if (e && e.httpError) throw e;
      if (timedOut || (e && e.name === 'AbortError')) throw fail('timeout after ' + Math.round(ms / 1000) + ' s', { timedOut: true, name: 'TimeoutError' });
      throw fail((e && e.message) || 'network error');
    });
    return Promise.race([req, timeout]).then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }

  /** Fetch both APIs and return merged days. Weather failure is tolerated (features become null). */
  function load(lat, lon, fetchImpl, timeoutMs) {
    var aq = fetchJson(aqUrl(lat, lon), fetchImpl, timeoutMs);
    var wx = fetchJson(wxUrl(lat, lon), fetchImpl, timeoutMs).catch(function () { return null; });
    return Promise.all([aq, wx]).then(function (res) {
      return { days: mergeDays(dailyAirQuality(res[0].hourly), res[1] && res[1].daily), timezone: res[0].timezone, fetchedAt: new Date().toISOString() };
    });
  }

  var api = {
    aqUrl: aqUrl, wxUrl: wxUrl, maxOzone8h: maxOzone8h, dailyAirQuality: dailyAirQuality,
    pollenLevel: pollenLevel, mergeDays: mergeDays, fetchJson: fetchJson, load: load, POLLEN_VARS: POLLEN_VARS,
    TIMEOUT_MS: TIMEOUT_MS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Forecast = api;
})(this);
