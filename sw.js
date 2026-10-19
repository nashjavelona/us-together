const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `us-together:${SCOPE.href}:`;
const CACHE = `${CACHE_PREFIX}v9`;
const ASSETS = [
  './', './index.html', './style.css', './app.js', './core.js', './calendar.js',
  './couple.js', './together.js', './ui-model.js', './cloud-sync.js',
  './sync-model.js', './cloud-ui.js', './for-you.js', './cloud-config.js', './icon.svg',
  './icon-192.png', './icon-512.png', './manifest.webmanifest',
].map(path => new URL(path, SCOPE).href);
const ASSET_PATHS = new Set(ASSETS.map(url => new URL(url).pathname));

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE) {
        await caches.delete(key);
      } else if (/^us-together-v[1-6]$/.test(key)) {
        // Old releases used a name shared by every project path on an origin.
        // Remove an old cache only when this scope's own shell identifies it.
        const legacy = await caches.open(key);
        const index = await legacy.match(new URL('./index.html', SCOPE).href);
        const app = await legacy.match(new URL('./app.js', SCOPE).href);
        if (index && app) await caches.delete(key);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // A shared-space response must never enter an application-managed cache.
  // Cache API does not enforce HTTP no-store headers on our behalf.
  if (request.method !== 'GET' || request.headers.has('Authorization') ||
      url.origin !== SCOPE.origin || url.pathname === '/api' ||
      url.pathname.startsWith('/api/') || !ASSET_PATHS.has(url.pathname)) return;

  event.respondWith((async () => {
    let response;
    try {
      response = await fetch(request);
    } catch (networkError) {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(request);
      if (saved) return saved;
      throw networkError;
    }

    if (response.ok && !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get('Cache-Control') || '')) {
      const copy = response.clone();
      event.waitUntil(
        caches.open(CACHE)
          .then(cache => cache.put(request, copy))
          .catch(() => {}),
      );
    }
    return response;
  })());
});
