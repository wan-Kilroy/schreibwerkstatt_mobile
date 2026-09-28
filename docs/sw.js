/* Service worker: keeps every file of the app on the phone, so it starts without waiting for the network
   (and the 13 MB of Python are downloaded only once).  build.py fills in VERSION and FILES; a new VERSION
   (any file changed) downloads the new files in the background and is used from the next start on. */
const VERSION = 'sw-b2f97cee5d24';
const FILES = [
"./",
"app.css",
"boot.js",
"i18n_mobile.js",
"index.html",
"manifest.webmanifest",
"mobile.css",
"worker.js",
"icons/apple-touch-icon.png",
"icons/icon-192.png",
"icons/icon-512-maskable.png",
"icons/icon-512.png",
"js/api.js",
"js/config.js",
"js/db.js",
"js/diff.js",
"js/dom.js",
"js/errors.js",
"js/exercises.js",
"js/feedback.js",
"js/history.js",
"js/i18n.js",
"js/intent.js",
"js/llm.js",
"js/main.js",
"js/mock.js",
"js/practice.js",
"js/prompts.js",
"js/settings.js",
"js/state.js",
"js/stats.js",
"js/zh.js",
"py/files.json",
"py/llm.py",
"py/mobile_glue.py",
"py/server.py",
"py/stopwords_de.txt",
"py/stopwords_domain.txt",
"py/stopwords_en.txt",
"py/stopwords_zh.txt",
"py/topics.py",
"pyodide/pyodide-lock.json",
"pyodide/pyodide.asm.mjs",
"pyodide/pyodide.asm.wasm",
"pyodide/pyodide.mjs",
"pyodide/python_stdlib.zip"
];
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
