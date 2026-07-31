const CACHE_NAME = 'medidaot-v10-2026-07-31k';
const APP_SHELL = [
  './', './index.html', './medidaot.html', './medidaot.html?v=20260731k',
  './styles.css', './styles.css?v=20260731k',
  './letter-assets.js', './letter-assets.js?v=20260731k',
  './letter-vector-engine.js', './letter-vector-engine.js?v=20260731k',
  './app-1.js', './app-1.js?v=20260731k',
  './letter-tools.js', './letter-tools.js?v=20260731k',
  './app-2.js', './app-2.js?v=20260731k',
  './app-3.js', './app-3.js?v=20260731k',
  './app-4.js', './app-4.js?v=20260731k',
  './auto-measure.js', './auto-measure.js?v=20260731k',
  './stability-patch.js', './stability-patch.js?v=20260731k',
  './manifest.webmanifest', './manifest-medidaot.webmanifest',
  './assets/medidaot-icon-192.png', './assets/medidaot-icon-512.png',
  './assets/medidaot-icon-maskable-512.png', './assets/medidaot-apple-touch-180.png',
  './assets/medidaot-favicon-32.png', './assets/mareh-sofer-brand.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys
      .filter(key => key.startsWith('medidaot-') && key !== CACHE_NAME)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      }).catch(async () =>
        (await caches.match(event.request)) ||
        (await caches.match('./medidaot.html')) ||
        caches.match('./index.html')
      )
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => cached))
  );
});
