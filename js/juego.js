// Motor de Central 911: llamadas, mapa, despacho de unidades, minijuegos, guardado y menús.
'use strict';

// ======================= Utilidades =======================
const $ = s => document.querySelector(s);
const azar = a => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const barajar = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(v => v[1]);
const txt = v => Array.isArray(v) ? azar(v) : v;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const leer = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const escribir = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* almacenamiento lleno o bloqueado */ } };
const setHTML = (el, html) => { if (el._h !== html) { el.innerHTML = html; el._h = html; } };
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const PARAMS = new URLSearchParams(location.search);
const VEL = Math.max(1, +PARAMS.get('vel') || 1); // ?vel=20 acelera el tiempo (solo para pruebas)
const PRUEBA = PARAMS.has('prueba');              // ?prueba salta el bloqueo de tablet (solo para pruebas)

const PL = Object.fromEntries(PLANTILLAS.map(p => [p.id, p]));
const nodo = (c, r) => r * COLS + c;
const cr = n => [n % COLS, Math.floor(n / COLS)];
const lugarPorNombre = n => LUGARES.find(l => l.nombre === n);
const articulo = n => /^(Estación|Gasolinera|Fábrica|Lonja|Playa|Residencia)/.test(n) ? 'la' : /^Almacenes/.test(n) ? 'los' : 'el';
const LIBRE_N = NIVELES.length; // índice del turno libre

let S = null;                       // partida en curso (se guarda entera)
let P = leer('c911_progreso', { estrellas: [], puntos: [], libre: 0 });
Sonido.config(leer('c911_ajustes', { sonido: true, voz: true }));
let flotantes = [], ultimo = 0, acumTick = 0, acumGuardar = 0, mini = null, instalador = null;
const audios = new Map();           // voz neuronal en preparación por llamada

// ======================= Grafo de calles =======================
const ARISTAS = [];
for (let r = 0; r < FILAS; r++) for (let c = 0; c < COLS; c++) {
  if (c < COLS - 1) ARISTAS.push([nodo(c, r), nodo(c + 1, r)]);
  if (r < FILAS - 1 && (r !== 5 || PUENTES.includes(c))) ARISTAS.push([nodo(c, r), nodo(c, r + 1)]);
}
const VECINOS = Array.from({ length: COLS * FILAS }, () => []);
ARISTAS.forEach(([a, b]) => { VECINOS[a].push(b); VECINOS[b].push(a); });
const clave = (a, b) => a < b ? a + '-' + b : b + '-' + a;
const factor = (a, b) => S.cortes[clave(a, b)]?.f || 1;

// Dijkstra: con 96 nodos no hace falta cola de prioridad. Devuelve el camino y su coste.
function ruta(desde, hasta) {
  const dist = new Map([[desde, 0]]), prev = new Map(), abiertos = new Set([desde]);
  while (abiertos.size) {
    let u = null; for (const n of abiertos) if (u === null || dist.get(n) < dist.get(u)) u = n;
    abiertos.delete(u); if (u === hasta) break;
    for (const v of VECINOS[u]) {
      const d = dist.get(u) + factor(u, v);
      if (d < (dist.get(v) ?? Infinity)) { dist.set(v, d); prev.set(v, u); abiertos.add(v); }
    }
  }
  const camino = [hasta]; while (camino[0] !== desde) camino.unshift(prev.get(camino[0]));
  camino.coste = dist.get(hasta);
  return camino;
}
const VEL_BASE = 0.55;
// Segundos estimados que tardaría una unidad en llegar a un nodo
function eta(u, destino) {
  const [tx, ty] = cr(destino);
  if (u.tipo === 'H') return Math.hypot(tx - u.x, ty - u.y) / (VEL_BASE * TIPOS.H.vel);
  const desde = u.ruta.length ? u.ruta[0] : u.desde, [dx, dy] = cr(desde);
  return (ruta(desde, destino).coste + Math.hypot(dx - u.x, dy - u.y)) / (VEL_BASE * TIPOS[u.tipo].vel);
}

// ======================= Partida =======================
const N = () => S.nivel === LIBRE_N ? S.libre : NIVELES[S.nivel];
const zonaOk = n => N().zonas.includes(distritoDe(...cr(n)));
const duracion = () => N().libre ? Infinity : DURACION;
const apagonActivo = () => { const a = N().apagon; return !!a && S.t > a[0] && S.t < a[1]; };

function nuevaPartida(nivel) {
  const lvl = nivel === LIBRE_N ? { ...LIBRE } : NIVELES[nivel], unidades = [];
  lvl.unidades.forEach(([tipo, base, cant]) => {
    for (let i = 0; i < cant; i++) {
      const b = BASES[base], num = unidades.filter(u => u.tipo === tipo).length + 1;
      unidades.push({ id: `${tipo}-${num}`, tipo, base, x: b.c, y: b.r, ruta: [], desde: nodo(b.c, b.r), est: 'libre', inc: null });
    }
  });
  S = {
    nivel, t: 0, puntos: 0, sig: 1, prox: 4, gi: 0, radioProx: 200, eventoProx: 60, climaProx: 300, grandeProx: 700,
    cola: [], activa: null, inc: [], unidades, radio: [], sel: null, selU: [], tab: 'llamada', cortes: {}, usados: {}, tips: {}, flags: {},
    stats: { bien: 0, tarde: 0, grave: 0, total: 0, cortadas: 0, perdidas: 0, innecesarias: 0, bromas: 0, ocultasCortadas: 0, ayudaSum: 0, ayudaN: 0, heliBien: 0, inglesBien: 0, detenido: 0, mayorOk: 0, falsasEnviadas: 0, extra: 0 },
  };
  if (nivel === LIBRE_N) { S.libre = { ...lvl, hora: Math.floor(rnd(0, 24)) }; delete S.libre.reto; cambiarCondicion(); }
  if (lvl.guion.some(g => g.llamada && g.t < 10)) S.prox = 70;
  if (lvl.fiesta) fiesta(true);
  radio(`Turno ${nivel === LIBRE_N ? 'libre' : nivel + 1} iniciado: ${lvl.titulo}.`, 'Central');
}

function fiesta(on) {
  Object.keys(S.cortes).forEach(k => S.cortes[k].tipo === 'gente' && delete S.cortes[k]);
  if (on) ARISTAS.forEach(([a, b]) => { if (distritoDe(...cr(a)) === 'centro' && distritoDe(...cr(b)) === 'centro') S.cortes[clave(a, b)] = { f: 2.2, tipo: 'gente' }; });
}

// Modo libre: activa o desactiva una condición al azar
function cambiarCondicion() {
  const L = S.libre, k = azar(Object.keys(CONDICIONES));
  if (k === 'apagon') { if (apagonActivo()) return; L.apagon = [S.t + 2, S.t + rnd(240, 420)]; radio(CONDICIONES.apagon[0], 'Marta'); return; }
  L[k] = !L[k]; radio(CONDICIONES[k][L[k] ? 0 : 1], 'Marta');
  if (k === 'fiesta') fiesta(L.fiesta);
  if (k === 'tormenta' && !L.tormenta) Object.keys(S.cortes).forEach(c => S.cortes[c].tipo === 'agua' && delete S.cortes[c]);
}
const COND_DE_NIVEL = { 5: 'tormenta', 6: 'fiesta', 7: 'ingles', 9: 'calor', 10: 'apagon' };

// ---------- Llamadas ----------
function elegirPlantilla() {
  const n = S.nivel, lvl = N(), L = lvl.libre;
  const ok = PLANTILLAS.filter(p => !p.hist && p.id !== S.ultimaPl &&
    (L ? (!p.solo || p.solo.some(s => s === 10 ? apagonActivo() : S.libre[COND_DE_NIVEL[s]])) : p.n <= n + 1 && (!p.solo || p.solo.includes(n + 1))) &&
    (!p.lugar || p.lugar.some(l => zonaOk(nodo(lugarPorNombre(l).c, lugarPorNombre(l).r)))));
  // Menos peso a lo ya visto; más a lo nuevo del nivel; el inglés depende de si hay turistas
  const peso = p => (1 / (1 + 2 * (S.usados[p.id] || 0))) * (!L && (p.n === n + 1 || p.solo) ? 2.5 : 1) * (p.en ? (lvl.ingles ? 2.5 : L ? 0.25 : 1) : 1);
  const total = ok.reduce((s, p) => s + peso(p), 0);
  let x = Math.random() * total;
  for (const p of ok) { x -= peso(p); if (x <= 0) return p; }
  return ok[0];
}

function ubicar(p, lugarForzado) {
  const lugares = LUGARES.filter(l => zonaOk(nodo(l.c, l.r)));
  let nombre = lugarForzado || (p.lugar && azar(p.lugar.filter(l => lugares.some(x => x.nombre === l))));
  if (!nombre && p.des) nombre = azar(lugares).nombre;
  if (nombre) {
    const l = lugarPorNombre(nombre);
    return { nodo: nodo(l.c, l.r), dir: p.en ? `the ${nombre}` : `${articulo(nombre)} ${nombre}`, lugar: nombre };
  }
  const bases = Object.values(BASES).map(b => nodo(b.c, b.r));
  let n; do { n = Math.floor(Math.random() * COLS * FILAS); } while (!zonaOk(n) || bases.includes(n));
  const [c, r] = cr(n);
  const dir = p.dir === 'calle' ? `${CALLES[r]} ${p.en ? 'and' : 'con'} ${AVENIDAS[c]}`
    : p.en ? `${CALLES[r]} number ${2 + Math.floor(Math.random() * 90)}, corner of ${AVENIDAS[c]}`
      : `${CALLES[r]}, número ${2 + Math.floor(Math.random() * 90)}, esquina con ${AVENIDAS[c]}`;
  return { nodo: n, dir, lugar: null };
}

function nuevaLlamada(p, extra = {}) {
  const linea = [1, 2, 3, 4].find(l => !S.cola.some(c => c.linea === l));
  if (!linea) return false; // todas las líneas ocupadas: se reintenta luego
  const u = ubicar(p, extra.lugar);
  const vars = { ...Object.fromEntries(Object.entries(p.vars || {}).map(([k, v]) => [k, azar(v)])), ...(extra.vars || {}), dir: u.dir, lugar: u.lugar ? `${articulo(u.lugar)} ${u.lugar}` : u.dir };
  const c = {
    id: S.sig++, pl: p.id, nom: p.nombre || azar(p.en ? NOMBRES_EN : NOMBRES), vars, nodo: u.nodo, t0: S.t, est: 'sonando',
    log: [], pan: p.pan || 0, preg: {}, inc: null, desN: 0, pend: null, ayuda: false, tono: rnd(0.8, 1.35), notas: [], nPreg: 0,
    sid: Math.floor(Math.random() * (p.en ? 900 : 2)), extra: barajar(SEGUIMIENTO[p.tipo] || []).slice(0, 2).map(x => x[0]),
    linea, tel: p.en ? `+44 7${Math.floor(rnd(100, 999))} ${Math.floor(rnd(100000, 999999))}` : `6${Math.floor(rnd(10, 99))} ${Math.floor(rnd(100, 999))} ${Math.floor(rnd(100, 999))}`,
  };
  S.cola.push(c); S.usados[p.id] = (S.usados[p.id] || 0) + 1; S.ultimaPl = p.id;
  Sonido.play('timbre', linea); try { navigator.vibrate?.(150); } catch { /* sin vibración */ }
  tip('sonando', 'Suena el teléfono: toca el auricular verde de abajo para contestar.');
  return true;
}

