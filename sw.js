/* LifeOS — service worker.
   The shell is cached so the app opens with no network at all. Data never goes
   through here: it lives in IndexedDB and syncs separately. */
var CACHE = "lifeos-1.3.4";
var SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./css/tokens.css", "./css/base.css", "./css/components.css",
  "./js/config.js", "./js/util.js", "./js/data/seed.js", "./js/db.js", "./js/store.js",
  "./js/ui.js", "./js/charts.js", "./js/forms.js", "./js/day-sheet.js", "./js/insights.js",
  "./js/perf.js", "./js/weekly.js", "./js/tasks.js", "./js/meals.js", "./js/timer-ui.js",
  "./js/importer.js", "./js/exporter.js", "./js/cloud.js",
  "./js/screens/home.js", "./js/screens/time.js", "./js/screens/health.js",
  "./js/screens/progress.js", "./js/screens/more.js", "./js/app.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET") return;                 // never cache writes
  if (url.pathname.indexOf("/rest/v1/") >= 0 || url.pathname.indexOf("/auth/v1/") >= 0) return; // Supabase goes straight to the network

  // Shell files: cache first, refresh in the background.
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.status === 200 && url.origin === location.origin) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
