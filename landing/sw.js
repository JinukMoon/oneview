/* Root kill-switch service worker.
 *
 * The document-viewer PWA used to register its SW at the site root (/oneview/).
 * The app has since moved to /oneview/app/, and the root now serves the static
 * landing/showcase page (no SW needed). Returning visitors may still have the old
 * root SW controlling this scope and serving a stale app shell.
 *
 * When the browser re-checks the root SW it fetches THIS file. It unregisters
 * itself, drops every cache it owns, and reloads open clients so the fresh
 * landing page is served directly from the network. New visitors never register
 * a root SW at all — the landing page does not reference one.
 */
self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(function (c) { try { c.navigate(c.url); } catch (e) {} });
    } catch (e) {}
  })());
});
