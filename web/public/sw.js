// Minimal service worker so browsers offer "Install". It deliberately caches nothing: the app is
// served by the local PR Deck server, and a cache would only risk showing a stale build.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
