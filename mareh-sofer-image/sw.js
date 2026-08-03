const CACHE_NAME = 'tov-mareh-standalone-v3';
const APP_ASSETS = [
  './',
  './index.html',
  './app.css?v=20260803c',
  './engine-ui.css?v=20260803c',
  './image-core.js?v=20260803c',
  './ai-provider.js?v=20260803c',
  './app.js?v=20260803c',
  './engine-controller.js?v=20260803c',
  './integration.json',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
