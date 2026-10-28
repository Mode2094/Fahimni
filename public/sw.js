/* فهمني service worker — safe static assets only.
   Never caches HTML, API responses, auth, AI, payment or webhook traffic.
   Development assets (Cache-Control: no-cache from next dev) are never cached,
   so local styling/chunks always come from the dev server. */
const CACHE = 'fahimni-static-v2';
const ASSET_PREFIXES = ['/_next/static/', '/icons/', '/fonts/', '/book/'];

// Only long-lived, cacheable responses are stored. next dev serves its chunks
// with "no-cache, must-revalidate"; honouring that here makes dev caching
// impossible even if a worker is ever registered during development.
function cacheable(response) {
  if (!response.ok || response.type !== 'basic') return false;
  const control = (response.headers.get('Cache-Control') || '').toLowerCase();
  if (!control) return false;
  if (control.includes('no-store') || control.includes('no-cache') || control.includes('private')) return false;
  return true;
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (cacheable(response)) cache.put(request, response.clone());
      return response;
    }),
  );
});
