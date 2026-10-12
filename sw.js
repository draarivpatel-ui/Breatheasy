/* BreatheEasy service worker: installable + works offline.
 *
 * Cache-busting: VERSION is a content hash of every app file, written by `node scripts/stamp.js`
 * (a unit test fails if it is stale). index.html asks for each file as `file?v=VERSION`, so any code
 * change gives new URLs and a new cache name; the old cache is deleted on activate.
 *  - Pages (navigations): network first, cached copy only when offline, so a new deploy always wins.
 *  - Versioned app files: cache first (their URL changes whenever their content does).
 *  - Other origins (the Open-Meteo forecast APIs): never cached here. js/fccache.js keeps the last good
 *    forecast per place in localStorage (30 min fresh, 3 h fallback) and labels its age honestly.
 */
var VERSION = 'be-186ef96aa8';
var CACHE = 'breatheeasy-' + VERSION;
var ASSETS = [
  'styles.css', 'js/aqi.js', 'js/zones.js', 'js/forecast.js', 'js/fccache.js', 'js/model.js', 'js/guidance.js', 'js/demo.js',
  'js/validate.js', 'js/ics.js', 'js/share.js', 'js/places.js', 'js/i18n.js', 'js/store.js', 'js/app.js'
];
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/maskable-512.png', 'icons/apple-touch-icon.png'].concat(ASSETS.map(function (a) { return a + '?v=' + VERSION; }));

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('breatheeasy-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // forecast APIs: straight to the network

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put('index.html', copy); }); }
      return res;
    }).catch(function () {
      return caches.match('index.html').then(function (r) { return r || caches.match('./'); });
    }));
    return;
  }

  e.respondWith(caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res.ok && url.searchParams.get('v') === VERSION) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  }));
});
