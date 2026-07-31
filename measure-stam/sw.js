const CACHE_NAME = 'medidaot-v7-2026-07-31h';
const APP_SHELL = [
  './', './index.html', './medidaot.html', './medidaot.html?v=20260731h',
  './styles.css', './styles.css?v=20260731h',
  './app-1.js', './app-1.js?v=20260731h',
  './app-2.js', './app-2.js?v=20260731h',
  './app-3.js', './app-3.js?v=20260731h',
  './app-4.js', './app-4.js?v=20260731h',
  './stability-patch.js', './stability-patch.js?v=20260731h',
  './manifest.webmanifest', './manifest-medidaot.webmanifest', './icon.svg'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(async () => {
      if (event.request.mode !== 'navigate') return cached;
      return (await caches.match('./medidaot.html')) || caches.match('./index.html');
    }))
  );
});
