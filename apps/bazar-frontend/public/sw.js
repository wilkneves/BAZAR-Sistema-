/* Service Worker do PDV.
 * Segurança (RNF-19): cacheia SOMENTE o shell estático (HTML/JS/CSS/ícones).
 * Respostas de /api/* NUNCA são cacheadas aqui — dados do catálogo ficam no IndexedDB
 * controlado pela aplicação, que é apagado no logout/desativação do terminal.
 */
const CACHE = 'bazar-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // nunca cachear API

  // Navegação SPA: rede primeiro, cai para o index.html em cache se offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Assets com hash: cache primeiro, depois rede (e guarda a cópia).
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    })),
  );
});

// Pedido da aplicação para apagar caches (logout / terminal desativado).
self.addEventListener('message', (e) => {
  if (e.data === 'CLEAR_CACHES') {
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
