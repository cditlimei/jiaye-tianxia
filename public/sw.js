const CACHE_NAME = 'jiaye-tianxia-v6';
const MEDIA_CACHE_NAME = 'jiaye-tianxia-media-v3';
const BASE_PATH = self.location.pathname.replace(/sw\.js$/, '');
const APP_SHELL = [BASE_PATH, `${BASE_PATH}manifest.webmanifest`, `${BASE_PATH}icon.svg`];
const MEDIA_DESTINATIONS = new Set(['audio', 'font', 'image', 'video']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== MEDIA_CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate' || request.destination === 'document') {
      event.respondWith(networkFirst(request, CACHE_NAME));
      return;
    }

    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  if (MEDIA_DESTINATIONS.has(request.destination)) {
    event.respondWith(staleWhileRevalidate(request, MEDIA_CACHE_NAME));
  }
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(BASE_PATH)) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response.ok || response.type === 'opaque') {
        void cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || update;
}
