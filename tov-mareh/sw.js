const CACHE = 'tov-mareh-ipad-v7-explicit-engines';
const FILES = [
  './',
  './index.html',
  './styles.css?v=20260804-real-controls',
  './app.js?v=20261007-explicit-engines',
  './engine-v21.js?v=20261007-explicit-engines',
  './live-preview-v4.js?v=20261007-explicit-engines',
  './manifest.webmanifest',
  './assets/tov-mareh-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('tov-mareh-ipad-') && key !== CACHE)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

// Return each file unchanged. The HTML owns the engine order.
async function networkFirst(request, cacheKey = request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    networkFirst(event.request, event.request.mode === 'navigate' ? './index.html' : event.request)
  );
});
