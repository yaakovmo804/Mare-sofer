const CACHE = 'tov-mareh-ipad-v5-live-preview';
const FILES = [
  './',
  './index.html',
  './styles.css?v=20260804-real-controls',
  './app.js?v=20260804-real-controls',
  './live-preview-v4.js',
  './manifest.webmanifest',
  './assets/tov-mareh-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (url.pathname.endsWith('/tov-mareh/app.js')) {
    event.respondWith((async () => {
      try {
        const [baseResponse, patchResponse] = await Promise.all([
          fetch(event.request, { cache: 'no-store' }),
          fetch('./live-preview-v4.js', { cache: 'no-store' })
        ]);
        const combined = `${await baseResponse.text()}\n\n${await patchResponse.text()}`;
        return new Response(combined, {
          status: 200,
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        });
      } catch (error) {
        return fetch(event.request);
      }
    })());
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
