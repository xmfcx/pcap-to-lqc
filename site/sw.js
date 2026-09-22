// Only application assets are cached. Selected files never enter this cache.
const CACHE = 'pcap-to-lqc-dev';
const ASSETS = ['./', './index.html', './style.css', './icon.svg', './app.js', './worker.js', './lib/calibration.js', './lib/converter.js', './lib/demo.js', './lib/pcap.js', './lib/time.js', './lib/xt32.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  // Keep older asset caches for tabs still running the preceding app version.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !ASSETS.some(path => new URL(path, self.registration.scope).href === url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
