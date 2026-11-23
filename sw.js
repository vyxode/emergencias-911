// Service worker: guarda el juego para jugar sin conexión. Sube VERSION al publicar cambios.
const VERSION = 'c911-v2';
const ARCHIVOS = ['./', 'index.html', 'css/estilos.css', 'js/datos.js', 'js/escenarios.js', 'js/sonido.js', 'js/voz.js', 'js/juego.js',
  'manifest.webmanifest', 'iconos/icono.svg', 'iconos/icono-192.png', 'iconos/icono-512.png'];
// Archivos grandes que no cambian (fuentes y motor de voz): se sirven desde la caché sin volver a descargarlos
const FIJOS = /\/(fuentes|voz)\//;

self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('c911-v') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // las voces de HuggingFace las gestiona voz.js
  const guardar = (r, cache = VERSION) => { if (r.ok) { const copia = r.clone(); caches.open(cache).then(c => c.put(e.request, copia)); } return r; };
  if (FIJOS.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(r2 => guardar(r2, 'c911-fijos'))));
    return;
  }
  // Código: red primero (para recibir actualizaciones) y caché si no hay conexión
  e.respondWith(fetch(e.request).then(r => guardar(r)).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
