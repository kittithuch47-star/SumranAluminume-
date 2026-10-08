// Intentionally network-only: business data and document pages must never be served stale.
// The service worker exists for installability and future safe, opt-in caching.
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  // Do not intercept requests: Firebase auth, API/PDF, documents and HTML remain network-controlled.
});
