// Service Worker for YouTube PWA
// Basic caching for offline shell support

var CACHE_NAME = 'yt-pwa-v1';
var STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// Install - cache static assets
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(STATIC_ASSETS);
        }).then(function() {
            return self.skipWaiting();
        })
    );
});

// Activate - clean old caches
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.filter(function(name) {
                    return name !== CACHE_NAME;
                }).map(function(name) {
                    return caches.delete(name);
                })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', function(event) {
    // Don't cache API requests
    if (event.request.url.indexOf('/api/') !== -1 || 
        event.request.url.indexOf('pipedapi') !== -1 ||
        event.request.url.indexOf('invidious') !== -1) {
        return;
    }

    event.respondWith(
        fetch(event.request).then(function(response) {
            // Cache successful responses
            if (response.status === 200) {
                var responseClone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(event.request, responseClone);
                });
            }
            return response;
        }).catch(function() {
            return caches.match(event.request);
        })
    );
});
