/* BreatheEasy: saved-data guard (pure functions, no DOM).
 * Everything the app keeps lives in this browser's localStorage. A copy saved by an older version, or edited by
 * hand, must never stop the page from loading: sanitize() keeps every field that is the right shape and drops or
 * resets the rest (a bad check-in row is dropped, not the whole diary). validDay() refuses impossible ?today= dates.
 */
(function (root) {
  'use strict';
  var LANGS = ['en', 'es'];
  var ZONES = ['green', 'yellow', 'red'];
  var TRIGGERS = ['ozone', 'smoke', 'pollen', 'heat', 'mold', 'cold'];
  var TEXT = ['green', 'yellow', 'red', 'beforeExercise', 'doctorPhone'];
  var DAY = /^\d{4}-\d{2}-\d{2}$/;

  function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /** A real calendar day as YYYY-MM-DD (2026-02-30 and 2026-13-45 are refused). */
  function validDay(s) {
    if (typeof s !== 'string' || !DAY.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (y < 1900 || m < 1 || m > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  function place(p) { // {name?, lat, lon} with real coordinates, else null
    if (!isObj(p)) return null;
    var lat = num(p.lat), lon = num(p.lon);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    var out = { lat: lat, lon: lon };
    if (typeof p.name === 'string' && p.name.trim()) out.name = p.name;
    return out;
  }

  function plan(p) {
    var out = { triggers: [] };
    if (!isObj(p)) return out;
    var best = num(p.personalBest);
    out.personalBest = best != null && best >= 50 && best <= 900 && best === Math.round(best) ? best : null;
    TEXT.forEach(function (k) { if (typeof p[k] === 'string') out[k] = p[k]; });
    if (Array.isArray(p.triggers)) out.triggers = p.triggers.filter(function (x, i, a) { return TRIGGERS.indexOf(x) !== -1 && a.indexOf(x) === i; });
    return out;
  }

  /** One diary row, or null when it can't be used (no real date, no green/yellow/red zone). Numbers that aren't numbers become null. */
  function entry(e) {
    if (!isObj(e) || !validDay(e.date)) return null;
    var out = {};
    Object.keys(e).forEach(function (k) { out[k] = e[k]; });
    if (ZONES.indexOf(out.zone) === -1) return null; // the app always writes a zone; without one the row can't be shown or learned from
    ['peakFlow', 'personalBest', 'percent', 'aqiO3', 'aqiPM25', 'pollenLevel', 'tempMaxF', 'humidity'].forEach(function (k) {
      if (own(out, k)) out[k] = num(out[k]);
    });
    out.symptoms = Array.isArray(out.symptoms) ? out.symptoms.filter(function (s) { return typeof s === 'string'; }) : [];
    if (own(out, 'danger')) out.danger = out.danger === true;
    if (own(out, 'reliever')) out.reliever = out.reliever === true;
    return out;
  }

  /** One row per day (the later copy wins), oldest first. */
  function entries(list) {
    if (!Array.isArray(list)) return [];
    var byDay = {};
    list.forEach(function (e) { var x = entry(e); if (x) byDay[x.date] = x; });
    return Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
  }

  /**
   * raw: whatever JSON.parse gave back for the saved state (or null). navLang: navigator.language.
   * placeKeys: the built-in place ids (sugarland, houston, ...). Returns a state the app can always render.
   */
  function sanitize(raw, navLang, placeKeys) {
    var s = isObj(raw) ? raw : {};
    var fallbackLang = String(navLang || 'en').slice(0, 2).toLowerCase() === 'es' ? 'es' : 'en';
    var out = {
      lang: LANGS.indexOf(s.lang) !== -1 ? s.lang : fallbackLang,
      place: 'sugarland', custom: place(s.custom), searched: place(s.searched),
      plan: plan(s.plan), entries: entries(s.entries)
    };
    if (out.searched && !out.searched.name) out.searched = null; // a searched place is shown by its name
    var keys = placeKeys || [];
    if (typeof s.place === 'string' && keys.indexOf(s.place) !== -1) out.place = s.place;
    else if (s.place === 'mine' && out.custom) out.place = 'mine';
    else if (s.place === 'search' && out.searched) out.place = 'search';
    return out;
  }

  /** The saved SYNTHETIC demo diary: a usable list of rows, or null. */
  function demo(raw) { var e = entries(raw); return e.length ? e : null; }

  var api = { sanitize: sanitize, demo: demo, entries: entries, validDay: validDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Store = api;
})(typeof window !== 'undefined' ? window : this);
