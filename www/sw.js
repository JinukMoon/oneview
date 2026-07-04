/* OneView service worker — offline shell for the PWA / GitHub Pages build.
 *
 * Cache-explosion policy (deliberate):
 *   - PRECACHE:   only the fixed app shell (html/css/js/wasm/worker). Bounded, small.
 *   - RUNTIME:    only same-origin /vendor/ assets fetched on demand (pdf.js cmaps,
 *                 standard_fonts). These are static and finite; we cache-first them so
 *                 repeat opens are offline, but they never grow beyond the shipped set.
 *   - NEVER cache user documents. Those arrive as blob: URLs (not http) and are fetched
 *                 with `cache: 'no-store'` by app.js, so they bypass the SW entirely.
 *   - On activate, delete every cache whose name != current version → no stale buildup.
 *
 * Bump CACHE_VERSION on every deploy so old shells are purged.
 */
'use strict';

var CACHE_VERSION = 'oneview-v1';
var PRECACHE = CACHE_VERSION + '-shell';
var RUNTIME = CACHE_VERSION + '-vendor';

// App shell: the minimum needed to boot offline. Keep this list tight.
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './web-shim.js',
  './manifest.webmanifest',
  './vendor/app-bundle.js',
  './vendor/pdf.worker.js',
  './vendor/rhwp_bg.wasm',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(PRECACHE).then(function (cache) {
      // addAll is atomic-ish; if one 404s the install fails, so keep SHELL correct.
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        // Drop any cache not belonging to the current version → prevents buildup.
        if (key !== PRECACHE && key !== RUNTIME) return caches.delete(key);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // Only handle GET. Never touch POST/etc.
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Only handle our own origin. blob:, data:, and cross-origin (e.g. CDN) pass through
  // untouched — this is what keeps user documents out of the cache.
  if (url.origin !== self.location.origin) return;

  var path = url.pathname;

  // Runtime cache: static vendor assets only (cmaps, standard_fonts, wasm chunks…).
  // Cache-first, then network; store a copy on first fetch. Finite set → bounded size.
  if (path.indexOf('/vendor/') !== -1) {
    event.respondWith(
      caches.open(RUNTIME).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // App shell / navigations: cache-first with network fallback, and for navigations
  // fall back to the cached index.html so deep links work offline.
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).catch(function () {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
