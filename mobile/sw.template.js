/* Service worker: keeps every file of the app on the phone, so it starts without waiting for the network
   (and the 13 MB of Python are downloaded only once).  build.py fills in VERSION and FILES; a new VERSION
   (any file changed) downloads the new files in the background and is used from the next start on. */
const VERSION = '__VERSION__';
const FILES = __FILES__;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;     // model APIs etc.: straight to the network
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./') : null);
    return hit || fetch(req);
  }));
});
