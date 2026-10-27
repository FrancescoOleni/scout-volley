// Ad ogni rilascio di una nuova versione aumentare il numero di CACHE
// (e APP_VERSION in app.js).
const CACHE = 'scoutvolley-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', event => {
  // cache: 'reload' scavalca la cache HTTP del browser (GitHub Pages la tiene 10 minuti),
  // altrimenti la nuova versione potrebbe salvare i file vecchi.
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Prima la cache: l'app funziona anche senza rete in palestra.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then(r => r || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req).then(r => r || fetch(req)));
});