const rellenar = (s, c) => s.replace(/\{(\w+)\}/g, (_, k) => c.vars[k] ?? '');
const plDe = c => PL[c.pl];
const esReal = p => !['falsa', 'noemerg'].includes(p.tipo);
const lang = c => plDe(c).en ? 'en' : 'es';

function atender(id) {
  if (S.activa) return;
  const c = S.cola.find(x => x.id === id); if (!c) return;
  c.est = 'activa'; S.activa = c.id; c.tA = S.t; S.tab = 'llamada'; S.panel = true;
  Sonido.play('descolgar'); Sonido.linea(true);
  c.log.push({ yo: 1, t: lang(c) === 'en' ? '911, what is your emergency?' : azar(['911, ¿cuál es su emergencia?', 'Emergencias 911, dígame.', '911, le escucho. ¿Qué ocurre?']) });
  responder(c, txt(plDe(c).ab), null, 0.6);
  tip('contesta', 'Toca las preguntas para obtener datos: qué pasa, dónde, heridos y peligro.');
  ui();
}

// Construye una respuesta de seguimiento a partir de sus piezas
function armar(partes) {
  return partes.map(x => x === '@calle' ? azar([...CALLES, ...AVENIDAS]) : Array.isArray(x) ? azar(x) : x).join(' ').replace(/\s+([.,])/g, '$1').trim();
}
const seguimiento = (p, k) => (SEGUIMIENTO[p.tipo] || []).find(x => x[0] === k);

function preguntar(q) {
  const c = activa(); if (!c || c.pend || c.fin) return;
  const p = plDe(c), L = lang(c), D = RESPUESTAS_DEFECTO[L];
  Sonido.play('tecla'); c.nPreg++;
  if (q.startsWith('x:')) { // pregunta de seguimiento
    const s = seguimiento(p, q.slice(2));
    c.log.push({ yo: 1, t: L === 'en' ? s[2] : s[1] });
    if (c.pan > 0) return responder(c, txt(D.panico), null);
    return responder(c, armar(azar(L === 'en' ? s[4] : s[3])), q);
  }
  c.log.push({ yo: 1, t: azar(PREGUNTAS[q][L]) });
  if (q === 'calma') {
    if (c.pan > 0) { c.pan--; return responder(c, txt(D.calmado), 'calma'); }
    return responder(c, txt(D.calma), null);
  }
  if (c.pan > 0) return responder(c, txt(D.panico), null);
  if (q === 'donde') {
    if (p.des && c.desN === 0) { c.desN = 1; return responder(c, txt(D.perdido), null); }
    const base = p.des ? (L === 'en' ? ['I can see {dir}... I am right next to it.'] : ['Veo {dir}... estoy justo al lado.']) : (p.donde || D.donde);
    return responder(c, txt(base), 'donde');
  }
  const r = { que: p.q, heridos: p.h, peligro: p.p, respira: p.r, sino: p.s }[q] || D[q];
  responder(c, txt(r), q);
}

function responder(c, texto, efecto, extra = 0) {
  const t = rellenar(texto, c), p = plDe(c);
  c.pend = { t, efecto, cuando: S.t + extra + 0.7 + t.length * 0.018 };
  const a = Voz.preparar(t, { ingles: !!p.en, sid: c.sid, lento: c.pan > 0 ? 0.85 : 1 });
  if (a) audios.set(c.id, a); else audios.delete(c.id);
}

// Habla el llamante: voz neuronal si está lista, si no la del sistema
function hablar(c, t) {
  const a = audios.get(c.id); audios.delete(c.id);
  const tasa = 0.93 + (c.tono - 0.8) / 0.55 * 0.14;
  if (a) a.then(r => { if (S?.activa === c.id || mini) r ? Sonido.pcm(r, tasa) : Sonido.hablar(t, { ingles: lang(c) === 'en', tono: c.tono }); });
  else Sonido.hablar(t, { ingles: lang(c) === 'en', tono: c.tono, prisa: c.pan > 0 });
}

function procesarPendiente(c) {
  if (c.fin && S.t >= c.fin) return colgar(true, true);
  if (!c.pend || S.t < c.pend.cuando) return;
  const { t, efecto } = c.pend, p = plDe(c);
  c.pend = null; c.log.push({ yo: 0, t }); c.habla = S.t + 1 + t.length * 0.05;
  hablar(c, t);
  if (efecto === 'fin') { c.fin = S.t + 2.2; return; }
  if (efecto && efecto !== 'calma') c.preg[efecto] = true;
  if (efecto?.startsWith('x:')) {
    c.notas.push(t); S.stats.extra++;
    const inc = S.inc.find(i => i.id === c.inc); if (inc) inc.bono = (inc.bono || 0) + 15; else c.bono = (c.bono || 0) + 15;
  }
  if (efecto === 'donde' && !c.inc) crearIncidente(c);
  despedirse(c, p);
}

// El llamante se despide y cuelga cuando ya no hay nada más que hacer
function despedirse(c, p) {
  if (c.pend || c.fin || S.activa !== c.id) return;
  const L = lang(c), inc = S.inc.find(i => i.id === c.inc);
  if (!esReal(p) && c.nPreg >= 4 + Math.floor(c.id % 3)) {
    return responder(c, azar(DESPEDIDAS[p.tipo === 'falsa' ? 'broma' : 'noemerg'][L]), 'fin', 0.5);
  }
  const listo = inc && inc.env.length && S.t - inc.tEnv > 5 && c.preg.que && (!p.ayuda || c.ayuda) && (p.tipo !== 'oculta' || c.preg.sino);
  if (listo) {
    c.log.push({ yo: 1, t: azar(DESPEDIDAS.operador[L]) });
    responder(c, azar(p.tipo === 'oculta' ? DESPEDIDAS.oculta[L] : DESPEDIDAS[L]), 'fin', 0.4);
  }
}

function crearIncidente(c) {
  const p = plDe(c);
  const lim = p.limite || [0, 170, 140, 110][p.grav];
  const inc = { id: c.id, llam: c.id, pl: p.id, nodo: c.nodo, nec: { ...p.nec }, lleg: {}, env: [], t0: c.t0, lim, est: 'abierto', dir: c.vars.dir, bono: c.bono || 0 };
  S.inc.push(inc); c.inc = inc.id; S.sel = inc.id; S.selU = [];
  if (esReal(p)) S.stats.total++;
  Sonido.play('alarma'); destello(); centrarEn(inc.nodo, 1.6);
  tip('pin', '¡Localizado! Pulsa «Despachar» y elige las unidades. También puedes tocarlas en el mapa.');
}

function colgar(forzar, llamante = false) {
  const c = activa(); if (!c) return;
  const p = plDe(c);
  if (esReal(p) && !c.inc && !forzar) { S.confirmar = c.id; return ui(); }
  S.confirmar = null; Sonido.callar(); Sonido.play('colgar'); Sonido.linea(false); audios.delete(c.id);
  if (llamante) {
    if (!esReal(p)) radio(p.tipo === 'falsa' ? 'El bromista ha colgado. La próxima vez, cuelga tú antes.' : 'El llamante ha colgado.', 'Central');
  } else if (!esReal(p)) {
    const bien = !!c.preg.que;
    sumar(bien ? 60 : 20, bien ? (p.tipo === 'falsa' ? 'Broma detectada' : 'No era urgente') : 'Colgada', c.nodo);
    S.stats.bromas++;
  } else if (!c.inc) {
    S.stats.cortadas++;
    if (p.tipo === 'oculta' || p.id === 'lucas3') {
      S.stats.ocultasCortadas++; sumar(-150, 'Era una víctima real', null);
      radio(p.id === 'lucas3' ? '¡Lo de Lucas era verdad esta vez! Mandamos la llamada a otra central. Nunca cuelgues sin preguntar.' : 'Esa persona pedía ayuda disimulando. Usa la pregunta de sí o no.', 'Marta');
    } else { sumar(-80, 'Llamada real perdida', null); radio('Has colgado una emergencia real sin localizarla. Otra central la ha recogido.', 'Marta'); }
  }
  if (!esReal(p)) { const inc = S.inc.find(i => i.id === c.inc); if (inc && !inc.env.length) S.inc = S.inc.filter(i => i !== inc); }
  S.cola = S.cola.filter(x => x.id !== c.id); S.activa = null;
  if (S.sel && !S.inc.some(i => i.id === S.sel)) S.sel = null;
  S.tab = 'despacho';
  ui();
}

const activa = () => S && S.cola.find(c => c.id === S.activa);

// ---------- Despacho ----------
const disponible = u => u.est === 'libre' || u.est === 'vuelta';

function toggleUnidad(id) {
  const u = S.unidades.find(x => x.id === id), inc = S.inc.find(i => i.id === S.sel);
  if (!u) return;
  if (!inc) return radio('Selecciona primero un aviso en el mapa.', 'Central');
  if (!disponible(u)) return radio(`${u.id} está ocupada.`, 'Central');
  S.selU = S.selU.includes(id) ? S.selU.filter(x => x !== id) : [...S.selU, id];
  Sonido.play('tecla'); ui();
}

function enviar() {
  const inc = S.inc.find(i => i.id === S.sel);
  if (!inc || !S.selU.length || inc.est === 'cerrado') return;
  S.selU.forEach(id => {
    const u = S.unidades.find(x => x.id === id);
    if (!u || !disponible(u)) return;
    u.inc = inc.id; u.est = 'ruta'; inc.env.push(u.id); planificar(u, inc.nodo);
  });
  inc.tEnv = S.t;
  S.selU = []; Sonido.play('sirena'); Sonido.play('radio');
  tip('envio', 'Unidades en camino. Cuando el llamante tenga la ayuda en camino, se despedirá y colgará.');
  S.tab = activa() ? 'llamada' : 'lugar';
  ui();
}

function retirar(id) {
  const u = S.unidades.find(x => x.id === id), inc = S.inc.find(i => i.id === u?.inc);
  if (!u || !inc) return;
  if (u.est === 'escena') { inc.lleg[u.tipo]--; if (inc.est === 'trabajo') inc.est = 'abierto'; }
  inc.env = inc.env.filter(x => x !== u.id);
  radio(`Recibido, nos retiramos.`, u.id); volver(u); ui();
}

function planificar(u, destino) {
  u.dest = destino;
  if (u.tipo === 'H') { u.ruta = [destino]; return; }
  const sig = u.ruta.length ? u.ruta[0] : u.desde; // termina el tramo actual antes de girar
  const camino = ruta(sig, destino);
  u.ruta = u.ruta.length ? camino : camino.slice(1);
  if (!u.ruta.length) llegada(u); // ya estaba en el destino
}

function moverUnidades(dt) {
  for (const u of S.unidades) {
    if (!u.ruta.length) continue;
    const [tx, ty] = cr(u.ruta[0]), dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    const f = u.tipo === 'H' ? 1 : factor(u.desde, u.ruta[0]);
    const paso = VEL_BASE * TIPOS[u.tipo].vel / f * dt;
    if (d <= paso) {
      u.x = tx; u.y = ty; u.desde = u.ruta.shift();
      if (!u.ruta.length) llegada(u);
    } else { u.x += dx / d * paso; u.y += dy / d * paso; }
  }
}

function volver(u) {
  const b = BASES[u.base]; u.inc = null; u.est = 'vuelta'; planificar(u, nodo(b.c, b.r));
}

