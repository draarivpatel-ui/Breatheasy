/* BreatheEasy: find any city with the Open-Meteo Geocoding API.
 * https://open-meteo.com/en/docs/geocoding-api (free, no key, CORS enabled; GeoNames data)
 * Pure helpers (URL, ranking, labels) are unit-tested; search() is the only network call.
 */
(function (root) {
  'use strict';
  var BASE = 'https://geocoding-api.open-meteo.com/v1/search';

  function searchUrl(name, lang) {
    return BASE + '?name=' + encodeURIComponent(String(name).trim()) + '&count=10&format=json&language=' + (lang === 'es' ? 'es' : 'en');
  }

  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  /** "Pune, Maharashtra, India" (skips a region that just repeats the name). */
  function label(r) {
    var parts = [r.name];
    if (r.admin1 && r.admin1 !== r.name) parts.push(r.admin1);
    if (r.country) parts.push(r.country);
    return parts.join(', ');
  }

  /** Keep results with coordinates, biggest places first (ties keep the API's order), max 5. */
  function rank(json) {
    var rows = (json && Array.isArray(json.results)) ? json.results : [];
    return rows
      .map(function (r, i) { return { r: r, i: i }; })
      .filter(function (x) { return x.r && x.r.name && isNum(x.r.latitude) && isNum(x.r.longitude); })
      .sort(function (a, b) { return ((b.r.population || 0) - (a.r.population || 0)) || (a.i - b.i); })
      .slice(0, 5)
      .map(function (x) { return { name: label(x.r), lat: x.r.latitude, lon: x.r.longitude }; });
  }

  function search(name, lang, timeoutMs) {
    if (!name || String(name).trim().length < 2) return Promise.resolve([]);
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || 8000) : null;
    return fetch(searchUrl(name, lang), ctl ? { signal: ctl.signal } : undefined)
      .then(function (r) { if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r.json(); })
      .then(rank)
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  var api = { searchUrl: searchUrl, label: label, rank: rank, search: search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Places = api;
})(this);
