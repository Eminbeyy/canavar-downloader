// Servis çalışanı: uygulama kabuğunu önbelleğe alır (çevrimdışı açılış). API istekleri asla önbelleğe alınmaz.
const V = 'g90-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/js/main.js', '/js/api.js', '/js/ui.js', '/js/onboarding.js', '/js/screens.js', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(V).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('/index.html'))));
});