function llegada(u) {
  if (u.est === 'vuelta') { u.est = 'libre'; return; }
  const inc = S.inc.find(i => i.id === u.inc);
  if (!inc || inc.est === 'cerrado') return volver(u);
  const p = PL[inc.pl];
  if (!esReal(p)) {
    S.stats.falsasEnviadas++; sumar(-40, 'Falsa alarma', inc.nodo); Sonido.play('mal');
    radio(`Aquí no hay ninguna emergencia. Era una broma.`, u.id);
    return cerrarIncidente(inc, null);
  }
  if ((inc.lleg[u.tipo] || 0) >= (inc.nec[u.tipo] || 0)) {
    S.stats.innecesarias++; sumar(-15, `${u.id} innecesaria`, inc.nodo); Sonido.play('mal');
    radio(`No hacemos falta aquí, regresamos.`, u.id);
    inc.env = inc.env.filter(x => x !== u.id); return volver(u);
  }
  inc.lleg[u.tipo] = (inc.lleg[u.tipo] || 0) + 1; u.est = 'escena';
  radio(`En el lugar. ${completo(inc) ? 'Trabajando.' : 'Esperamos refuerzos.'}`, u.id);
  if (completo(inc) && inc.est === 'abierto') {
    inc.est = 'trabajo'; inc.tc ??= S.t; inc.fin = S.t + (p.trabajo || 6 + 4 * p.grav);
  }
}
const completo = inc => Object.entries(inc.nec).every(([t, n]) => (inc.lleg[t] || 0) >= n);

function cerrarIncidente(inc, res) {
  inc.est = 'cerrado';
  S.unidades.filter(u => u.inc === inc.id).forEach(volver);
  S.inc = S.inc.filter(i => i !== inc);
  if (S.sel === inc.id) S.sel = null;
  if (!res) return;
  const p = PL[inc.pl], g = p.grav;
  S.stats[res]++;
  if (res === 'bien') {
    const rapidez = Math.max(0, Math.round((1 - (inc.tc - inc.t0) / inc.lim) * 100));
    sumar(100 * g + rapidez + (inc.bono || 0), 'Resuelto', inc.nodo); Sonido.play('ok');
    if (p.nec.H) S.stats.heliBien++;
    if (p.en) S.stats.inglesBien++;
  } else if (res === 'tarde') { sumar(40 * g, 'Resuelto tarde', inc.nodo); Sonido.play('radio'); }
  else { sumar(10, 'Resultado grave', inc.nodo); Sonido.play('mal'); radio(`El aviso de ${p.et.toLowerCase()} ha terminado con consecuencias graves. Hay que llegar antes.`, 'Marta'); }
  if (p.mayor && res !== 'grave') { S.stats.mayorOk++; radio('¡Incendio forestal controlado! Los vecinos de la sierra os aplauden.', 'Marta'); }
  tip('resuelto', 'Emergencia resuelta. Cuanto antes llegues, más puntos.');
}

function actualizarIncidentes() {
  for (const inc of [...S.inc]) {
    const p = PL[inc.pl];
    if (inc.est === 'trabajo' && S.t >= inc.fin) {
      const dur = inc.tc - inc.t0;
      cerrarIncidente(inc, dur <= inc.lim ? 'bien' : dur <= inc.lim * 2 ? 'tarde' : 'grave');
    } else if (inc.est === 'abierto' && S.t - inc.t0 > inc.lim * 3 && esReal(p)) {
      radio(`Otra central se ha hecho cargo del aviso de ${p.et.toLowerCase()}. Demasiado tarde.`, 'Marta');
      cerrarIncidente(inc, 'grave');
    } else if (inc.est === 'abierto' && !inc.avisado && S.t - inc.t0 > inc.lim && esReal(p)) {
      inc.avisado = 1; radio(`El aviso de ${p.et.toLowerCase()} lleva mucho esperando.`, 'Marta');
    }
  }
}

// ---------- Puntos, radio y consejos ----------
function sumar(n, texto, nodoTxt) {
  S.puntos += n;
  const [x, y] = nodoTxt != null ? cr(nodoTxt) : [COLS / 2, FILAS / 2];
  flotantes.push({ x, y, t: 0, txt: `${n > 0 ? '+' : ''}${n} ${texto}`, mal: n < 0 });
}
function radio(t, quien = 'Marta') {
  S.radio.push({ t, quien, h: hora(), n: (S.radioN = (S.radioN || 0) + 1) }); if (S.radio.length > 30) S.radio.shift();
  Sonido.play('radio');
}
function tip(clave, t) { if (S.nivel === 0 && !S.tips[clave]) { S.tips[clave] = 1; radio(t, 'Marta'); } }

const CHARLA = ['P-1: tráfico denso en la Calle Mayor.', 'Central, aquí A-2: repostando, seguimos operativos.', 'B-1: revisión de material terminada.',
  'Aviso: obras en Av. Goya, circulen con precaución.', 'P-2: control rutinario sin novedad.', 'Hospital: urgencias con espera moderada.',
  'Meteorología: viento racheado esta tarde.', 'Central: recordad registrar todos los avisos.', 'A-1: paciente entregado, volvemos a base.',
  'P-3: un vecino nos invita a café. Rechazamos con educación.', 'B-2: el gato de la Calle Luna vuelve a estar en el tejado. No es aviso.',
  'Hospital: se necesitan donantes de sangre 0 negativo.', 'Central: cambio de turno en la sala de al lado.', 'H-1: comprobación de motores correcta.'];

// ---------- Guion y eventos de nivel ----------
function procesarGuion() {
  const g = N().guion.filter(x => x.t <= S.t).sort((a, b) => a.t - b.t);
  while (S.gi < g.length) {
    const e = g[S.gi];
    if (e.llamada && !nuevaLlamada(PL[e.llamada], e)) break;
    S.gi++;
    if (e.radio) radio(e.radio, 'Marta');
    if (e.deduccion) abrirDeduccion();
    if (e.desenlace) {
      if (S.flags.faro) { S.stats.detenido = 1; sumar(500, 'Incendiario detenido', nodo(10, 6)); Sonido.play('ok'); radio('¡Detenido en el Faro! Gorra roja, bidón de gasolina y espray. Gran deducción.', 'Marta'); }
      else { radio('Se nos ha escapado... ¡fuego en el Faro! La letra que faltaba.', 'Marta'); nuevaLlamada(PL.provocado, { lugar: 'Faro', vars: { letra: '¡la última!' } }); }
    }
  }
}

function eventos() {
  const lvl = N();
  if (S.t >= S.eventoProx) {
    S.eventoProx = S.t + (lvl.tormenta ? 300 : 240);
    if (lvl.tormenta) inundar();
    if (S.nivel >= 6) atasco();
  }
  if (lvl.libre) {
    if (S.t >= S.climaProx) { S.climaProx = S.t + rnd(420, 700); cambiarCondicion(); }
    if (S.t >= S.grandeProx) {
      const ok = GRANDES.filter(id => (id !== 'autobus_paso' || lvl.tormenta) && (id !== 'fuegos_final' || lvl.fiesta) && (id !== 'en_familia' || lvl.ingles));
      if (nuevaLlamada(PL[azar(ok)])) { S.grandeProx = S.t + rnd(800, 1300); radio('Atención: se está gestando una gran emergencia.', 'Marta'); }
    }
  }
  if (S.t >= (S.salaProx || 0)) { S.salaProx = S.t + rnd(14, 32); Sonido.play(azar(['lejano', 'teclado', 'teclado'])); }
  if (S.t >= S.radioProx) { S.radioProx = S.t + rnd(150, 260); radio(azar(CHARLA), 'Radio'); }
}
function cortarAleatorias(tipo, n, f) {
  Object.keys(S.cortes).forEach(k => S.cortes[k].tipo === tipo && delete S.cortes[k]);
  const ok = barajar(ARISTAS.filter(([a, b]) => zonaOk(a) && zonaOk(b) && !S.cortes[clave(a, b)])).slice(0, n);
  ok.forEach(([a, b]) => { S.cortes[clave(a, b)] = { f, tipo }; });
  return ok;
}
const nombreArista = ([a, b]) => { const [c1, r1] = cr(a), [c2] = cr(b); return c1 === c2 ? AVENIDAS[c1] : CALLES[r1]; };
function inundar() { radio(`Calles inundadas, entre ellas ${nombreArista(cortarAleatorias('agua', 6, 4)[0])}. Las unidades irán más lentas por las zonas en azul.`, 'Marta'); }
function atasco() { radio(`Atasco en ${nombreArista(cortarAleatorias('atasco', 3, 3)[0])} (en naranja).`, 'Radio'); }

// ======================= Bucle principal =======================
function bucle(ahora) {
  const dt = Math.min(0.1, (ahora - ultimo) / 1000 || 0) * VEL; ultimo = ahora;
  if (S && !S.pausado && !mini) {
    S.t += dt;
    [...S.cola].forEach(procesarPendiente);
    if (S.t >= S.prox && S.t < duracion() - 90) {
      if (S.cola.filter(c => c.est === 'sonando').length < 3 && S.cola.length < 4) nuevaLlamada(elegirPlantilla());
      S.prox = S.t + rnd(...N().cada);
    }
    for (const c of [...S.cola]) if (c.est === 'sonando' && S.t - c.t0 > 55) {
      S.cola = S.cola.filter(x => x !== c);
      if (esReal(plDe(c))) { S.stats.perdidas++; sumar(-50, 'Llamada sin contestar', null); radio('Una llamada ha colgado tras esperar demasiado.', 'Marta'); }
    }
    const c = activa(); if (c) despedirse(c, plDe(c));
    procesarGuion(); eventos(); moverUnidades(dt); actualizarIncidentes();
    acumTick += dt / VEL; acumGuardar += dt / VEL;
    if (acumTick > 0.25) { acumTick = 0; ui(); }
    if (acumGuardar > 5) { acumGuardar = 0; guardar(); }
    if (S.t >= duracion()) finTurno();
  }
  if (S) dibujarMapa(dt / VEL);
  if (mini?.frame) mini.frame(ahora);
  requestAnimationFrame(bucle);
}

