const CACHE = 'tov-mareh-ipad-v6-engine-40';
const FILES = [
  './',
  './index.html',
  './styles.css?v=20260804-real-controls',
  './app.js?v=20260804-real-controls',
  './engine-v21.js',
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

async function combinedAppResponse(request) {
  try {
    const [appResponse, engineResponse, previewResponse] = await Promise.all([
      fetch(request, { cache: 'no-store' }),
      fetch('./engine-v21.js', { cache: 'no-store' }),
      fetch('./live-preview-v4.js', { cache: 'no-store' })
    ]);
    if (!appResponse.ok || !engineResponse.ok || !previewResponse.ok) {
      throw new Error('engine fetch failed');
    }
    const combined = [
      await appResponse.text(),
      await engineResponse.text(),
      await previewResponse.text()
    ].join('\n\n');
    return new Response(combined, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    return caches.match(request);
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.pathname.endsWith('/tov-mareh/app.js')) {
    event.respondWith(combinedAppResponse(event.request));
    return;
  }

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
