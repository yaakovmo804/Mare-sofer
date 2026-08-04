const CACHE = 'tov-mareh-v5-fresh-20260804';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './engine-v5.js?v=20260804-v5',
  '../tov-mareh/styles.css?v=20260804-v5',
  '../tov-mareh/app.js?v=20260804-v5',
  '../tov-mareh/engine-v21.js?v=20260804-v5',
  '../tov-mareh/live-preview-v4.js?v=20260804-v5',
  '../tov-mareh/assets/tov-mareh-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('tov-mareh-v5-') && key !== CACHE).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => response)
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
