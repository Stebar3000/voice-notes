// Service worker: tiene in memoria l'app così si apre anche senza rete.
// Strategia: risposta immediata dalla cache, aggiornamento in background (vale dall'apertura successiva).
const CACHE = 'noteauto-4.1.0';
const ASSETS = ['./', './index.html', './app.js', './manifest.json', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('noteauto-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // Groq e altro: mai intercettati
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const key = e.request.mode === 'navigate' ? './index.html' : e.request;
    const cached = await c.match(key, { ignoreSearch: true });
    const fresh = fetch(e.request).then((r) => { if (r && r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
    return cached || (await fresh) || new Response('Offline', { status: 503 });
  }));
});
