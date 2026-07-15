const CACHE_NAME = 'arthspandan-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/static/style.min.css',
  '/static/script.min.js',
  '/static/img/logo.svg',
  '/static/img/favicon.svg',
  '/static/img/bot-avatar.svg',
  '/static/img/user-avatar.svg',
  '/static/site.webmanifest',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// Install Event - Pre-cache Static Assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean Up Old Caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Cache-First for static assets, Network-First with Cache Fallback for dynamic routes
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Exclude admin panel API routes and state-modifying requests from caching
  if (url.pathname.startsWith('/api/admin') || event.request.method !== 'GET') {
    return; // Let browser handle it
  }
  
  // For dynamic API routes like /api/predict, use Network-First and fall back to cache if offline
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the fresh response for offline use
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // If network fails, serve from cache
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Cache-First (with network fallback/update in background) for static assets & pages
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background to update cache (Stale-While-Revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {/* Ignore network failures in background */});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
