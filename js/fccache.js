/* BreatheEasy: per-place forecast cache, so an Open-Meteo 429 (rate limit) or outage never blanks the app.
 *  - The last good answer for each place is kept in localStorage on this device.
 *  - For 30 minutes it is served as-is (no network call), which also keeps us under the API's rate limit.
 *    Refresh forces a new request.
 *  - After that we ask Open-Meteo again; if that fails, the saved answer is used as a fallback for up to
 *    3 hours, and the app labels it honestly ("as of N min ago").
 *  - Past 3 hours nothing is shown, and the app says plainly that there is no data.
 * Everything here is pure (storage, clock and loader are passed in), so it is unit-tested in Node.
 */
(function (root) {
  'use strict';
  var KEY = 'breatheeasy.fccache.v1';
  var FRESH_MS = 30 * 60 * 1000;      // serve without a network call
  var MAX_STALE_MS = 3 * 60 * 60 * 1000; // fallback limit when the API fails
  var MAX_PLACES = 8;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  /** ~1 km grid, so the same city always maps to the same entry. */
  function placeKey(lat, lon) { return Number(lat).toFixed(2) + ',' + Number(lon).toFixed(2); }

  function readAll(storage) {
    try {
      var v = JSON.parse(storage.getItem(KEY));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  function writeAll(storage, all) {
    try { storage.setItem(KEY, JSON.stringify(all)); return true; } catch (e) { return false; } // full or blocked
  }

  /** Save a good answer. Drops entries older than 3 h and keeps at most 8 places (newest first). */
  function put(storage, lat, lon, data, now) {
    var all = readAll(storage), out = {};
    all[placeKey(lat, lon)] = { savedAt: now, data: data };
    Object.keys(all)
      .filter(function (k) { return all[k] && isNum(all[k].savedAt) && now - all[k].savedAt <= MAX_STALE_MS && now >= all[k].savedAt - 60000; })
      .sort(function (a, b) { return all[b].savedAt - all[a].savedAt; })
      .slice(0, MAX_PLACES)
      .forEach(function (k) { out[k] = all[k]; });
    return writeAll(storage, out);
  }

  /** The saved answer for this place, or null if there is none, it is older than 3 h, or it is from the future. */
  function get(storage, lat, lon, now) {
    var e = readAll(storage)[placeKey(lat, lon)];
    if (!e || !isNum(e.savedAt) || !e.data || !Array.isArray(e.data.days)) return null;
    var age = now - e.savedAt;
    if (age < -60000 || age > MAX_STALE_MS) return null; // clock went backwards, or too old to trust
    age = Math.max(0, age);
    return { data: e.data, savedAt: e.savedAt, ageMs: age, fresh: age <= FRESH_MS };
  }

  function clear(storage) { try { storage.removeItem(KEY); } catch (e) { /* ignore */ } }

  /**
   * opts: {lat, lon, storage, now (ms), load: (lat, lon) => Promise<data>, force}
   * Resolves {data, source: 'network' | 'cache' | 'fallback', ageMs, savedAt, error?}.
   * Rejects with the load error (err.noData = true) when the API failed and nothing usable is saved.
   */
  function getForecast(opts) {
    var now = opts.now, hit = get(opts.storage, opts.lat, opts.lon, now);
    if (hit && hit.fresh && !opts.force) {
      return Promise.resolve({ data: hit.data, source: 'cache', ageMs: hit.ageMs, savedAt: hit.savedAt });
    }
    return Promise.resolve().then(function () { return opts.load(opts.lat, opts.lon); }).then(function (data) {
      put(opts.storage, opts.lat, opts.lon, data, now);
      return { data: data, source: 'network', ageMs: 0, savedAt: now };
    }, function (err) {
      err = err instanceof Error ? err : new Error(String(err || 'network error'));
      if (hit) return { data: hit.data, source: 'fallback', ageMs: hit.ageMs, savedAt: hit.savedAt, error: err };
      err.noData = true;
      throw err;
    });
  }

  /** Age -> which "as of" string to use: {key: 'as_of_now'|'as_of_min'|'as_of_hm', n, h, m}. */
  function ageParts(ms) {
    var min = Math.floor(Math.max(0, ms || 0) / 60000);
    if (min < 1) return { key: 'as_of_now' };
    if (min < 60) return { key: 'as_of_min', n: min };
    return { key: 'as_of_hm', h: Math.floor(min / 60), m: min % 60 };
  }

  var api = {
    KEY: KEY, FRESH_MS: FRESH_MS, MAX_STALE_MS: MAX_STALE_MS, MAX_PLACES: MAX_PLACES,
    placeKey: placeKey, put: put, get: get, clear: clear, getForecast: getForecast, ageParts: ageParts
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_FcCache = api;
})(this);
