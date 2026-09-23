// Service worker for the admin page. Keeps the page shell so the installed app opens instantly and shows a clear
// "offline" state instead of a browser error. It NEVER caches /api/: payments, users and refunds are always live.
const ADMIN_CACHE = 'mynotes-admin-v20';                 // bump with ADMIN_VERSION in admin.html (a test keeps them equal)
const SHELL = ['/admin', '/icons/admin-192.png', '/icons/admin-512.png', '/icons/admin-180.png', '/icons/icon-free.png', '/icons/icon-pro.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(ADMIN_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mynotes-admin-') && k !== ADMIN_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;   // live, never cached
  // Page and icons: the network first (so a new admin version shows at once), the saved copy when offline.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && (url.pathname === '/admin' || url.pathname.startsWith('/icons/'))) { const copy = res.clone(); caches.open(ADMIN_CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match('/admin'))));
});
