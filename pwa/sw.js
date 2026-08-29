// Minimal offline shell for installability. Caches same-origin assets; lets
// Google API / GIS requests always hit the network.
const CACHE = 'lt-pwa-v1';
const ASSETS = [
  './', './index.html', './app.js', './drive.js', './styles.css', './manifest.webmanifest',
  '../src/lib/dom.js', '../src/lib/url-safe.js', '../src/lib/sync-config.js',
  '../src/styles/tokens.css', '../icons/icon-128.png', '../icons/icon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // Google APIs / GIS → network
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
