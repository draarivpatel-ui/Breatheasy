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
    Object.keys(e).forEach(function (k) { if (k !== '__proto__') out[k] = e[k]; }); // a JSON '__proto__' key must not become the row's prototype
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

  /* ---------- Back up / Restore ---------- */
  var MAX_BACKUP_BYTES = 1024 * 1024; // a year of daily check-ins is ~150 KB; anything over 1 MB is not one of our backups

  function byteLength(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }

  /**
   * text: the contents of a file the user picked (from "Export my data (JSON)").
   * Returns {ok: true, plan, entries, dropped} or {ok: false, error: 'too_big' | 'bad_json' | 'not_backup'}.
   * The plan and every check-in go through the same guard as saved data, so a hand-edited file can't break the page.
   */
  function parseBackup(text) {
    if (typeof text !== 'string') return { ok: false, error: 'bad_json' };
    if (text.length > MAX_BACKUP_BYTES || byteLength(text) > MAX_BACKUP_BYTES) return { ok: false, error: 'too_big' };
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: 'bad_json' }; }
    if (!isObj(raw)) return { ok: false, error: 'not_backup' };
    var hasPlan = isObj(raw.plan), hasEntries = Array.isArray(raw.entries);
    if (!hasPlan && !hasEntries) return { ok: false, error: 'not_backup' };
    if (own(raw, 'entries') && !hasEntries) return { ok: false, error: 'not_backup' };
    if (own(raw, 'plan') && !hasPlan) return { ok: false, error: 'not_backup' };
    var rows = entries(raw.entries);
    var given = hasEntries ? raw.entries.length : 0;
    if (given > 0 && rows.length === 0 && !hasPlan) return { ok: false, error: 'not_backup' };
    return { ok: true, plan: plan(raw.plan), entries: rows, dropped: given - rows.length };
  }

  /** The JSON written by "Export my data". parseBackup(backupText(...)) gives the same plan and entries back. */
  function backupText(state, nowIso) {
    return JSON.stringify({ exportedAt: nowIso, plan: state.plan, entries: state.entries }, null, 2);
  }

  /**
   * Ask the browser once (per browser profile) to keep this site's storage, so Safari/Chrome don't evict the diary.
   * nav: navigator. storage: localStorage. flagKey: where "already asked" is remembered. Feature-detected, never throws,
   * no UI. Returns true only when it asked this time.
   */
  function requestPersist(nav, storage, flagKey) {
    try {
      if (!nav || !nav.storage || typeof nav.storage.persist !== 'function') return false;
      if (storage.getItem(flagKey)) return false;
      storage.setItem(flagKey, '1');
      var p = nav.storage.persist();
      if (p && typeof p.catch === 'function') p.catch(function () { /* refused: nothing to do */ });
      return true;
    } catch (e) { return false; }
  }

  var api = { sanitize: sanitize, demo: demo, entries: entries, validDay: validDay, parseBackup: parseBackup, backupText: backupText, requestPersist: requestPersist, MAX_BACKUP_BYTES: MAX_BACKUP_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Store = api;
})(typeof window !== 'undefined' ? window : this);