const hora = () => {
  const m = Math.floor((N().hora * 60 + S.t / DURACION * 480)) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// ======================= Interfaz =======================
const COLOR_SERV = { P: '#4c8dff', A: '#f4f7fb', B: '#ff4d4d', H: '#ffb547' };
const ESCENA = {
  policia: 'Los agentes aseguran la zona y toman declaración.', medico: 'Los sanitarios atienden al paciente.', fuego: 'Los bomberos trabajan para controlar la situación.',
  trafico: 'Se atiende a los heridos y se despeja la calzada.', rescate: 'El equipo de rescate trabaja para sacar a las víctimas.', mixto: 'Varios servicios trabajan juntos en la escena.',
  oculta: 'La policía entra con cuidado y protege a la víctima.',
};

function ui() {
  if (!S) return;
  const lvl = N();
  $('#hud-num').textContent = lvl.libre ? 'Turno libre' : `Turno ${S.nivel + 1}`;
  $('#hud-titulo').textContent = lvl.libre ? `${Math.floor(S.t / 60)} min de servicio` : lvl.titulo;
  $('#hud-reloj').textContent = hora();
  $('#hud-barra').style.width = lvl.libre ? '100%' : `${Math.min(100, S.t / DURACION * 100)}%`;
  $('#hud-puntos').textContent = `${S.puntos} pts`;
  $('#btn-sonido').textContent = Sonido.opciones.sonido ? '🔊' : '🔇';
  const h = (lvl.hora + S.t / DURACION * 8) % 24, dia = Math.max(0, Math.cos((h - 13) / 24 * 2 * Math.PI));
  $('#juego').style.setProperty('--dia', dia.toFixed(2));
  pintarDock(); pintarPanel(); pintarRadio(); pintarAvisos();
}

// Muelle inferior: llamadas entrantes y llamada en curso
function pintarDock() {
  const c = activa();
  const sonando = S.cola.filter(x => x.est === 'sonando');
  setHTML($('#dock'), (c ? `<button class="en-curso" data-a="tab" data-t="llamada"><i class="piloto"></i><span><b>En llamada</b><small class="dur-dock"></small></span></button>` : '') +
    sonando.map(x => `<button class="entrante ${c ? 'retenida' : ''}" data-a="atender" data-id="${x.id}">
      <span class="aro"></span><span class="auri">🎧</span><small>${x.tel}</small></button>`).join('') +
    (!c && !sonando.length ? '<div class="dock-vacio">Sin llamadas</div>' : ''));
  document.querySelectorAll('#dock .entrante').forEach(b => {
    const x = S.cola.find(y => y.id === +b.dataset.id);
    if (x) b.style.setProperty('--p', Math.min(1, (S.t - x.t0) / 55).toFixed(3));
  });
  const d = $('.dur-dock'); if (d && c) d.textContent = mmss(S.t - c.tA);
}

function pintarAvisos() {
  $('#n-avisos').textContent = S.inc.length;
  $('#btn-avisos').classList.toggle('hay', S.inc.some(i => i.est === 'abierto' && !i.env.length));
  if ($('#lista-avisos').hidden) return;
  setHTML($('#lista-avisos'), S.inc.length ? S.inc.map(i => {
    const p = PL[i.pl], c = S.cola.find(x => x.inc === i.id), conocido = !c || c.preg.que;
    const fondo = conocido ? Object.keys(i.nec).map(t => COLOR_SERV[t]) : ['#64748b'];
    return `<button class="aviso-fila ${i.id === S.sel ? 'sel' : ''}" data-a="sel-inc" data-id="${i.id}">
      <span class="aviso-ic" style="background:linear-gradient(135deg,${fondo.join(',')}${fondo.length < 2 ? ',' + fondo[0] : ''})">${conocido ? p.ic : '❓'}</span>
      <span><b>#${i.id} ${esc(conocido ? p.et : 'Aviso sin clasificar')}</b><small>${esc(i.dir)}</small></span><span class="aviso-t">${mmss(S.t - i.t0)}</span></button>`;
  }).join('') : '<p class="nota">No hay avisos abiertos.</p>');
}

function pintarRadio() {
  setHTML($('#radio'), S.radio.slice(-3).map(r => `<div class="radio-l" data-n="${r.n}"><span>${r.h}</span><b>${esc(r.quien)}:</b> ${esc(r.t)}</div>`).join(''));
}

// Panel derecho con pestañas: Llamada, Despacho y En el lugar
function pintarPanel() {
  const c = activa(), inc = S.inc.find(i => i.id === S.sel);
  const tabs = [c && ['llamada', '📞 Llamada'], inc && ['despacho', '🚨 Despacho'], inc && inc.env.length && ['lugar', '📍 En el lugar']].filter(Boolean);
  const abierto = tabs.length && S.panel;
  $('#juego').classList.toggle('con-panel', !!abierto);
  if (!abierto) { $('#panel').hidden = true; return; }
  if (!tabs.some(t => t[0] === S.tab)) S.tab = tabs[0][0];
  $('#panel').hidden = false;
  setHTML($('#panel-tabs'), tabs.map(([k, n]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-a="tab" data-t="${k}">${n}</button>`).join('') +
    (c ? '' : '<button class="tab cerrar" data-a="cerrar-panel" aria-label="Cerrar">✕</button>'));
  const cuerpo = $('#panel-cuerpo');
  if (S.tab === 'llamada') pintarLlamada(cuerpo, c);
  else if (S.tab === 'despacho') pintarDespacho(cuerpo, inc);
  else pintarLugar(cuerpo, inc);
}

function pintarLlamada(el, c) {
  const p = plDe(c), L = lang(c);
  const nervios = c.pan > 0 ? `<span class="chip rojo">Muy nervioso: cálmale</span>` : `<span class="chip verde">Colabora</span>`;
  const log = c.log.map(l => `<div class="linea ${l.yo ? 'yo' : 'el'}">${esc(l.t)}</div>`).join('') + (c.pend ? '<div class="linea el escribiendo"><i></i><i></i><i></i></div>' : '');
  const etq = c.preg.sino && p.et2 ? p.et2 : p.et;
  const dato = (k, v) => c.preg[k] ? `<b>${esc(rellenar(v, c))}</b>` : '<span class="falta">—</span>';
  const completa = c.preg.que && c.preg.heridos && c.preg.peligro && (p.tipo !== 'oculta' || c.preg.sino) || (S.nivel < 2 && c.preg.que);
  let rec = '';
  if (completa) {
    rec = p.rec ? p.rec : p.tipo === 'falsa' ? '⚠️ Datos poco creíbles: ¿es una broma?'
      : 'Recomendado: ' + Object.entries(p.nec).map(([t, n]) => `${TIPOS[t].ic}×${n}`).join(' ');
  }
  // Las preguntas ya hechas desaparecen (salvo calmar); las de seguimiento aparecen tras saber qué pasa
  const base = ['que', 'donde', 'heridos', 'peligro', 'respira', 'calma', ...(S.nivel >= 3 ? ['sino'] : [])].filter(q => q === 'calma' || !c.preg[q]);
  const extra = c.preg.que ? c.extra.filter(k => !c.preg['x:' + k]).map(k => { const s = seguimiento(p, k); return [`x:${k}`, L === 'en' ? s[2] : s[1]]; }) : [];
  const ops = [...base.map(q => [q, PREGUNTAS[q][L][0]]), ...extra];
  const puedeAyudar = p.ayuda && c.preg.que && !c.ayuda && c.pan === 0;
  const conf = S.confirmar === c.id;
  const inc = S.inc.find(i => i.id === c.inc);
  setHTML(el, `
    <div class="llam-cab">
      <div class="ani"><b>${esc(c.nom)}</b><small>${c.tel}, línea ${c.linea}${p.en ? ', inglés' : ''}</small></div>
      <div class="onda" aria-hidden="true">${'<i></i>'.repeat(9)}</div>
      <div class="llam-der"><span class="duracion"></span>${nervios}</div>
    </div>
    <div class="transcripcion" id="trans">${log}</div>
    <div class="ficha">
      <div><span>Qué pasa</span>${c.preg.que ? `<b>${p.ic} ${esc(etq)}</b>` : '<span class="falta">—</span>'}</div>
      <div><span>Lugar</span>${c.preg.donde ? `<b>📍 ${esc(c.vars.dir)}</b>` : '<span class="falta">—</span>'}</div>
      <div><span>Heridos</span>${dato('heridos', p.fh || 'Ninguno')}</div>
      <div><span>Peligro</span>${dato('peligro', p.fp || 'Ninguno')}</div>
      ${c.notas.length ? `<div class="notas"><span>Notas</span>${c.notas.map(n => `<b>${esc(n)}</b>`).join('')}</div>` : ''}
      ${rec ? `<div class="rec">${esc(rec)}</div>` : ''}
    </div>
    <div class="opciones ${c.pend || c.fin ? 'esperando' : ''}">
      ${ops.map(([q, t]) => `<button class="op ${q === 'calma' && c.pan > 0 ? 'urge' : ''} ${q.startsWith('x:') ? 'extra' : ''}" data-a="preguntar" data-q="${q}">${esc(t)}</button>`).join('')}
    </div>
    <div class="acciones">
      ${puedeAyudar ? `<button class="btn ayuda" data-a="ayuda">🩺 ${esc(p.ayuda === 'rcp' ? 'Guiar RCP' : PROTOCOLOS[p.ayuda][0])}</button>` : ''}
      ${inc && !inc.env.length ? '<button class="btn despachar" data-a="tab" data-t="despacho">🚨 Despachar</button>' : ''}
      <button class="btn colgar ${conf ? 'confirma' : ''}" data-a="${conf ? 'colgar-ya' : 'colgar'}">${conf ? '¿Colgar sin localizar? Toca otra vez' : '☎️ Colgar'}</button>
    </div>`);
  el.querySelector('.duracion').textContent = mmss(S.t - (c.tA ?? S.t));
  el.querySelector('.onda').classList.toggle('habla', !!(c.pend || S.t < (c.habla || 0)));
  const t = $('#trans'); if (t && t._n !== c.log.length + !!c.pend) { t._n = c.log.length + !!c.pend; t.scrollTop = t.scrollHeight; }
}

function cabeceraInc(inc) {
  const p = PL[inc.pl], c = S.cola.find(x => x.inc === inc.id), conocido = !c || c.preg.que;
  const resto = Math.max(0, inc.lim - (S.t - inc.t0));
  const estado = inc.est === 'trabajo' ? `<span class="chip verde">Trabajando</span>` : `<span class="chip ${resto ? 'ambar' : 'rojo'}">⏱ ${resto ? Math.ceil(resto) + ' s' : 'Retrasado'}</span>`;
  const serv = conocido ? Object.keys(inc.nec).map(t => `<i style="background:${COLOR_SERV[t]}"></i>`).join('') : '<i style="background:#64748b"></i>';
  return `<div class="inc-cab"><div class="inc-serv">${serv}</div><div><b>#${inc.id} ${conocido ? p.ic + ' ' + esc(c?.preg.sino && p.et2 ? p.et2 : p.et) : '❓ Aviso sin clasificar'}</b>
    <small>📍 ${esc(inc.dir)}</small></div>${estado}</div>`;
}

function pintarDespacho(el, inc) {
  const n = S.selU.length;
  const grupos = Object.keys(TIPOS).filter(t => S.unidades.some(u => u.tipo === t)).map(t => {
    const lista = S.unidades.filter(u => u.tipo === t).map(u => ({ u, e: disponible(u) ? eta(u, inc.nodo) : Infinity })).sort((a, b) => a.e - b.e);
    const necesita = inc.nec[t] ? `${inc.lleg[t] || 0}/${inc.nec[t]}` : '';
    return `<div class="grupo"><div class="grupo-cab" style="--c:${COLOR_SERV[t]}">${TIPOS[t].ic} ${TIPOS[t].nombre}${necesita && inc.env.length ? ` <small>${necesita} en el lugar</small>` : ''}</div><div class="grupo-u">${
      lista.map(({ u, e }) => {
        const est = { libre: 'Libre', vuelta: 'Volviendo', ruta: 'En ruta', escena: 'Ocupada' }[u.est];
        return `<button class="unidad ${u.est} ${S.selU.includes(u.id) ? 'sel' : ''}" data-a="unidad" data-id="${u.id}" ${disponible(u) ? '' : 'disabled'}>
          <b>${u.id}</b><small>${disponible(u) ? `≈ ${Math.round(e)} s` : est}</small></button>`;
      }).join('')}</div></div>`;
  }).join('');
  setHTML(el, `${cabeceraInc(inc)}<p class="nota">Elige unidades aquí o tocándolas en el mapa. Junto a cada una, lo que tardaría en llegar.</p>
    <div class="grupos">${grupos}</div>
    <button class="btn enviar" data-a="enviar" ${n ? '' : 'disabled'}>🚨 Enviar${n ? ` ${n} unidad${n > 1 ? 'es' : ''}` : ''}</button>`);
}

function pintarLugar(el, inc) {
  const p = PL[inc.pl], dur = p.trabajo || 6 + 4 * p.grav;
  const prog = inc.est === 'trabajo' ? Math.min(1, 1 - (inc.fin - S.t) / dur) : 0;
  const enviadas = {}; inc.env.forEach(id => { const t = id[0]; enviadas[t] = (enviadas[t] || 0) + 1; });
  const faltan = Object.entries(inc.nec).map(([t, k]) => [t, k - (enviadas[t] || 0)]).filter(([, k]) => k > 0);
  const filas = inc.env.map(id => {
    const u = S.unidades.find(x => x.id === id);
    const est = u.est === 'escena' ? 'En el lugar' : `En ruta, ≈ ${Math.round(eta(u, inc.nodo))} s`;
    return `<div class="lugar-u"><span class="u-ic" style="--c:${COLOR_SERV[u.tipo]}">${TIPOS[u.tipo].ic}</span><b>${u.id}</b><small>${est}</small>
      <button class="btn mini-btn" data-a="retirar" data-id="${u.id}">Retirar</button></div>`;
  }).join('');
  const texto = inc.est === 'trabajo' ? ESCENA[p.tipo] || ESCENA.mixto : faltan.length ? 'Faltan unidades: ' + faltan.map(([t, k]) => `${TIPOS[t].ic}×${k}`).join(' ') : 'Las unidades van de camino.';
  setHTML(el, `${cabeceraInc(inc)}
    <div class="escena"><p>${esc(texto)}</p><div class="progreso"><i style="width:${Math.round(prog * 100)}%"></i></div></div>
    <div class="lugar-lista">${filas}</div>
    ${faltan.length ? '<button class="btn" data-a="tab" data-t="despacho">➕ Enviar refuerzos</button>' : ''}`);
}

// ======================= Mapa con cámara (zoom y arrastre) =======================
const cv = $('#mapa'), cx = cv.getContext('2d');
let M = { w: 0, h: 0, celda: 40, ox: 0, oy: 0, cX: 40, cY: 40, fondo: null, clave: '' };
const cam = { z: 1, x: 0, y: 0 };
const ZMAX = 3.5;
const base = (c, r) => [M.ox + c * M.cX, M.oy + r * M.cY];
const px = (c, r) => { const [x, y] = base(c, r); return [x * cam.z + cam.x, y * cam.z + cam.y]; };

function ajustarMapa() {
  const dpr = Math.min(2, devicePixelRatio || 1), w = innerWidth, h = innerHeight;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  M.w = w; M.h = h; M.dpr = dpr;
  // Encaja el plano entre la barra superior y el muelle de llamadas
  const arriba = 80, abajo = 110, lados = 40;
  M.cX = (w - lados * 2) / (COLS - 1); M.cY = (h - arriba - abajo) / (FILAS - 1);
  M.cX = Math.min(M.cX, M.cY * 1.45); M.cY = Math.min(M.cY, M.cX * 1.3);
  M.celda = Math.min(M.cX, M.cY);
  M.ox = (w - M.cX * (COLS - 1)) / 2; M.oy = arriba + (h - arriba - abajo - M.cY * (FILAS - 1)) / 2;
  limitarCam();
}

function limitarCam() {
  cam.z = Math.max(1, Math.min(ZMAX, cam.z));
  const [x0, y0] = base(-0.5, -0.5), [x1, y1] = base(COLS - 0.5, FILAS - 0.5);
  const minX = M.w * 0.5 - x1 * cam.z, maxX = M.w * 0.5 - x0 * cam.z, minY = M.h * 0.5 - y1 * cam.z, maxY = M.h * 0.5 - y0 * cam.z;
  if (cam.z === 1) { cam.x = 0; cam.y = 0; } else { cam.x = Math.max(minX, Math.min(maxX, cam.x)); cam.y = Math.max(minY, Math.min(maxY, cam.y)); }
}
function zoomEn(f, sx, sy) {
  const z0 = cam.z; cam.z = Math.max(1, Math.min(ZMAX, cam.z * f)); cam.objetivo = null;
  cam.x = sx - (sx - cam.x) * cam.z / z0; cam.y = sy - (sy - cam.y) * cam.z / z0; limitarCam();
}
// Lleva la cámara a un punto; con el panel abierto lo centra en la parte visible del mapa
function centrarEn(n, zMin = 1) {
  const z0 = cam.z;
  if (cam.z < zMin) { cam.z = zMin; cam.x = M.w / 2 - (M.w / 2 - cam.x) * cam.z / z0; cam.y = M.h / 2 - (M.h / 2 - cam.y) * cam.z / z0; limitarCam(); }
  const [bx, by] = base(...cr(n)), visible = S?.panel ? M.w * 0.58 : M.w;
  cam.objetivo = { x: visible / 2 - bx * cam.z, y: M.h / 2 - by * cam.z };
}

function pintarFondo() {
  const f = M.fondo || document.createElement('canvas'); f.width = M.w * M.dpr; f.height = M.h * M.dpr;
  const g = f.getContext('2d'); g.setTransform(M.dpr, 0, 0, M.dpr, 0, 0);
  const z = cam.z, C = M.celda * z, cX = M.cX * z, cY = M.cY * z, calle = C * 0.2;
  g.fillStyle = '#070c16'; g.fillRect(0, 0, M.w, M.h);
  for (let r = 0; r < FILAS - 1; r++) for (let c = 0; c < COLS - 1; c++) {
    if (r === 5) continue; // franja del río
    const [x, y] = px(c, r);
    if (x > M.w || y > M.h || x + cX < 0 || y + cY < 0) continue;
    const zn = distritoDe(c + (c >= 9 ? 1 : 0), r + (r >= 5 ? 1 : 0)), abierto = N().zonas.includes(zn);
    const bw = cX - calle, bh = cY - calle;
    g.fillStyle = abierto ? DISTRITOS[zn].color : '#0a0f19';
    redondo(g, x + calle / 2, y + calle / 2, bw, bh, C * 0.08); g.fill();
    if (abierto) {
      g.fillStyle = 'rgba(255,255,255,0.04)';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if ((c * 7 + r * 3 + i + j) % 3) g.fillRect(x + calle / 2 + 4 + i * (bw - 8) / 3, y + calle / 2 + 4 + j * (bh - 8) / 3, (bw - 8) / 3 - 3, (bh - 8) / 3 - 3);
    } else {
      g.save(); g.beginPath(); g.rect(x + calle / 2, y + calle / 2, bw, bh); g.clip(); g.strokeStyle = 'rgba(255,255,255,0.04)'; g.lineWidth = 1;
      for (let k = -bh; k < bw; k += 7) { g.beginPath(); g.moveTo(x + calle / 2 + k, y + calle / 2); g.lineTo(x + calle / 2 + k + bh, y + calle / 2 + bh); g.stroke(); }
      g.restore();
    }
  }
  const [, ry] = px(0, 5), [rx0] = px(-1, 5), [rx1] = px(COLS, 5);
  const grad = g.createLinearGradient(0, ry, 0, ry + cY); grad.addColorStop(0, '#0d2a4a'); grad.addColorStop(0.5, '#123a63'); grad.addColorStop(1, '#0d2a4a');
  g.fillStyle = grad; g.fillRect(rx0, ry + calle / 2, rx1 - rx0, cY - calle);
  g.lineCap = 'round';
  for (const [a, b] of ARISTAS) {
    const [x1, y1] = px(...cr(a)), [x2, y2] = px(...cr(b));
    g.strokeStyle = '#273246'; g.lineWidth = calle; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = 'rgba(255,214,120,0.09)'; g.lineWidth = 1; g.setLineDash([4, 6]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
  }
  // Nombres de calles: con zoom se repiten a lo largo de la calle para encontrarlas fácilmente
  g.fillStyle = 'rgba(190,205,230,0.5)'; g.font = `500 ${Math.max(10, Math.min(15, C * 0.12))}px Barlow, system-ui`; g.textBaseline = 'middle'; g.textAlign = 'center';
  const paso = z > 1.8 ? 3 : 6;
  CALLES.forEach((n, r) => { for (let c = 0.5; c < COLS - 1; c += paso) { const [x, y] = px(c + (r % 2) * 1.5, r); g.fillText(n, x, y - calle * 0.9); } });
  AVENIDAS.forEach((n, c) => { for (let r = 0.5; r < FILAS - 1; r += paso / 1.5) { const [x, y] = px(c, r + (c % 2 ? 1 : 0)); g.save(); g.translate(x + calle * 0.9, y); g.rotate(-Math.PI / 2); g.fillText(n, 0, 0); g.restore(); } });
  g.font = `700 ${C * 0.42}px 'Barlow Condensed', system-ui`; g.fillStyle = 'rgba(255,255,255,0.05)';
  [['centro', 5.5, 3.5], ['norte', 5.5, 0.5], ['poligono', 10.5, 2.5], ['puerto', 6, 6.5], ['bosque', 0.5, 3]].forEach(([zn, c, r]) => {
    const [x, y] = px(c, r);
    if (N().zonas.includes(zn)) g.fillText(DISTRITOS[zn].nombre, x, y);
    else { g.save(); g.font = `600 ${C * 0.2}px 'Barlow Condensed', system-ui`; g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillText('🔒 ' + DISTRITOS[zn].nombre, x, y); g.restore(); }
  });
  const v = g.createRadialGradient(M.w / 2, M.h / 2, Math.min(M.w, M.h) * 0.4, M.w / 2, M.h / 2, Math.max(M.w, M.h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)'); g.fillStyle = v; g.fillRect(0, 0, M.w, M.h);
  M.fondo = f;
}

function redondo(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

// Marcador de aviso: gota con anillo de colores según los servicios que necesita
function dibujarPin(x, y, K, colores, ic, estado, frac, sel, ahora) {
  const r = K * 0.34;
  if (sel) y -= Math.abs(Math.sin(ahora * 4)) * 3;
  const cyy = y - r * 1.45;
  cx.fillStyle = 'rgba(0,0,0,0.4)'; cx.beginPath(); cx.ellipse(x, y + 2, r * 0.55, r * 0.2, 0, 0, 7); cx.fill();
  const halo = estado === 'tarde' ? '#ff4d4d' : estado === 'trabajo' ? '#5be3a3' : '#ffb547';
  if (estado === 'tarde' || sel) { const pul = (ahora * 1.5) % 1; cx.strokeStyle = sel ? '#fff' : halo; cx.globalAlpha = 1 - pul; cx.lineWidth = 3; cx.beginPath(); cx.arc(x, cyy, r * (1.2 + pul * 0.8), 0, 7); cx.stroke(); cx.globalAlpha = 1; }
  cx.fillStyle = '#0e1729'; cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x - r * 0.62, cyy + r * 0.75); cx.lineTo(x + r * 0.62, cyy + r * 0.75); cx.closePath(); cx.fill();
  cx.beginPath(); cx.arc(x, cyy, r, 0, 7); cx.fill();
  const seg = Math.PI * 2 / colores.length;
  colores.forEach((col, i) => { cx.strokeStyle = col; cx.lineWidth = r * 0.26; cx.beginPath(); cx.arc(x, cyy, r * 0.86, -Math.PI / 2 + i * seg + 0.06, -Math.PI / 2 + (i + 1) * seg - 0.06); cx.stroke(); });
  cx.strokeStyle = halo; cx.lineWidth = r * 0.16; cx.beginPath(); cx.arc(x, cyy, r * 1.12, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); cx.stroke();
  cx.font = `${r * 1.05}px system-ui`; cx.fillStyle = '#fff'; cx.fillText(ic, x, cyy + 1);
  return [x, cyy];
}

function dibujarMapa(dt) {
  if (!M.w) ajustarMapa();
  // Movimiento suave de la cámara hacia su objetivo
  if (cam.objetivo) {
    const k = Math.min(1, dt * 6);
    cam.x += (cam.objetivo.x - cam.x) * k; cam.y += (cam.objetivo.y - cam.y) * k; limitarCam();
    if (Math.abs(cam.objetivo.x - cam.x) < 0.5 && Math.abs(cam.objetivo.y - cam.y) < 0.5) cam.objetivo = null;
  }
  const claveF = [cam.z, cam.x, cam.y, M.w, M.h, N().zonas].join();
  if (claveF !== M.clave) { pintarFondo(); M.clave = claveF; }
  const z = cam.z, C = M.celda * z, K = M.celda * (0.7 + 0.2 * z), ahora = performance.now() / 1000;
  cx.clearRect(0, 0, M.w, M.h); cx.drawImage(M.fondo, 0, 0, M.w, M.h);
  for (const [k, v] of Object.entries(S.cortes)) {
    const [a, b] = k.split('-').map(Number), [x1, y1] = px(...cr(a)), [x2, y2] = px(...cr(b));
    cx.strokeStyle = v.tipo === 'agua' ? `rgba(56,152,255,${0.55 + 0.15 * Math.sin(ahora * 3)})` : v.tipo === 'gente' ? 'rgba(255,150,40,0.35)' : 'rgba(255,120,30,0.6)';
    cx.lineWidth = C * 0.16; cx.lineCap = 'round'; cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke();
  }
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  for (const l of LUGARES) {
    if (!zonaOk(nodo(l.c, l.r))) continue;
    const [x, y] = px(l.c, l.r);
    cx.font = `${K * 0.26}px system-ui`; cx.globalAlpha = 0.9; cx.fillStyle = '#fff'; cx.fillText(l.ic, x + C * 0.3, y - C * 0.3);
    cx.font = `500 ${Math.max(10, K * 0.12)}px Barlow, system-ui`; const w = cx.measureText(l.nombre).width + 8, ly = y - C * 0.3 + K * 0.2;
    cx.fillStyle = 'rgba(7,12,22,0.75)'; redondo(cx, x + C * 0.3 - w / 2, ly - K * 0.08, w, K * 0.16, 4); cx.fill();
    cx.fillStyle = 'rgba(225,233,246,0.8)'; cx.fillText(l.nombre, x + C * 0.3, ly); cx.globalAlpha = 1;
  }
  for (const k of new Set(S.unidades.map(u => u.base))) {
    const b = BASES[k], [x, y] = px(b.c, b.r), r = K * 0.3;
    cx.fillStyle = 'rgba(255,255,255,0.12)'; redondo(cx, x - r, y - r, r * 2, r * 2, r * 0.4); cx.fill();
    cx.strokeStyle = 'rgba(255,255,255,0.25)'; cx.lineWidth = 1.5; cx.stroke();
    cx.font = `${r * 1.1}px system-ui`; cx.fillStyle = '#fff'; cx.fillText(b.ic, x, y + 1);
    if (z > 1.5) { cx.font = `600 ${Math.max(10, K * 0.12)}px Barlow, system-ui`; cx.fillStyle = 'rgba(255,255,255,0.7)'; cx.fillText(b.nombre, x, y + r + K * 0.1); }
  }
  if (S.inc.some(i => PL[i.pl].mayor)) {
    const [x, y] = px(0.6, 1.2), gr = cx.createRadialGradient(x, y, 0, x, y, C * 2.2);
    gr.addColorStop(0, `rgba(255,110,20,${0.45 + 0.1 * Math.sin(ahora * 4)})`); gr.addColorStop(1, 'rgba(255,60,0,0)');
    cx.fillStyle = gr; cx.fillRect(x - C * 2.5, y - C * 2.5, C * 5, C * 5);
  }
  cx.setLineDash([6, 6]); cx.lineDashOffset = -ahora * 20; cx.lineWidth = 2.5;
  for (const u of S.unidades) {
    if (!u.ruta.length || u.inc !== S.sel || !S.sel) continue;
    cx.strokeStyle = COLOR_SERV[u.tipo]; cx.beginPath(); cx.moveTo(...px(u.x, u.y)); u.ruta.forEach(n => cx.lineTo(...px(...cr(n)))); cx.stroke();
  }
  cx.setLineDash([]);
  // Avisos
  const porNodo = {};
  for (const inc of S.inc) {
    const k = porNodo[inc.nodo] = (porNodo[inc.nodo] || 0) + 1;
    const [bx, by] = px(...cr(inc.nodo)), x = bx + (k - 1) * K * 0.42;
    const p = PL[inc.pl], c = S.cola.find(cc => cc.inc === inc.id), conocido = !c || c.preg.que;
    const estado = inc.est === 'trabajo' ? 'trabajo' : S.t - inc.t0 > inc.lim ? 'tarde' : 'abierto';
    const frac = inc.est === 'trabajo' ? 1 - (inc.fin - S.t) / (p.trabajo || 6 + 4 * p.grav) : Math.max(0, 1 - (S.t - inc.t0) / inc.lim);
    const colores = conocido ? Object.keys(inc.nec).map(t => COLOR_SERV[t]) : ['#64748b'];
    [inc._x, inc._y] = dibujarPin(x, by, K, colores.length ? colores : ['#94a3b8'], conocido ? p.ic : '❓', estado, frac, inc.id === S.sel, ahora);
    if (z >= 1.4 || inc.id === S.sel) {
      cx.font = `600 ${Math.max(11, K * 0.13)}px Barlow, system-ui`; const t = `#${inc.id} ${conocido ? p.et : 'Sin clasificar'}`, w = cx.measureText(t).width + 12;
      cx.fillStyle = 'rgba(8,13,24,0.85)'; redondo(cx, x - w / 2, by + 6, w, K * 0.2, 6); cx.fill(); cx.fillStyle = '#e8eef8'; cx.fillText(t, x, by + 6 + K * 0.1);
    }
  }
  // Unidades: las libres esperan en su base, en corro
  const enBase = {};
  for (const u of S.unidades) {
    let [x, y] = px(u.x, u.y);
    const s = K * 0.24, sel = S.selU.includes(u.id);
    if (u.est === 'libre') { const i = enBase[u.base] = (enBase[u.base] ?? -1) + 1, a = -Math.PI * 0.75 + i * 0.75; x += Math.cos(a) * K * 0.68; y += Math.sin(a) * K * 0.68; }
    if (u.est === 'escena') { const i = S.unidades.filter(o => o.inc === u.inc && o.est === 'escena').indexOf(u); x += Math.cos(i * 2.1 + 0.6) * K * 0.5; y += Math.sin(i * 2.1 + 0.6) * K * 0.45 + K * 0.15; }
    if (u.tipo === 'H' && u.est !== 'libre') y -= K * 0.12 + Math.sin(ahora * 3) * 2;
    cx.fillStyle = 'rgba(0,0,0,0.45)'; redondo(cx, x - s + 2, y - s + 3, s * 2, s * 2, s * 0.45); cx.fill();
    cx.fillStyle = COLOR_SERV[u.tipo]; redondo(cx, x - s, y - s, s * 2, s * 2, s * 0.45); cx.fill();
    cx.strokeStyle = sel ? '#fff' : '#0b1220'; cx.lineWidth = sel ? 3.5 : 1.5; cx.stroke();
    if (sel) { cx.strokeStyle = `rgba(255,255,255,${0.4 + 0.3 * Math.sin(ahora * 6)})`; cx.lineWidth = 2; redondo(cx, x - s - 5, y - s - 5, s * 2 + 10, s * 2 + 10, s * 0.6); cx.stroke(); }
    cx.font = `${s * 1.2}px system-ui`; cx.fillStyle = '#fff'; cx.fillText(TIPOS[u.tipo].ic, x, y + 1);
    if (u.est === 'ruta') {
      const on = Math.floor(ahora * 6) % 2;
      cx.fillStyle = on ? '#4c8dff' : '#ff4d4d'; cx.beginPath(); cx.arc(x - s * 0.55, y - s - 2, 3, 0, 7); cx.fill();
      cx.fillStyle = on ? '#ff4d4d' : '#4c8dff'; cx.beginPath(); cx.arc(x + s * 0.55, y - s - 2, 3, 0, 7); cx.fill();
    }
    if (z >= 1.6 || sel) { cx.font = `700 ${Math.max(10, K * 0.11)}px 'Barlow Condensed', system-ui`; cx.fillStyle = '#fff'; cx.fillText(u.id, x, y + s + K * 0.08); }
    u._x = x; u._y = y;
  }
  if (N().tormenta) {
    cx.strokeStyle = 'rgba(160,190,255,0.18)'; cx.lineWidth = 1; cx.beginPath();
    for (let i = 0; i < 110; i++) { const x = (i * 97 + ahora * 60) % M.w, y = (i * 53 + ahora * 700) % M.h; cx.moveTo(x, y); cx.lineTo(x - 4, y + 14); }
    cx.stroke();
  }
  if (apagonActivo()) {
    if (!M.sombra) M.sombra = document.createElement('canvas');
    const s = M.sombra; s.width = M.w; s.height = M.h; const g = s.getContext('2d');
    g.fillStyle = 'rgba(2,4,10,0.9)'; g.fillRect(0, 0, M.w, M.h); g.globalCompositeOperation = 'destination-out';
    const luz = (x, y, r) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
    S.unidades.forEach(u => luz(u._x, u._y, C * 1.1));
    S.inc.forEach(i => luz(i._x, i._y, C * 0.8));
    cx.drawImage(s, 0, 0, M.w, M.h);
  }
  cx.font = `700 ${Math.max(14, K * 0.18)}px 'Barlow Condensed', system-ui`;
  flotantes = flotantes.filter(f => (f.t += dt) < 2.2);
  for (const f of flotantes) {
    const [x, y] = px(f.x, f.y);
    cx.globalAlpha = Math.min(1, 2.2 - f.t); cx.fillStyle = f.mal ? '#ff8a8a' : '#5be3a3';
    cx.fillText(f.txt, x, y - K * 0.7 - f.t * 30); cx.globalAlpha = 1;
  }
}

// Gestos: tocar selecciona, arrastrar mueve, pellizcar o doble toque amplía
const toques = new Map();
let gesto = null, ultimoTap = { t: 0, x: 0, y: 0 };
cv.addEventListener('pointerdown', e => {
  if (!S) return;
  cv.setPointerCapture(e.pointerId); toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cam.objetivo = null;
  if (toques.size === 1) gesto = { tipo: 'tap', x0: e.clientX, y0: e.clientY, cx0: cam.x, cy0: cam.y };
  else if (toques.size === 2) {
    const [a, b] = [...toques.values()];
    gesto = { tipo: 'pinza', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx0: cam.x, cy0: cam.y };
  }
});
cv.addEventListener('pointermove', e => {
  if (!toques.has(e.pointerId) || !gesto) return;
  toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesto.tipo === 'pinza' && toques.size === 2) {
    const [a, b] = [...toques.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const z = Math.max(1, Math.min(ZMAX, gesto.z0 * d / gesto.d0));
    cam.z = z; cam.x = mx - (gesto.mx - gesto.cx0) * z / gesto.z0; cam.y = my - (gesto.my - gesto.cy0) * z / gesto.z0; limitarCam();
  } else if (gesto.tipo === 'tap' || gesto.tipo === 'arrastre') {
    const dx = e.clientX - gesto.x0, dy = e.clientY - gesto.y0;
    if (gesto.tipo === 'tap' && Math.hypot(dx, dy) > 10) gesto.tipo = 'arrastre';
    if (gesto.tipo === 'arrastre') { cam.x = gesto.cx0 + dx; cam.y = gesto.cy0 + dy; limitarCam(); }
  }
});
function finToque(e) {
  if (!toques.has(e.pointerId)) return;
  toques.delete(e.pointerId);
  if (gesto?.tipo === 'tap' && !toques.size) {
    const x = e.clientX, y = e.clientY, ahora = performance.now();
    if (ahora - ultimoTap.t < 320 && Math.hypot(x - ultimoTap.x, y - ultimoTap.y) < 40) { zoomEn(1.7, x, y); ultimoTap.t = 0; }
    else { ultimoTap = { t: ahora, x, y }; tocarMapa(x, y); }
  }
  if (!toques.size) gesto = null; else if (gesto?.tipo === 'pinza') gesto = { tipo: 'nada' };
}
cv.addEventListener('pointerup', finToque);
cv.addEventListener('pointercancel', finToque);
cv.addEventListener('wheel', e => { e.preventDefault(); zoomEn(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });

function tocarMapa(x, y) {
  const K = M.celda * (0.7 + 0.2 * cam.z);
  let mejor = null, dmin = K * 0.4;
  for (const u of S.unidades) { const d = Math.hypot(u._x - x, u._y - y); if (d < dmin) { dmin = d; mejor = ['u', u]; } }
  for (const i of S.inc) { const d = Math.hypot(i._x - x, i._y - y); if (d < dmin) { dmin = d; mejor = ['i', i]; } }
  if (!mejor) return;
  if (mejor[0] === 'u') return toggleUnidad(mejor[1].id);
  seleccionar(mejor[1].id);
}
function seleccionar(id) {
  const inc = S.inc.find(i => i.id === id); if (!inc) return;
  if (S.sel !== id) S.selU = [];
  S.sel = id; S.panel = true;
  if (!(activa()?.inc === id && S.tab === 'llamada')) S.tab = inc.env.length ? 'lugar' : 'despacho';
  Sonido.play('tecla'); ui(); centrarEn(inc.nodo);
}
function destello() { const d = $('#destello'); d.classList.remove('on'); void d.offsetWidth; d.classList.add('on'); }

// ======================= Minijuegos =======================
function abrirCapa(html, clase = '') {
  const capa = $('#capa'); $('#capa-caja').className = 'capa-caja ' + clase; $('#capa-caja').innerHTML = html; capa.hidden = false;
  requestAnimationFrame(() => capa.classList.add('visible'));
}
function cerrarCapa() { const capa = $('#capa'); capa.classList.remove('visible'); capa.hidden = true; mini = null; }

function decir(c, t) { const a = Voz.preparar(t, { ingles: lang(c) === 'en', sid: c.sid }); if (a) audios.set(c.id, a); hablar(c, t); }

function abrirAyuda() {
  const c = activa(); if (!c) return;
  const p = plDe(c);
  Sonido.callar();
  if (p.ayuda === 'rcp') return abrirRCP(c);
  const [titulo, pasos] = PROTOCOLOS[p.ayuda];
  mini = { c, pasos, i: 0, errores: 0, titulo };
  pintarProtocolo();
}

function pintarProtocolo() {
  const m = mini, [dice, ...ops] = m.pasos[m.i];
  m.ops = barajar(ops.map((o, k) => ({ o, ok: k === 0 })));
  abrirCapa(`<div class="mini-cab">🩺 ${esc(m.titulo)} <span>Paso ${m.i + 1} de ${m.pasos.length}</span></div>
    <div class="mini-dice">«${esc(dice)}»</div><p class="mini-pide">¿Qué instrucción le das?</p>
    <div class="mini-ops">${m.ops.map((o, k) => `<button class="btn op-mini" data-a="paso" data-k="${k}">${esc(o.o)}</button>`).join('')}</div>
    <div class="mini-fb" id="mini-fb"></div>`, 'mini');
  decir(m.c, dice);
}

function elegirPaso(k) {
  const m = mini, o = m.ops[k], btn = document.querySelectorAll('.op-mini')[k];
  if (!o.ok) {
    m.errores++; btn.classList.add('mal'); btn.disabled = true; Sonido.play('mal');
    $('#mini-fb').textContent = '«¿Seguro? Eso no suena bien...» Prueba otra instrucción.'; return;
  }
  btn.classList.add('bien'); Sonido.play('ok');
  setTimeout(() => {
    if (!mini) return;
    m.i++;
    if (m.i < m.pasos.length) return pintarProtocolo();
    terminarAyuda(m.c, Math.max(0.2, 1 - m.errores * 0.25));
  }, 600);
}

function abrirRCP(c) {
  const DUR = 16000, GUIA = 4000, INT = 545; // 110 compresiones por minuto
  mini = { c, toques: [], inicio: performance.now(), ultimoBeat: 0 };
  abrirCapa(`<div class="mini-cab">❤️ Reanimación cardiopulmonar <span>Pulsa al ritmo</span></div>
    <p class="mini-pide">Indica al llamante: «Talón de la mano en el centro del pecho, brazos rectos, empuje fuerte». Marca el ritmo con el dedo: <b>100-120 por minuto</b>.</p>
    <button class="corazon" data-a="rcp" id="corazon">❤️</button>
    <div class="rcp-datos"><div><span>Ritmo</span><b id="rcp-bpm">—</b></div><div><span>Compresiones</span><b id="rcp-n">0</b></div><div><span>Tiempo</span><b id="rcp-t">16</b></div></div>
    <div class="rcp-barra"><i id="rcp-zona"></i><i id="rcp-aguja"></i></div><p class="nota" id="rcp-guia">Sigue el latido de guía…</p>`, 'mini');
  Sonido.hablar('Ponga las manos en el centro del pecho y empuje fuerte. Siga mi ritmo.', { tono: 1 });
  mini.frame = ahora => {
    const m = mini, t = ahora - m.inicio;
    if (t < GUIA && ahora - m.ultimoBeat >= INT) { m.ultimoBeat = ahora; Sonido.play('latido'); $('#corazon')?.classList.remove('late'); void $('#corazon')?.offsetWidth; $('#corazon')?.classList.add('late'); }
    if (t >= GUIA && $('#rcp-guia')) $('#rcp-guia').textContent = '¡Ahora tú solo! Mantén el ritmo.';
    if ($('#rcp-t')) $('#rcp-t').textContent = Math.max(0, Math.ceil((DUR - t) / 1000));
    if (t >= DUR) {
      const iv = m.toques.slice(1).map((x, i) => x - m.toques[i]).filter((_, i) => m.toques[i + 1] - m.inicio > 1500);
      const buenos = iv.filter(x => x >= 500 && x <= 600).length;
      const q = iv.length < 12 ? Math.min(0.3, iv.length / 40) : Math.max(0.15, Math.min(1, buenos / iv.length * 1.25));
      terminarAyuda(m.c, q);
    }
  };
}

function toqueRCP() {
  const m = mini, ahora = performance.now();
  m.toques.push(ahora); Sonido.play('pulso');
  const h = $('#corazon'); h.classList.remove('late'); void h.offsetWidth; h.classList.add('late');
  $('#rcp-n').textContent = m.toques.length;
  const n = m.toques.length;
  if (n > 2) {
    const bpm = Math.round(60000 / ((m.toques[n - 1] - m.toques[n - 3]) / 2));
    const el = $('#rcp-bpm'); el.textContent = bpm; el.className = bpm >= 100 && bpm <= 120 ? 'ok' : 'mal';
    $('#rcp-aguja').style.left = `${Math.max(0, Math.min(100, (bpm - 60) / 120 * 100))}%`;
  }
}

function terminarAyuda(c, q) {
  cerrarCapa();
  c.ayuda = true;
  S.stats.ayudaSum += q; S.stats.ayudaN++;
  const inc = S.inc.find(i => i.id === c.inc);
  if (inc) { inc.lim += Math.round(60 * q); inc.bono = (inc.bono || 0) + Math.round(80 * q); }
  const pct = Math.round(q * 100);
  sumar(Math.round(60 * q), `Instrucciones ${pct}%`, c.nodo);
  const t = q >= 0.7 ? '¡Vale, lo he hecho! Creo que funciona... gracias.' : 'Lo intento... no sé si lo estoy haciendo bien.';
  c.log.push({ yo: 0, t }); decir(c, t);
  radio(`Instrucciones dadas con un ${pct}% de calidad.${inc ? ' La víctima aguanta mejor hasta que lleguen.' : ' Localiza al llamante para enviar ayuda.'}`, 'Marta');
  Sonido.play(q >= 0.7 ? 'ok' : 'radio');
  ui();
}

function abrirDeduccion() {
  S.pausado = true;
  const ops = barajar(['Faro', 'Lonja', 'Mercado Central', 'Puerto deportivo']);
  abrirCapa(`<div class="mini-cab">🕵️ Reunión con la policía</div>
    <p class="mini-dice">«Ha pintado una letra en cada incendio: F, A, R, O. Tenemos una sola patrulla secreta. ¿Dónde le esperamos?»</p>
    <div class="mini-ops">${ops.map(o => `<button class="btn op-mini" data-a="deduce" data-l="${o}">${o}</button>`).join('')}</div>`, 'mini');
}

// ======================= Fin de turno =======================
function finTurno() {
  const lvl = N(), st = S.stats, i = S.nivel;
  const total = st.total + st.perdidas, ratio = total ? st.bien / total : 1;
  const fila = (a, b) => `<div><span>${a}</span><b>${b}</b></div>`;
  const resumen = S; S = null; Sonido.ambienteOn(false); Sonido.linea(false); Sonido.callar(); localStorage.removeItem('c911_partida');
  const stats = `<div class="stats">${fila('Puntos', resumen.puntos)}${fila('Resueltas a tiempo', st.bien)}${fila('Resueltas tarde', st.tarde)}${fila('Graves', st.grave)}
      ${fila('Sin contestar', st.perdidas)}${fila('Bromas detectadas', st.bromas)}${fila('Unidades innecesarias', st.innecesarias)}${fila('Instrucciones', st.ayudaN ? Math.round(st.ayudaSum / st.ayudaN * 100) + ' %' : '—')}</div>`;
  if (lvl.libre) {
    const record = resumen.puntos > (P.libre || 0); P.libre = Math.max(P.libre || 0, resumen.puntos); escribir('c911_progreso', P);
    abrirCapa(`<div class="informe-cab">Fin del turno libre</div><h2>${Math.floor(resumen.t / 60)} minutos de servicio</h2>
      ${record ? '<p class="record-nuevo">¡Nuevo récord!</p>' : `<p class="nota">Tu récord: ${P.libre} puntos</p>`}${stats}
      <div class="fila-btn"><button class="btn fantasma" data-a="menu">Menú</button><button class="btn primario" data-a="brief" data-n="${LIBRE_N}">Otro turno libre ▶</button></div>`, 'informe');
    if (record) Sonido.play('estrella');
    return;
  }
  const est = [true, ratio >= 0.6, st.bien >= 5 && !!lvl.reto[1](st)]; // el reto exige haber trabajado el turno
  const n = est.filter(Boolean).length;
  P.estrellas[i] = Math.max(P.estrellas[i] || 0, n); P.puntos[i] = Math.max(P.puntos[i] || 0, resumen.puntos);
  escribir('c911_progreso', P);
  abrirCapa(`<div class="informe-cab">Fin del turno ${i + 1}</div><h2>${esc(lvl.titulo)}</h2>
    <div class="estrellas grande">${[0, 1, 2].map(k => `<span class="${est[k] ? 'on' : ''}" style="animation-delay:${0.3 + k * 0.35}s">★</span>`).join('')}</div>
    <ul class="objetivos"><li class="${est[0] ? 'ok' : ''}">Completar el turno</li><li class="${est[1] ? 'ok' : ''}">Resolver a tiempo el 60 % de las emergencias (${Math.round(ratio * 100)} %)</li><li class="${est[2] ? 'ok' : ''}">${esc(lvl.reto[0])}</li></ul>
    ${stats}
    <div class="fila-btn"><button class="btn fantasma" data-a="menu">Menú</button>${i < NIVELES.length - 1 ? `<button class="btn primario" data-a="brief" data-n="${i + 1}">Siguiente turno ▶</button>` : `<button class="btn primario" data-a="brief" data-n="${LIBRE_N}">Turno libre ▶</button>`}</div>
    ${i === NIVELES.length - 1 ? '<p class="nota fin">Marta se jubila orgullosa. Villaclara duerme tranquila gracias a ti. El turno libre te espera.</p>' : ''}`, 'informe');
  [0, 1, 2].forEach(k => est[k] && setTimeout(() => Sonido.play('estrella'), 300 + k * 350));
}

// ======================= Guardado =======================
function guardar() { if (S) escribir('c911_partida', S); }
document.addEventListener('visibilitychange', () => { if (document.hidden) { guardar(); if (S && !mini && !S.pausado) pausa(); } });

// ======================= Menú =======================
function pintarMenu() {
  const g = leer('c911_partida', null);
  const nombre = g && (g.nivel === LIBRE_N ? 'Turno libre' : NIVELES[g.nivel] && `Turno ${g.nivel + 1}: ${NIVELES[g.nivel].titulo}`);
  $('#continuar').innerHTML = nombre ? `<button class="continuar" data-a="continuar"><span>▶</span><div><b>Continuar ${esc(nombre)}</b>
    <small>${g.nivel === LIBRE_N ? `Llevas ${Math.floor(g.t / 60)} minutos` : `Te quedan ${Math.ceil((DURACION - g.t) / 60)} minutos de turno`} y ${g.puntos} puntos</small></div></button>` : '';
  const abiertos = P.estrellas.filter(Boolean).length;
  $('#niveles').innerHTML = NIVELES.map((l, i) => {
    const bloq = i > abiertos, e = P.estrellas[i] || 0;
    return `<button class="nivel ${bloq ? 'bloq' : ''} ${i === abiertos ? 'siguiente' : ''}" data-a="brief" data-n="${i}" ${bloq ? 'disabled' : ''}>
      <span class="nivel-n">${i + 1}</span>
      <span class="nivel-txt"><b>${esc(l.titulo)}</b><small>${bloq ? 'Completa el turno anterior para desbloquearlo' : esc(l.nuevo.join(', '))}</small></span>
      <span class="nivel-hora">${String(l.hora).padStart(2, '0')}:00</span>
      <span class="nivel-fin">${bloq ? '🔒' : `<span class="estrellas">${[0, 1, 2].map(k => `<span class="${k < e ? 'on' : ''}">★</span>`).join('')}</span>${P.puntos[i] ? `<small>${P.puntos[i]} pts</small>` : ''}`}</span></button>`;
  }).join('') + `<button class="nivel libre ${abiertos ? '' : 'bloq'}" data-a="brief" data-n="${LIBRE_N}" ${abiertos ? '' : 'disabled'}>
      <span class="nivel-n">∞</span><span class="nivel-txt"><b>Turno libre</b><small>${abiertos ? 'Sin final, con condiciones que cambian y grandes emergencias' : 'Completa el turno 1 para desbloquearlo'}</small></span>
      <span class="nivel-hora"></span><span class="nivel-fin">${abiertos ? (P.libre ? `<small>Récord</small><b class="rec-libre">${P.libre}</b>` : '') : '🔒'}</span></button>`;
  $('#btn-sonido-menu').textContent = Sonido.opciones.sonido ? '🔊 Sonido' : '🔇 Sonido';
  $('#btn-voz-menu').textContent = Sonido.opciones.voz ? '🗣️ Voces' : '🤐 Voces';
  $('#btn-voz-menu').classList.toggle('apagado', !Sonido.opciones.voz); $('#btn-sonido-menu').classList.toggle('apagado', !Sonido.opciones.sonido);
  $('#btn-instalar').hidden = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  pintarVoces();
}

function pintarVoces() {
  const el = $('#voces'); if (!el) return;
  el.innerHTML = `<h3>Voces realistas</h3><p class="nota">Voces neuronales que funcionan dentro de la tablet. Se descargan una vez (mejor con wifi) y después van sin internet.</p>` +
    Object.entries(Voz.VOCES).map(([k, v]) => {
      const e = Voz.estado[k];
      const acc = e === 'listo' ? `<span class="chip verde">Lista</span><button class="btn fantasma mini-btn" data-a="voz-borrar" data-l="${k}">Borrar</button>`
        : e === 'descargando' ? `<div class="barra-voz"><i style="width:${Math.round(Voz.progreso[k] * 100)}%"></i></div><small>${Math.round(Voz.progreso[k] * 100)} %</small>`
          : e === 'cargando' ? '<span class="chip ambar">Cargando…</span>'
            : `<button class="btn fantasma mini-btn" data-a="voz-bajar" data-l="${k}">${e === 'error' ? 'Reintentar' : 'Descargar'} (${v.mb} MB)</button>`;
      return `<div class="voz-fila"><b>${v.nombre}</b><span class="voz-acc">${acc}</span></div>`;
    }).join('');
}

function brief(i) {
  const l = i === LIBRE_N ? LIBRE : NIVELES[i];
  abrirCapa(`<div class="informe-cab">${i === LIBRE_N ? 'Modo sin final' : `Turno ${i + 1}, entrada a las ${String(l.hora).padStart(2, '0')}:00`}</div><h2>${esc(l.titulo)}</h2>
    <p class="brief-txt"><b>Marta:</b> ${esc(l.intro)}</p>
    <div class="brief-cols"><div><h3>Novedades</h3><ul>${l.nuevo.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>
    ${i === LIBRE_N ? `<div><h3>Récord</h3><ul><li>${P.libre ? P.libre + ' puntos' : 'Todavía ninguno'}</li></ul></div>` : `<div><h3>Objetivos ★★★</h3><ul><li>Completar el turno (40 min)</li><li>Resolver a tiempo el 60 %</li><li>${esc(l.reto[0])}</li></ul></div>`}
    ${l.glosario ? `<div><h3>Glosario</h3><ul>${l.glosario.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}</div>
    <div class="fila-btn"><button class="btn fantasma" data-a="cerrar">Volver</button><button class="btn primario" data-a="empezar" data-n="${i}">Empezar turno ▶</button></div>`, 'informe');
}

async function pantallaCompleta() {
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* no permitido */ }
  try { await screen.orientation.lock('landscape'); } catch { /* no soportado */ }
  try { await navigator.wakeLock?.request('screen'); } catch { /* no soportado */ }
}

function entrarJuego() {
  cerrarCapa();
  $('#menu').hidden = true; $('#juego').hidden = false;
  Sonido.iniciar(); Sonido.ambienteOn(true); Sonido.linea(!!activa()); pantallaCompleta();
  S.panel ??= false; cam.z = 1; cam.x = 0; cam.y = 0; cam.objetivo = null;
  M.clave = ''; ajustarMapa(); ui();
}
function salirAlMenu() {
  guardar(); S = null; Sonido.ambienteOn(false); Sonido.linea(false); Sonido.callar(); cerrarCapa();
  $('#juego').hidden = true; $('#menu').hidden = false; pintarMenu();
}
function pausa() {
  S.pausado = true; Sonido.callar();
  abrirCapa(`<div class="informe-cab">Pausa</div><h2>${esc(N().titulo)}</h2><p class="nota">Tu turno se guarda automáticamente.</p>
    <div class="fila-btn col"><button class="btn primario" data-a="reanudar">▶ Continuar</button>
    <button class="btn fantasma" data-a="voz">${Sonido.opciones.voz ? '🗣️ Voces: sí' : '🤐 Voces: no'}</button>
    ${N().libre ? '<button class="btn fantasma" data-a="terminar">🏁 Terminar el turno libre</button>' : ''}
    <button class="btn fantasma" data-a="menu">Guardar y salir al menú</button></div>`, 'informe');
}
function guardarAjustes() { escribir('c911_ajustes', { sonido: Sonido.opciones.sonido, voz: Sonido.opciones.voz }); }

async function instalar() {
  try {
    if ('install' in navigator) return await navigator.install();
    if (instalador) { instalador.prompt(); instalador = null; return; }
  } catch { /* cancelado */ }
  $('#ayuda-instalar').hidden = false;
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalador = e; });

// ======================= Acciones (delegación de toques) =======================
const ACCIONES = {
  atender: d => atender(+d.id), preguntar: d => preguntar(d.q), colgar: () => colgar(false), 'colgar-ya': () => colgar(true),
  unidad: d => toggleUnidad(d.id), enviar, retirar: d => retirar(d.id), 'sel-inc': d => { $('#lista-avisos').hidden = true; seleccionar(+d.id); }, ayuda: abrirAyuda,
  tab: d => { S.tab = d.t; S.panel = true; ui(); }, 'cerrar-panel': () => { S.panel = false; S.sel = null; S.selU = []; ui(); },
  avisos: () => { $('#lista-avisos').hidden = !$('#lista-avisos').hidden; ui(); },
  'zoom-mas': () => zoomEn(1.4, M.w / 2, M.h / 2), 'zoom-menos': () => zoomEn(1 / 1.4, M.w / 2, M.h / 2), 'zoom-ver': () => { cam.z = 1; cam.objetivo = null; limitarCam(); },
  paso: d => elegirPaso(+d.k), rcp: toqueRCP,
  deduce: d => { S.flags.faro = d.l === 'Faro'; S.pausado = false; cerrarCapa(); radio(`Patrulla secreta apostada en: ${d.l}.`, 'Policía'); },
  pausa, reanudar: () => { S.pausado = false; cerrarCapa(); }, menu: salirAlMenu, cerrar: cerrarCapa, terminar: () => { cerrarCapa(); S.pausado = false; finTurno(); },
  brief: d => { Sonido.iniciar(); if (S) { S = null; $('#juego').hidden = true; $('#menu').hidden = false; pintarMenu(); } brief(+d.n); },
  empezar: d => { localStorage.removeItem('c911_partida'); nuevaPartida(+d.n); entrarJuego(); },
  continuar: () => { S = leer('c911_partida', null); if (!S) return pintarMenu(); S.pausado = false; entrarJuego(); },
  sonido: () => { Sonido.iniciar(); Sonido.config({ sonido: !Sonido.opciones.sonido }); guardarAjustes(); pintarMenu(); ui(); },
  voz: () => { Sonido.config({ voz: !Sonido.opciones.voz }); guardarAjustes(); pintarMenu(); if (S?.pausado) pausa(); },
  'voz-bajar': d => Voz.descargar(d.l).catch(() => {}), 'voz-borrar': d => Voz.borrar(d.l),
  instalar,
};
// Pantalla completa, instalar y arrancar el audio exigen un gesto "completo" del usuario (click), no basta con pointerdown
const CON_CLICK = new Set(['empezar', 'continuar', 'instalar']);
document.addEventListener('click', e => {
  Sonido.iniciar();
  const b = e.target.closest('[data-a]');
  if (b && !b.disabled && CON_CLICK.has(b.dataset.a)) ACCIONES[b.dataset.a](b.dataset);
});
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-a]');
  if (!b || b.disabled || CON_CLICK.has(b.dataset.a)) return;
  e.preventDefault();
  b.classList.add('pulsado'); setTimeout(() => b.classList.remove('pulsado'), 150);
  ACCIONES[b.dataset.a]?.(b.dataset);
});
addEventListener('resize', () => { if (S) ajustarMapa(); });
document.fonts?.ready.then(() => { M.clave = ''; });

// ======================= Arranque =======================
const esTablet = () => PRUEBA || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) >= 600);
if (!esTablet()) {
  $('#bloqueo').hidden = false; $('#menu').hidden = true;
} else {
  pintarMenu();
  Voz.iniciar(pintarVoces);
  requestAnimationFrame(t => { ultimo = t; bucle(t); });
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
