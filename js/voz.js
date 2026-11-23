// Voces neuronales (Piper) para los llamantes. Los modelos se descargan una vez y se guardan en la tablet.
'use strict';

const Voz = (() => {
  // ?vozbase=... permite probar con modelos locales
  const BASE = new URLSearchParams(location.search).get('vozbase') || 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/';
  const VOCES = {
    es: { ruta: 'es/es_ES/sharvard/medium/es_ES-sharvard-medium', mb: 77, nombre: 'Español' },
    en: { ruta: 'en/en_US/libritts_r/medium/en_US-libritts_r-medium', mb: 78, nombre: 'Inglés (turnos 7 a 10)' },
  };
  const CACHE = 'c911-voces';
  const estado = { es: 'no', en: 'no' }; // no | descargando | cargando | listo | error
  const progreso = { es: 0, en: 0 };
  let worker = null, sig = 0, aviso = () => {};
  const espera = new Map(), cargando = {};
  const url = (lang, ext) => BASE + VOCES[lang].ruta + ext;

  function hilo() {
    if (worker) return worker;
    worker = new Worker('voz/voz-worker.js');
    worker.onmessage = ({ data }) => {
      const p = espera.get(data.id); espera.delete(data.id);
      if (p) data.error ? p.mal(new Error(data.error)) : p.ok(data);
    };
    worker.onerror = () => { espera.forEach(p => p.mal(new Error('worker'))); espera.clear(); };
    return worker;
  }
  const pedir = (msg, transferir = []) => new Promise((ok, mal) => {
    const id = ++sig; espera.set(id, { ok, mal }); hilo().postMessage({ ...msg, id }, transferir);
  });

  async function guardada(lang) {
    try { return !!(await (await caches.open(CACHE)).match(url(lang, '.onnx'))); } catch { return false; }
  }

  // Descarga con barra de progreso y guarda en la caché del navegador
  async function bajar(dir, alAvanzar) {
    const r = await fetch(dir);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const total = +r.headers.get('Content-Length') || 0, lector = r.body.getReader(), trozos = [];
    let hecho = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      trozos.push(value); hecho += value.length; if (total) alAvanzar?.(hecho / total);
    }
    await (await caches.open(CACHE)).put(dir, new Response(new Blob(trozos)));
  }

  async function descargar(lang) {
    estado[lang] = 'descargando'; progreso[lang] = 0; aviso();
    try {
      await bajar(url(lang, '.onnx.json'));
      await bajar(url(lang, '.onnx'), p => { progreso[lang] = p; aviso(); });
      try { await navigator.storage?.persist?.(); } catch { /* sin permiso */ }
      await activar(lang);
    } catch (e) { estado[lang] = 'error'; aviso(); throw e; }
  }

  function activar(lang) {
    cargando[lang] ??= (async () => {
      estado[lang] = 'cargando'; aviso();
      const c = await caches.open(CACHE);
      const cfg = await (await c.match(url(lang, '.onnx.json'))).json();
      const onnx = await (await c.match(url(lang, '.onnx'))).arrayBuffer();
      await pedir({ tipo: 'cargar', lang, onnx, cfg }, [onnx]);
      estado[lang] = 'listo'; aviso();
    })().catch(e => { estado[lang] = 'error'; cargando[lang] = null; aviso(); throw e; });
    return cargando[lang];
  }

  async function borrar(lang) {
    try { const c = await caches.open(CACHE); await c.delete(url(lang, '.onnx')); await c.delete(url(lang, '.onnx.json')); } catch { /* nada que borrar */ }
    estado[lang] = 'no'; cargando[lang] = null; worker?.terminate(); worker = null;
    for (const l of Object.keys(VOCES)) if (estado[l] === 'listo') { estado[l] = 'no'; cargando[l] = null; activar(l).catch(() => {}); }
    aviso();
  }

  // Al arrancar, carga en memoria las voces ya descargadas
  async function iniciar(alCambiar) {
    aviso = alCambiar || aviso;
    for (const lang of Object.keys(VOCES)) if (await guardada(lang)) activar(lang).catch(() => {});
  }

  // Devuelve una promesa con el audio, o null si esa voz no está lista (entonces se usa la voz del sistema)
  function preparar(texto, { ingles = false, sid = 0, lento = 1 } = {}) {
    const lang = ingles ? 'en' : 'es', limpio = texto.replace(/\([^)]*\)/g, '').trim();
    if (estado[lang] !== 'listo' || !limpio) return null;
    return pedir({ tipo: 'decir', lang, texto: limpio, sid, lento }).catch(() => null);
  }

  return { VOCES, estado, progreso, iniciar, descargar, borrar, preparar };
})();
