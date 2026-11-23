// Service worker: guarda el juego para jugar sin conexión. Sube VERSION al publicar cambios.
const VERSION = 'c911-v1';
const ARCHIVOS = ['./', 'index.html', 'css/estilos.css', 'js/datos.js', 'js/escenarios.js', 'js/sonido.js', 'js/juego.js',
  'manifest.webmanifest', 'iconos/icono.svg', 'iconos/icono-192.png', 'iconos/icono-512.png',
  'fuentes/barlow-latin-400-normal.woff2', 'fuentes/barlow-latin-500-normal.woff2', 'fuentes/barlow-latin-600-normal.woff2',
  'fuentes/barlow-latin-700-normal.woff2', 'fuentes/barlow-condensed-latin-600-normal.woff2', 'fuentes/barlow-condensed-latin-700-normal.woff2'];

self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Red primero (para recibir actualizaciones) y caché si no hay conexión
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
