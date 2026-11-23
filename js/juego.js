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

const PARAMS = new URLSearchParams(location.search);
const VEL = Math.max(1, +PARAMS.get('vel') || 1); // ?vel=20 acelera el tiempo (solo para pruebas)
const PRUEBA = PARAMS.has('prueba');              // ?prueba salta el bloqueo de tablet (solo para pruebas)

const PL = Object.fromEntries(PLANTILLAS.map(p => [p.id, p]));
const nodo = (c, r) => r * COLS + c;
const cr = n => [n % COLS, Math.floor(n / COLS)];
const lugarPorNombre = n => LUGARES.find(l => l.nombre === n);
const articulo = n => /^(Estación|Gasolinera|Fábrica|Lonja|Playa|Residencia)/.test(n) ? 'la' : /^Almacenes/.test(n) ? 'los' : 'el';

let S = null;                       // partida en curso (se guarda entera)
let P = leer('c911_progreso', { estrellas: [], puntos: [] });
Sonido.config(leer('c911_ajustes', { sonido: true, voz: true }));
let flotantes = [], ultimo = 0, acumTick = 0, acumGuardar = 0, mini = null, instalador = null;

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

// Dijkstra: con 96 nodos no hace falta cola de prioridad
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
  return camino;
}

// ======================= Partida =======================
const N = () => NIVELES[S.nivel];
const zonaOk = n => N().zonas.includes(distritoDe(...cr(n)));

function nuevaPartida(nivel) {
  const lvl = NIVELES[nivel], unidades = [];
  lvl.unidades.forEach(([tipo, base, cant]) => {
    for (let i = 0; i < cant; i++) {
      const b = BASES[base], num = unidades.filter(u => u.tipo === tipo).length + 1;
      unidades.push({ id: `${tipo}-${num}`, tipo, base, x: b.c, y: b.r, ruta: [], desde: nodo(b.c, b.r), est: 'libre', inc: null });
    }
  });
  S = {
    nivel, t: 0, puntos: 0, sig: 1, prox: 4, gi: 0, radioProx: 200, eventoProx: 60,
    cola: [], activa: null, inc: [], unidades, radio: [], sel: null, selU: [], cortes: {}, usados: {}, tips: {}, flags: {},
    stats: { bien: 0, tarde: 0, grave: 0, total: 0, cortadas: 0, perdidas: 0, innecesarias: 0, bromas: 0, ocultasCortadas: 0, ayudaSum: 0, ayudaN: 0, heliBien: 0, inglesBien: 0, detenido: 0, mayorOk: 0, falsasEnviadas: 0 },
  };
  if (lvl.guion.some(g => g.llamada && g.t < 10)) S.prox = 70;
  if (lvl.fiesta) ARISTAS.forEach(([a, b]) => { if (distritoDe(...cr(a)) === 'centro' && distritoDe(...cr(b)) === 'centro') S.cortes[clave(a, b)] = { f: 2.2, tipo: 'gente' }; });
  radio(`Turno ${nivel + 1} iniciado: ${lvl.titulo}.`, 'Central');
}

// ---------- Llamadas ----------
function elegirPlantilla() {
  const n = S.nivel, lvl = N();
  const ok = PLANTILLAS.filter(p => !p.hist && p.n <= n + 1 && (!p.solo || p.solo.includes(n + 1)) &&
    (!p.lugar || p.lugar.some(l => zonaOk(nodo(lugarPorNombre(l).c, lugarPorNombre(l).r)))) && p.id !== S.ultimaPl);
  // Menos peso a lo ya visto; más peso a lo nuevo de este nivel y al inglés en el nivel de turistas
  const peso = p => (1 / (1 + 2 * (S.usados[p.id] || 0))) * (p.n === n + 1 || p.solo ? 2.5 : 1) * (lvl.ingles && p.en ? 2.5 : 1);
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

const LINEAS = 4;
function nuevaLlamada(p, extra = {}) {
  const linea = [1, 2, 3, 4].find(l => !S.cola.some(c => c.linea === l));
  if (!linea) return false; // todas las líneas ocupadas: se reintenta luego
  const u = ubicar(p, extra.lugar);
  const vars = { ...Object.fromEntries(Object.entries(p.vars || {}).map(([k, v]) => [k, azar(v)])), ...(extra.vars || {}), dir: u.dir, lugar: u.lugar ? `${articulo(u.lugar)} ${u.lugar}` : u.dir };
  const c = {
    id: S.sig++, pl: p.id, nom: p.nombre || azar(p.en ? NOMBRES_EN : NOMBRES), vars, nodo: u.nodo, t0: S.t, est: 'sonando',
    log: [], pan: p.pan || 0, preg: {}, inc: null, desN: 0, pend: null, ayuda: false, tono: rnd(0.8, 1.35),
    linea, tel: p.en ? `+44 7${Math.floor(rnd(100, 999))} ${Math.floor(rnd(100000, 999999))}` : `6${Math.floor(rnd(10, 99))} ${Math.floor(rnd(100, 999))} ${Math.floor(rnd(100, 999))}`,
  };
  S.cola.push(c); S.usados[p.id] = (S.usados[p.id] || 0) + 1; S.ultimaPl = p.id;
  Sonido.play('timbre'); try { navigator.vibrate?.(150); } catch { /* sin vibración */ }
  tip('sonando', 'Suena el teléfono: toca la línea que parpadea (arriba) para contestar.');
  return true;
}

const rellenar = (s, c) => s.replace(/\{(\w+)\}/g, (_, k) => c.vars[k] ?? '');
const plDe = c => PL[c.pl];
const esReal = p => !['falsa', 'noemerg'].includes(p.tipo);

function atender(id) {
  if (S.activa) return;
  const c = S.cola.find(x => x.id === id); if (!c) return;
  c.est = 'activa'; S.activa = c.id; c.tA = S.t;
  Sonido.play('descolgar'); Sonido.linea(true);
  const p = plDe(c);
  c.log.push({ yo: 1, t: p.en ? '911, what is your emergency?' : '911, ¿cuál es su emergencia?' });
  responder(c, txt(p.ab), null, 0.6);
  tip('contesta', 'Toca las preguntas para obtener datos: qué pasa, dónde, heridos y peligro.');
}

function preguntar(q) {
  const c = activa(); if (!c || c.pend) return;
  const p = plDe(c), L = p.en ? 'en' : 'es', D = RESPUESTAS_DEFECTO[L];
  Sonido.play('tecla');
  c.log.push({ yo: 1, t: PREGUNTAS[q][L] });
  if (q === 'calma') {
    if (c.pan > 0) { c.pan--; return responder(c, txt(D.calmado), 'calma'); }
    return responder(c, txt(D.calma), null);
  }
  if (c.pan > 0) return responder(c, txt(D.panico), null);
  if (q === 'donde') {
    if (p.des && c.desN === 0) { c.desN = 1; return responder(c, txt(D.perdido), null); }
    const base = p.des ? (p.en ? ['I can see {dir}... I am right next to it.'] : ['Veo {dir}... estoy justo al lado.']) : (p.donde || D.donde);
    return responder(c, txt(base), 'donde');
  }
  const r = { que: p.q, heridos: p.h, peligro: p.p, respira: p.r, sino: p.s }[q] || D[q];
  responder(c, txt(r), q);
}

function responder(c, texto, efecto, extra = 0) {
  const t = rellenar(texto, c);
  c.pend = { t, efecto, cuando: S.t + extra + 0.7 + t.length * 0.018 };
}

function procesarPendiente(c) {
  if (!c.pend || S.t < c.pend.cuando) return;
  const { t, efecto } = c.pend, p = plDe(c);
  c.pend = null; c.log.push({ yo: 0, t }); c.habla = S.t + 1 + t.length * 0.05;
  Sonido.hablar(t, { ingles: !!p.en, tono: c.tono, prisa: c.pan > 0 });
  if (efecto && efecto !== 'calma') c.preg[efecto] = true;
  if (efecto === 'donde' && !c.inc) crearIncidente(c);
}

function crearIncidente(c) {
  const p = plDe(c);
  const lim = p.limite || [0, 170, 140, 110][p.grav];
  const inc = { id: c.id, llam: c.id, pl: p.id, nodo: c.nodo, nec: { ...p.nec }, lleg: {}, env: [], t0: c.t0, lim, est: 'abierto', dir: c.vars.dir, vars: c.vars };
  S.inc.push(inc); c.inc = inc.id; S.sel = inc.id; S.selU = [];
  if (esReal(p)) S.stats.total++;
  Sonido.play('alarma');
  const caja = $('#mapa-caja'); caja.classList.remove('destello'); void caja.offsetWidth; caja.classList.add('destello');
  tip('pin', '¡Localizado! El aviso está en el mapa. Elige unidades abajo y pulsa Enviar.');
}

function colgar(forzar) {
  const c = activa(); if (!c) return;
  const p = plDe(c);
  if (esReal(p) && !c.inc && !forzar) { S.confirmar = c.id; return ui(); }
  S.confirmar = null; Sonido.callar(); Sonido.play('colgar'); Sonido.linea(false);
  if (!esReal(p)) {
    const bien = !!c.preg.que;
    sumar(bien ? 60 : 20, bien ? (p.tipo === 'falsa' ? 'Broma detectada' : 'No era urgente') : 'Colgada', c.nodo);
    if (p.tipo === 'falsa' || p.tipo === 'noemerg') S.stats.bromas++;
    const inc = S.inc.find(i => i.id === c.inc);
    if (inc && !inc.env.length) S.inc = S.inc.filter(i => i !== inc);
  } else if (!c.inc) {
    S.stats.cortadas++;
    if (p.tipo === 'oculta' || p.id === 'lucas3') {
      S.stats.ocultasCortadas++; sumar(-150, 'Era una víctima real', null);
      radio(p.id === 'lucas3' ? '¡Lo de Lucas era verdad esta vez! Mandamos la llamada a otra central. Nunca cuelgues sin preguntar.' : 'Esa persona pedía ayuda disimulando. Usa la pregunta de sí o no.', 'Marta');
    } else { sumar(-80, 'Llamada real perdida', null); radio('Has colgado una emergencia real sin localizarla. Otra central la ha recogido.', 'Marta'); }
  }
  S.cola = S.cola.filter(x => x.id !== c.id); S.activa = null;
  ui();
}

const activa = () => S && S.cola.find(c => c.id === S.activa);

// ---------- Despacho ----------
const disponible = u => u.est === 'libre' || u.est === 'vuelta';

function toggleUnidad(id) {
  const u = S.unidades.find(x => x.id === id);
  if (!u || !disponible(u)) return;
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
  S.selU = []; Sonido.play('sirena'); Sonido.play('radio');
  tip('envio', 'Unidades en camino. Cuando tengas los datos puedes colgar: el aviso sigue en el mapa.');
  ui();
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
    const paso = 0.55 * TIPOS[u.tipo].vel / f * dt;
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
    radio(`${u.id}: aquí no hay ninguna emergencia. Era una broma.`, u.id);
    return cerrarIncidente(inc, null);
  }
  if ((inc.lleg[u.tipo] || 0) >= (inc.nec[u.tipo] || 0)) {
    S.stats.innecesarias++; sumar(-15, `${u.id} innecesaria`, inc.nodo); Sonido.play('mal');
    radio(`${u.id}: no hacemos falta aquí, regresamos.`, u.id);
    inc.env = inc.env.filter(x => x !== u.id); return volver(u);
  }
  inc.lleg[u.tipo] = (inc.lleg[u.tipo] || 0) + 1; u.est = 'escena';
  radio(`${u.id}: en el lugar. ${completo(inc) ? 'Trabajando.' : 'Esperamos refuerzos.'}`, u.id);
  if (completo(inc) && inc.est === 'abierto') {
    inc.est = 'trabajo'; inc.tc = S.t; inc.fin = S.t + (p.trabajo || 6 + 4 * p.grav);
  }
}
const completo = inc => Object.entries(inc.nec).every(([t, n]) => (inc.lleg[t] || 0) >= n);

function cerrarIncidente(inc, res) {
  inc.est = 'cerrado';
  S.unidades.filter(u => u.inc === inc.id).forEach(volver);
  S.inc = S.inc.filter(i => i !== inc);
  if (S.sel === inc.id) S.sel = S.inc.find(i => i.est !== 'cerrado')?.id ?? null;
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
  S.radio.push({ t, quien, h: hora() }); if (S.radio.length > 30) S.radio.shift();
  Sonido.play('radio');
}
function tip(clave, t) { if (S.nivel === 0 && !S.tips[clave]) { S.tips[clave] = 1; radio(t, 'Marta'); } }

const CHARLA = ['P-1: tráfico denso en la Calle Mayor.', 'Central, aquí A-2: repostando, seguimos operativos.', 'B-1: revisión de material terminada.',
  'Aviso: obras en Av. Goya, circulen con precaución.', 'P-2: control rutinario sin novedad.', 'Hospital: urgencias con espera moderada.',
  'Meteorología: viento racheado esta tarde.', 'Central: recordad registrar todos los avisos.', 'A-1: paciente entregado, volvemos a base.'];

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
  if (S.t >= (S.salaProx || 0)) { S.salaProx = S.t + rnd(14, 32); Sonido.play(azar(['lejano', 'teclado', 'teclado'])); }
  if (S.t >= S.radioProx) { S.radioProx = S.t + rnd(150, 260); radio(azar(CHARLA), 'Radio'); }
}
function cortarAleatorias(tipo, n, f) {
  Object.keys(S.cortes).forEach(k => S.cortes[k].tipo === tipo && delete S.cortes[k]);
  const ok = barajar(ARISTAS.filter(([a, b]) => zonaOk(a) && zonaOk(b) && !S.cortes[clave(a, b)])).slice(0, n);
  ok.forEach(([a, b]) => { S.cortes[clave(a, b)] = { f, tipo }; });
  return ok;
}
function inundar() {
  const ok = cortarAleatorias('agua', 6, 4);
  const [a, b] = ok[0], [c1, r1] = cr(a), [c2] = cr(b);
  radio(`Calles inundadas, entre ellas ${c1 === c2 ? AVENIDAS[c1] : CALLES[r1]}. Las unidades irán más lentas por las zonas en azul.`, 'Marta');
}
function atasco() {
  const [[a, b]] = cortarAleatorias('atasco', 3, 3), [c1, r1] = cr(a), [c2] = cr(b);
  radio(`Atasco en ${c1 === c2 ? AVENIDAS[c1] : CALLES[r1]} (en naranja).`, 'Radio');
}

// ======================= Bucle principal =======================
function bucle(ahora) {
  const dt = Math.min(0.1, (ahora - ultimo) / 1000 || 0) * VEL; ultimo = ahora;
  if (S && !S.pausado && !mini) {
    S.t += dt;
    S.cola.forEach(procesarPendiente);
    // Llamadas nuevas
    if (S.t >= S.prox && S.t < DURACION - 90) {
      if (S.cola.filter(c => c.est === 'sonando').length < 3 && S.cola.length < LINEAS) nuevaLlamada(elegirPlantilla());
      S.prox = S.t + rnd(...N().cada);
    }
    // Llamadas que se cansan de esperar
    for (const c of [...S.cola]) if (c.est === 'sonando' && S.t - c.t0 > 55) {
      S.cola = S.cola.filter(x => x !== c);
      if (esReal(plDe(c))) { S.stats.perdidas++; sumar(-50, 'Llamada sin contestar', null); radio('Una llamada ha colgado tras esperar demasiado.', 'Marta'); }
    }
    procesarGuion(); eventos(); moverUnidades(dt); actualizarIncidentes();
    acumTick += dt / VEL; acumGuardar += dt / VEL;
    if (acumTick > 0.25) { acumTick = 0; ui(); }
    if (acumGuardar > 5) { acumGuardar = 0; guardar(); }
    if (S.t >= DURACION) finTurno();
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
function ui() {
  if (!S) return;
  const lvl = N();
  $('#hud-num').textContent = `Turno ${S.nivel + 1}`;
  $('#hud-titulo').textContent = lvl.titulo;
  $('#hud-reloj').textContent = hora();
  $('#hud-barra').style.width = `${Math.min(100, S.t / DURACION * 100)}%`;
  $('#hud-puntos').textContent = `${S.puntos} pts`;
  $('#btn-sonido').textContent = Sonido.opciones.sonido ? '🔊' : '🔇';
  const h = (lvl.hora + S.t / DURACION * 8) % 24, dia = Math.max(0, Math.cos((h - 13) / 24 * 2 * Math.PI)); // 1 a mediodía, 0 de noche
  $('#juego').style.setProperty('--dia', dia.toFixed(2));
  pintarLineas(); pintarLlamada(); pintarRadio(); pintarDespacho();
}

function pintarLineas() {
  setHTML($('#lineas'), [1, 2, 3, 4].map(l => {
    const c = S.cola.find(x => x.linea === l);
    if (!c) return `<div class="linea-tel libre"><i class="piloto"></i><span><b>Línea ${l}</b><small>Libre</small></span></div>`;
    if (c.est === 'activa') return `<div class="linea-tel activa"><i class="piloto"></i><span><b>Línea ${l}</b><small>En curso</small></span></div>`;
    return `<button class="linea-tel sonando ${S.activa ? 'retenida' : ''}" data-a="atender" data-id="${c.id}"><i class="piloto"></i>
      <span><b>${c.tel}</b><small>${S.activa ? 'En espera' : 'Contestar'}</small></span><i class="espera" data-t0="${c.t0}"></i></button>`;
  }).join(''));
  document.querySelectorAll('.espera').forEach(e => { e.style.width = `${Math.max(0, 100 - (S.t - e.dataset.t0) / 55 * 100)}%`; });
}

function pintarLlamada() {
  const el = $('#llamada'), c = activa();
  if (!c) {
    return setHTML(el, `<div class="sin-llamada"><div class="auriculares">🎧</div><p>Esperando llamadas…</p>
      <small>${S.inc.length ? 'Puedes seguir gestionando los avisos del mapa.' : 'Mantente atento al teléfono.'}</small></div>`);
  }
  const p = plDe(c), L = p.en ? 'en' : 'es';
  const nervios = c.pan > 0 ? `<span class="chip rojo">Muy nervioso: cálmale</span>` : `<span class="chip verde">Colabora</span>`;
  const dur = Math.floor(S.t - (c.tA ?? S.t)), mmss = `${String(Math.floor(dur / 60)).padStart(2, '0')}:${String(dur % 60).padStart(2, '0')}`;
  const habla = c.pend || S.t < (c.habla || 0);
  const log = c.log.map(l => `<div class="linea ${l.yo ? 'yo' : 'el'}">${esc(l.t)}</div>`).join('') + (c.pend ? '<div class="linea el escribiendo"><i></i><i></i><i></i></div>' : '');
  const etq = c.preg.sino && p.et2 ? p.et2 : p.et;
  const dato = (k, v) => c.preg[k] ? `<b>${esc(rellenar(v, c))}</b>` : '<span class="falta">—</span>';
  const completa = c.preg.que && c.preg.heridos && c.preg.peligro && (p.tipo !== 'oculta' || c.preg.sino) || (S.nivel < 2 && c.preg.que);
  let rec = '';
  if (completa) {
    rec = p.rec ? p.rec : p.tipo === 'falsa' ? '⚠️ Datos poco creíbles: ¿es una broma?'
      : 'Recomendado: ' + Object.entries(p.nec).map(([t, n]) => `${TIPOS[t].ic}×${n}`).join(' ');
  }
  const qs = ['que', 'donde', 'heridos', 'peligro', 'respira', 'calma', ...(S.nivel >= 3 ? ['sino'] : [])];
  const puedeAyudar = p.ayuda && c.preg.que && !c.ayuda && c.pan === 0;
  const conf = S.confirmar === c.id;
  setHTML(el, `
    <div class="llam-cab">
      <div class="ani"><b>${esc(c.nom)}</b><small>${c.tel}${p.en ? ' (inglés)' : ''}</small></div>
      <div class="onda" aria-hidden="true">${'<i></i>'.repeat(9)}</div>
      <div class="llam-der"><span class="duracion"></span>${nervios}</div>
    </div>
    <div class="transcripcion" id="trans">${log}</div>
    <div class="ficha">
      <div><span>Qué pasa</span>${c.preg.que ? `<b>${p.ic} ${esc(etq)}</b>` : '<span class="falta">—</span>'}</div>
      <div><span>Lugar</span>${c.preg.donde ? `<b>📍 ${esc(c.vars.dir)}</b>` : '<span class="falta">—</span>'}</div>
      <div><span>Heridos</span>${dato('heridos', p.fh || 'Ninguno')}</div>
      <div><span>Peligro</span>${dato('peligro', p.fp || 'Ninguno')}</div>
      ${rec ? `<div class="rec">${esc(rec)}</div>` : ''}
    </div>
    <div class="opciones ${c.pend ? 'esperando' : ''}">
      ${qs.map(q => `<button class="op ${c.preg[q] ? 'hecha' : ''} ${q === 'calma' && c.pan > 0 ? 'urge' : ''}" data-a="preguntar" data-q="${q}">${esc(PREGUNTAS[q][L])}</button>`).join('')}
    </div>
    <div class="acciones">
      ${puedeAyudar ? `<button class="btn ayuda" data-a="ayuda">🩺 Instrucciones: ${esc(p.ayuda === 'rcp' ? 'RCP' : PROTOCOLOS[p.ayuda][0])}</button>` : ''}
      <button class="btn colgar ${conf ? 'confirma' : ''}" data-a="${conf ? 'colgar-ya' : 'colgar'}">${conf ? '¿Colgar sin localizar? Toca otra vez' : '☎️ Colgar'}</button>
    </div>`);
  el.querySelector('.duracion').textContent = mmss; el.querySelector('.onda').classList.toggle('habla', !!habla);
  const t = $('#trans'); if (t && t._n !== c.log.length + !!c.pend) { t._n = c.log.length + !!c.pend; t.scrollTop = t.scrollHeight; }
}

function pintarRadio() {
  setHTML($('#radio'), S.radio.slice(-3).reverse().map((r, i) => `<div class="radio-l ${i ? '' : 'nueva'}"><span>${r.h}</span><b>${esc(r.quien)}:</b> ${esc(r.t)}</div>`).join(''));
}

function pintarDespacho() {
  const inc = S.inc.find(i => i.id === S.sel);
  const chips = S.inc.map(i => {
    const p = PL[i.pl], tarde = i.est === 'abierto' && S.t - i.t0 > i.lim;
    return `<button class="inc-chip ${i.id === S.sel ? 'sel' : ''} ${tarde ? 'tarde' : ''} ${i.est}" data-a="sel-inc" data-id="${i.id}">${p.ic} <span>${i.id}</span></button>`;
  }).join('');
  let ficha = `<div class="desp-vacio">${S.inc.length ? 'Toca un aviso del mapa para despachar unidades' : 'Sin avisos en el mapa. Cuando localices una emergencia aparecerá aquí.'}</div>`;
  if (inc) {
    const p = PL[inc.pl], c = S.cola.find(x => x.inc === inc.id);
    const conocido = !c || c.preg.que;
    const resto = Math.max(0, inc.lim - (S.t - inc.t0));
    const llegadas = Object.entries(inc.nec).map(([t, n]) => `<span class="nec">${TIPOS[t].ic} ${inc.lleg[t] || 0}/${n}</span>`).join('');
    const estado = inc.est === 'trabajo' ? `<span class="chip verde">Trabajando… ${Math.ceil(inc.fin - S.t)} s</span>`
      : `<span class="chip ${resto ? 'ambar' : 'rojo'}">⏱ ${resto ? Math.ceil(resto) + ' s' : 'Retrasado'}</span>`;
    ficha = `<div class="desp-inc"><div><b>${conocido ? p.ic + ' ' + esc(c?.preg.sino && p.et2 ? p.et2 : p.et) : '❓ Aviso sin clasificar'}</b>
      <small>📍 ${esc(inc.dir)}</small></div><div class="desp-estado">${inc.est === 'trabajo' || inc.env.length ? llegadas : ''}${estado}</div></div>`;
  }
  const grupos = Object.keys(TIPOS).filter(t => S.unidades.some(u => u.tipo === t)).map(t => `<div class="grupo">${
    S.unidades.filter(u => u.tipo === t).map(u => {
      const est = { libre: 'Libre', vuelta: 'Volviendo', ruta: 'En ruta', escena: 'En escena' }[u.est];
      return `<button class="unidad ${u.est} ${S.selU.includes(u.id) ? 'sel' : ''}" data-a="unidad" data-id="${u.id}" ${disponible(u) && inc ? '' : 'disabled'}>
        <span class="u-ic">${TIPOS[t].ic}</span><b>${u.id}</b><small>${est}</small></button>`;
    }).join('')}</div>`).join('');
  const n = S.selU.length;
  setHTML($('#despacho'), `${chips ? `<div class="inc-lista">${chips}</div>` : ''}${ficha}
    <div class="desp-fila"><div class="unidades">${grupos}</div>
    <button class="btn enviar" data-a="enviar" ${n && inc && inc.est !== 'cerrado' ? '' : 'disabled'}>🚨 Enviar${n ? ` (${n})` : ''}</button></div>`);
}

// ======================= Mapa (canvas) =======================
const cv = $('#mapa'), cx = cv.getContext('2d');
let M = { w: 0, h: 0, celda: 40, ox: 0, oy: 0, fondo: null, zonas: '' };
const px = (c, r) => [M.ox + c * M.cX, M.oy + r * M.cY];

function ajustarMapa() {
  const caja = $('#mapa-caja'), dpr = Math.min(2, devicePixelRatio || 1);
  const w = caja.clientWidth, h = caja.clientHeight;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  M.w = w; M.h = h; M.dpr = dpr;
  M.cX = (w - 60) / (COLS - 1); M.cY = (h - 70) / (FILAS - 1);
  M.cX = Math.min(M.cX, M.cY * 1.45); M.cY = Math.min(M.cY, M.cX * 1.3); // sin deformar demasiado las manzanas
  M.celda = Math.min(M.cX, M.cY);
  M.ox = (w - M.cX * (COLS - 1)) / 2; M.oy = (h - M.cY * (FILAS - 1)) / 2 + 8; // algo más de aire arriba para los rótulos
  M.fondo = null;
}

function pintarFondo() {
  const f = document.createElement('canvas'); f.width = M.w * M.dpr; f.height = M.h * M.dpr;
  const g = f.getContext('2d'); g.scale(M.dpr, M.dpr);
  const C = M.celda, calle = C * 0.2;
  g.fillStyle = '#070c16'; g.fillRect(0, 0, M.w, M.h);
  // Manzanas
  for (let r = 0; r < FILAS - 1; r++) for (let c = 0; c < COLS - 1; c++) {
    const [x, y] = px(c, r);
    if (r === 5) continue; // franja del río
    const z = distritoDe(c + (c >= 9 ? 1 : 0), r + (r >= 5 ? 1 : 0));
    const abierto = N().zonas.includes(z);
    g.fillStyle = abierto ? DISTRITOS[z].color : '#0a0f19';
    const bw = M.cX - calle, bh = M.cY - calle;
    redondo(g, x + calle / 2, y + calle / 2, bw, bh, C * 0.08); g.fill();
    if (abierto) { // ventanas/edificios sutiles
      g.fillStyle = 'rgba(255,255,255,0.035)';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if ((c * 7 + r * 3 + i + j) % 3) g.fillRect(x + calle / 2 + 4 + i * (bw - 8) / 3, y + calle / 2 + 4 + j * (bh - 8) / 3, (bw - 8) / 3 - 3, (bh - 8) / 3 - 3);
    } else {
      g.strokeStyle = 'rgba(255,255,255,0.04)'; g.lineWidth = 1;
      g.save(); g.beginPath(); g.rect(x + calle / 2, y + calle / 2, bw, bh); g.clip();
      for (let k = -bh; k < bw; k += 7) { g.beginPath(); g.moveTo(x + calle / 2 + k, y + calle / 2); g.lineTo(x + calle / 2 + k + bh, y + calle / 2 + bh); g.stroke(); }
      g.restore();
    }
  }
  // Río
  const [, ry] = px(0, 5);
  const grad = g.createLinearGradient(0, ry, 0, ry + M.cY); grad.addColorStop(0, '#0d2a4a'); grad.addColorStop(0.5, '#123a63'); grad.addColorStop(1, '#0d2a4a');
  g.fillStyle = grad; g.fillRect(0, ry + calle / 2, M.w, M.cY - calle);
  // Calles
  g.lineCap = 'round';
  for (const [a, b] of ARISTAS) {
    const [x1, y1] = px(...cr(a)), [x2, y2] = px(...cr(b));
    g.strokeStyle = '#273246'; g.lineWidth = calle; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = 'rgba(255,214,120,0.08)'; g.lineWidth = 1; g.setLineDash([4, 6]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
  }
  // Nombres de calles y avenidas
  g.fillStyle = 'rgba(180,195,220,0.4)'; g.font = `500 ${Math.max(9, C * 0.13)}px Barlow, system-ui`; g.textBaseline = 'middle';
  CALLES.forEach((n, r) => { const [x, y] = px(0.5, r); g.textAlign = 'center'; g.fillText(n.replace('Calle ', 'C/ '), x + C * 2, y - calle * 0.9); });
  AVENIDAS.forEach((n, c) => { const [x, y] = px(c, 3.5); g.save(); g.translate(x + calle * 0.9, y); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(n, 0, 0); g.restore(); });
  // Nombres de los distritos abiertos, grandes y tenues, como en un plano
  g.font = `700 ${C * 0.42}px 'Barlow Condensed', system-ui`; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,0.05)';
  [['centro', 5.5, 3.5], ['norte', 5.5, 0.5], ['poligono', 10.5, 2.5], ['puerto', 6, 6.5], ['bosque', 0.5, 3]].forEach(([z, c, r]) => {
    if (N().zonas.includes(z)) { const [x, y] = px(c, r); g.fillText(DISTRITOS[z].nombre, x, y); }
  });
  // Rótulos de distritos cerrados
  g.font = `600 ${C * 0.2}px 'Barlow Condensed', system-ui`; g.fillStyle = 'rgba(255,255,255,0.2)';
  [['norte', 5.5, 0.5], ['poligono', 10.5, 2.5], ['puerto', 6, 6.5], ['bosque', 0.5, 3]].forEach(([z, c, r]) => {
    if (!N().zonas.includes(z)) { const [x, y] = px(c, r); g.fillText('🔒 ' + DISTRITOS[z].nombre, x, y); }
  });
  // Rosa de los vientos y viñeta de monitor
  g.font = `700 ${C * 0.18}px 'Barlow Condensed', system-ui`; g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillText('N', M.w - 22, 18);
  g.beginPath(); g.moveTo(M.w - 22, 26); g.lineTo(M.w - 27, 40); g.lineTo(M.w - 17, 40); g.closePath(); g.fill();
  const v = g.createRadialGradient(M.w / 2, M.h / 2, Math.min(M.w, M.h) * 0.35, M.w / 2, M.h / 2, Math.max(M.w, M.h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = v; g.fillRect(0, 0, M.w, M.h);
  M.fondo = f; M.zonas = N().zonas.join();
}

function redondo(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

function dibujarMapa(dt) {
  if (!M.w) ajustarMapa();
  if (!M.w) return;
  if (!M.fondo || M.zonas !== N().zonas.join()) pintarFondo();
  const C = M.celda, ahora = performance.now() / 1000;
  cx.clearRect(0, 0, M.w, M.h); cx.drawImage(M.fondo, 0, 0, M.w, M.h);
  // Calles cortadas o lentas
  for (const [k, v] of Object.entries(S.cortes)) {
    const [a, b] = k.split('-').map(Number), [x1, y1] = px(...cr(a)), [x2, y2] = px(...cr(b));
    cx.strokeStyle = v.tipo === 'agua' ? `rgba(56,152,255,${0.55 + 0.15 * Math.sin(ahora * 3)})` : v.tipo === 'gente' ? 'rgba(255,150,40,0.35)' : 'rgba(255,120,30,0.6)';
    cx.lineWidth = C * 0.16; cx.lineCap = 'round'; cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke();
  }
  const fz = C * 0.3;
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  // Lugares
  for (const l of LUGARES) {
    if (!zonaOk(nodo(l.c, l.r))) continue;
    const [x, y] = px(l.c, l.r);
    cx.font = `${fz * 0.8}px system-ui`; cx.globalAlpha = 0.85; cx.fillStyle = '#fff'; cx.fillText(l.ic, x + C * 0.28, y - C * 0.28);
    cx.font = `500 ${Math.max(9, C * 0.13)}px Barlow, system-ui`; cx.fillStyle = 'rgba(220,230,245,0.55)'; cx.fillText(l.nombre, x + C * 0.28, y - C * 0.08); cx.globalAlpha = 1;
  }
  // Bases
  const bases = new Set(S.unidades.map(u => u.base));
  for (const k of bases) {
    const b = BASES[k], [x, y] = px(b.c, b.r);
    cx.fillStyle = 'rgba(255,255,255,0.1)'; cx.beginPath(); cx.arc(x, y, C * 0.32, 0, 7); cx.fill();
    cx.font = `${fz}px system-ui`; cx.fillStyle = '#fff'; cx.fillText(b.ic, x, y);
  }
  // Incendio forestal: resplandor en la sierra
  if (S.inc.some(i => PL[i.pl].mayor)) {
    const [x, y] = px(0.6, 1.2), g = cx.createRadialGradient(x, y, 0, x, y, C * 2.2);
    g.addColorStop(0, `rgba(255,110,20,${0.45 + 0.1 * Math.sin(ahora * 4)})`); g.addColorStop(1, 'rgba(255,60,0,0)');
    cx.fillStyle = g; cx.fillRect(x - C * 2.5, y - C * 2.5, C * 5, C * 5);
  }
  // Rutas de las unidades del aviso seleccionado
  cx.setLineDash([6, 6]); cx.lineDashOffset = -ahora * 20; cx.lineWidth = 2;
  for (const u of S.unidades) {
    if (!u.ruta.length || u.inc !== S.sel) continue;
    cx.strokeStyle = TIPOS[u.tipo].color; cx.beginPath(); cx.moveTo(...px(u.x, u.y)); u.ruta.forEach(n => cx.lineTo(...px(...cr(n)))); cx.stroke();
  }
  cx.setLineDash([]);
  // Avisos
  const porNodo = {};
  for (const inc of S.inc) {
    const k = porNodo[inc.nodo] = (porNodo[inc.nodo] || 0) + 1;
    const [bx, by] = px(...cr(inc.nodo)), x = bx + (k - 1) * C * 0.35, y = by;
    const p = PL[inc.pl], tarde = inc.est === 'abierto' && S.t - inc.t0 > inc.lim, sel = inc.id === S.sel;
    const color = inc.est === 'trabajo' ? '#22c55e' : tarde ? '#ef4444' : '#f59e0b';
    const pul = (ahora * (tarde ? 2 : 1.2)) % 1;
    cx.strokeStyle = color; cx.globalAlpha = 1 - pul; cx.lineWidth = 3; cx.beginPath(); cx.arc(x, y, C * (0.25 + pul * 0.35), 0, 7); cx.stroke(); cx.globalAlpha = 1;
    cx.fillStyle = 'rgba(10,14,24,0.9)'; cx.beginPath(); cx.arc(x, y, C * 0.26, 0, 7); cx.fill();
    // Arco de tiempo restante o de trabajo
    const frac = inc.est === 'trabajo' ? 1 - (inc.fin - S.t) / ((PL[inc.pl].trabajo || 6 + 4 * p.grav)) : Math.max(0, 1 - (S.t - inc.t0) / inc.lim);
    cx.strokeStyle = color; cx.lineWidth = 3.5; cx.beginPath(); cx.arc(x, y, C * 0.26, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); cx.stroke();
    if (sel) { cx.strokeStyle = '#fff'; cx.lineWidth = 2; cx.beginPath(); cx.arc(x, y, C * 0.34, 0, 7); cx.stroke(); }
    const c = S.cola.find(cc => cc.inc === inc.id);
    cx.font = `${fz * 0.85}px system-ui`; cx.fillStyle = '#fff'; cx.fillText(!c || c.preg.que ? p.ic : '❓', x, y + 1);
    inc._x = x; inc._y = y;
  }
  // Unidades
  for (const u of S.unidades) {
    if (u.est === 'libre') continue;
    let [x, y] = px(u.x, u.y);
    if (u.tipo === 'H') y -= C * 0.15 + Math.sin(ahora * 3) * 2;
    if (u.est === 'escena') { const i = S.unidades.filter(o => o.inc === u.inc && o.est === 'escena').indexOf(u); x += Math.cos(i * 2.1) * C * 0.38; y += Math.sin(i * 2.1) * C * 0.38; }
    cx.fillStyle = 'rgba(0,0,0,0.5)'; cx.beginPath(); cx.arc(x + 2, y + 3, C * 0.2, 0, 7); cx.fill();
    cx.fillStyle = '#0f172a'; cx.strokeStyle = TIPOS[u.tipo].color; cx.lineWidth = 2.5; cx.beginPath(); cx.arc(x, y, C * 0.2, 0, 7); cx.fill(); cx.stroke();
    cx.font = `${fz * 0.75}px system-ui`; cx.fillText(TIPOS[u.tipo].ic, x, y + 1);
    if (u.est === 'ruta') { // rotativos
      const on = Math.floor(ahora * 6) % 2;
      cx.fillStyle = on ? '#3b82f6' : '#ef4444'; cx.beginPath(); cx.arc(x - C * 0.12, y - C * 0.22, 3, 0, 7); cx.fill();
      cx.fillStyle = on ? '#ef4444' : '#3b82f6'; cx.beginPath(); cx.arc(x + C * 0.12, y - C * 0.22, 3, 0, 7); cx.fill();
    }
  }
  // Lluvia
  if (N().tormenta) {
    cx.strokeStyle = 'rgba(160,190,255,0.18)'; cx.lineWidth = 1; cx.beginPath();
    for (let i = 0; i < 90; i++) { const x = (i * 97 + ahora * 60) % M.w, y = (i * 53 + ahora * 700) % M.h; cx.moveTo(x, y); cx.lineTo(x - 4, y + 14); }
    cx.stroke();
  }
  // Apagón: oscuridad salvo alrededor de unidades, bases y avisos
  const ap = N().apagon;
  if (ap && S.t > ap[0] && S.t < ap[1]) {
    if (!M.sombra) M.sombra = document.createElement('canvas');
    const s = M.sombra; s.width = M.w; s.height = M.h; const g = s.getContext('2d');
    g.fillStyle = 'rgba(2,4,10,0.9)'; g.fillRect(0, 0, M.w, M.h); g.globalCompositeOperation = 'destination-out';
    const luz = (x, y, r) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
    S.unidades.forEach(u => luz(...px(u.x, u.y), C * 1.1));
    S.inc.forEach(i => luz(i._x, i._y, C * 0.8));
    cx.drawImage(s, 0, 0);
  }
  // Textos flotantes de puntos
  cx.font = `700 ${Math.max(13, C * 0.22)}px 'Barlow Condensed', system-ui`;
  flotantes = flotantes.filter(f => (f.t += dt) < 2.2);
  for (const f of flotantes) {
    const [x, y] = px(f.x, f.y);
    cx.globalAlpha = Math.min(1, 2.2 - f.t); cx.fillStyle = f.mal ? '#f87171' : '#4ade80';
    cx.fillText(f.txt, x, y - C * 0.5 - f.t * 30); cx.globalAlpha = 1;
  }
}

cv.addEventListener('pointerdown', e => {
  if (!S) return;
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  let mejor = null, dmin = M.celda * 0.55;
  for (const i of S.inc) { const d = Math.hypot(i._x - x, i._y - y); if (d < dmin) { dmin = d; mejor = i; } }
  if (mejor) { S.sel = mejor.id; S.selU = []; Sonido.play('tecla'); ui(); }
});

// ======================= Minijuegos =======================
function abrirCapa(html, clase = '') {
  const capa = $('#capa'); $('#capa-caja').className = 'capa-caja ' + clase; $('#capa-caja').innerHTML = html; capa.hidden = false;
  requestAnimationFrame(() => capa.classList.add('visible'));
}
function cerrarCapa() { const capa = $('#capa'); capa.classList.remove('visible'); capa.hidden = true; mini = null; }

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
  Sonido.hablar(dice, { tono: m.c.tono });
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
  c.log.push({ yo: 0, t: q >= 0.7 ? '¡Vale, lo he hecho! Creo que funciona... gracias.' : 'Lo intento... no sé si lo estoy haciendo bien.' });
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
  const lvl = N(), st = S.stats;
  const total = st.total + st.perdidas, ratio = total ? st.bien / total : 1;
  const est = [true, ratio >= 0.6, st.bien >= 5 && !!lvl.reto[1](st)]; // el reto exige haber trabajado el turno
  const n = est.filter(Boolean).length, i = S.nivel;
  P.estrellas[i] = Math.max(P.estrellas[i] || 0, n); P.puntos[i] = Math.max(P.puntos[i] || 0, S.puntos);
  escribir('c911_progreso', P); localStorage.removeItem('c911_partida');
  const fila = (a, b) => `<div><span>${a}</span><b>${b}</b></div>`;
  const resumen = S; S = null; Sonido.ambienteOn(false); Sonido.linea(false); Sonido.callar();
  abrirCapa(`<div class="informe-cab">Fin del turno ${i + 1}</div><h2>${esc(lvl.titulo)}</h2>
    <div class="estrellas grande">${[0, 1, 2].map(k => `<span class="${est[k] ? 'on' : ''}" style="animation-delay:${0.3 + k * 0.35}s">★</span>`).join('')}</div>
    <ul class="objetivos"><li class="${est[0] ? 'ok' : ''}">Completar el turno</li><li class="${est[1] ? 'ok' : ''}">Resolver a tiempo el 60 % de las emergencias (${Math.round(ratio * 100)} %)</li><li class="${est[2] ? 'ok' : ''}">${esc(lvl.reto[0])}</li></ul>
    <div class="stats">${fila('Puntos', resumen.puntos)}${fila('Resueltas a tiempo', st.bien)}${fila('Resueltas tarde', st.tarde)}${fila('Graves', st.grave)}
      ${fila('Sin contestar', st.perdidas)}${fila('Bromas detectadas', st.bromas)}${fila('Unidades innecesarias', st.innecesarias)}${fila('Instrucciones', st.ayudaN ? Math.round(st.ayudaSum / st.ayudaN * 100) + ' %' : '—')}</div>
    <div class="fila-btn"><button class="btn fantasma" data-a="menu">Menú</button>${i < NIVELES.length - 1 ? `<button class="btn primario" data-a="brief" data-n="${i + 1}">Siguiente turno ▶</button>` : ''}</div>
    ${i === NIVELES.length - 1 ? '<p class="nota fin">Marta se jubila orgullosa. Villaclara duerme tranquila gracias a ti. ¡Gracias por jugar!</p>' : ''}`, 'informe');
  [0, 1, 2].forEach(k => est[k] && setTimeout(() => Sonido.play('estrella'), 300 + k * 350));
}

// ======================= Guardado =======================
function guardar() { if (S) escribir('c911_partida', S); }
document.addEventListener('visibilitychange', () => { if (document.hidden) { guardar(); if (S && !mini && !S.pausado) pausa(); } });

// ======================= Menú =======================
function pintarMenu() {
  const g = leer('c911_partida', null);
  $('#continuar').innerHTML = g && NIVELES[g.nivel] ? `<button class="continuar" data-a="continuar"><span>▶</span><div><b>Continuar turno ${g.nivel + 1}: ${esc(NIVELES[g.nivel].titulo)}</b>
    <small>Te quedan ${Math.ceil((DURACION - g.t) / 60)} minutos de turno y llevas ${g.puntos} puntos</small></div></button>` : '';
  const abiertos = P.estrellas.filter(Boolean).length;
  $('#niveles').innerHTML = NIVELES.map((l, i) => {
    const bloq = i > abiertos, e = P.estrellas[i] || 0;
    return `<button class="nivel ${bloq ? 'bloq' : ''} ${i === abiertos ? 'siguiente' : ''}" data-a="brief" data-n="${i}" ${bloq ? 'disabled' : ''}>
      <span class="nivel-n">${i + 1}</span>
      <span class="nivel-txt"><b>${esc(l.titulo)}</b><small>${bloq ? 'Completa el turno anterior para desbloquearlo' : esc(l.nuevo.join(', '))}</small></span>
      <span class="nivel-hora">${String(l.hora).padStart(2, '0')}:00</span>
      <span class="nivel-fin">${bloq ? '🔒' : `<span class="estrellas">${[0, 1, 2].map(k => `<span class="${k < e ? 'on' : ''}">★</span>`).join('')}</span>${P.puntos[i] ? `<small>${P.puntos[i]} pts</small>` : ''}`}</span></button>`;
  }).join('');
  $('#btn-sonido-menu').textContent = Sonido.opciones.sonido ? '🔊 Sonido' : '🔇 Sonido';
  $('#btn-voz-menu').textContent = Sonido.opciones.voz ? '🗣️ Voces' : '🤐 Voces';
  $('#btn-voz-menu').classList.toggle('apagado', !Sonido.opciones.voz); $('#btn-sonido-menu').classList.toggle('apagado', !Sonido.opciones.sonido);
  $('#btn-instalar').hidden = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
}

function brief(i) {
  const l = NIVELES[i];
  abrirCapa(`<div class="informe-cab">Turno ${i + 1}, entrada a las ${String(l.hora).padStart(2, '0')}:00</div><h2>${esc(l.titulo)}</h2>
    <p class="brief-txt"><b>Marta:</b> ${esc(l.intro)}</p>
    <div class="brief-cols"><div><h3>Novedades</h3><ul>${l.nuevo.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>
    <div><h3>Objetivos ★★★</h3><ul><li>Completar el turno (40 min)</li><li>Resolver a tiempo el 60 %</li><li>${esc(l.reto[0])}</li></ul></div>
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
  M.fondo = null; ajustarMapa(); ui();
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
  unidad: d => toggleUnidad(d.id), enviar, 'sel-inc': d => { S.sel = +d.id; S.selU = []; ui(); }, ayuda: abrirAyuda,
  paso: d => elegirPaso(+d.k), rcp: toqueRCP,
  deduce: d => { S.flags.faro = d.l === 'Faro'; S.pausado = false; cerrarCapa(); radio(`Patrulla secreta apostada en: ${d.l}.`, 'Policía'); },
  pausa, reanudar: () => { S.pausado = false; cerrarCapa(); }, menu: salirAlMenu, cerrar: cerrarCapa,
  brief: d => { Sonido.iniciar(); if (S) { S = null; $('#juego').hidden = true; $('#menu').hidden = false; pintarMenu(); } brief(+d.n); },
  empezar: d => { localStorage.removeItem('c911_partida'); nuevaPartida(+d.n); entrarJuego(); },
  continuar: () => { S = leer('c911_partida', null); if (!S) return pintarMenu(); S.pausado = false; entrarJuego(); },
  sonido: () => { Sonido.iniciar(); Sonido.config({ sonido: !Sonido.opciones.sonido }); guardarAjustes(); pintarMenu(); ui(); },
  voz: () => { Sonido.config({ voz: !Sonido.opciones.voz }); guardarAjustes(); pintarMenu(); if (S?.pausado) pausa(); },
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
addEventListener('resize', () => { ajustarMapa(); });
document.fonts?.ready.then(() => { M.fondo = null; });

// ======================= Arranque =======================
const esTablet = () => PRUEBA || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) >= 600);
if (!esTablet()) {
  $('#bloqueo').hidden = false; $('#menu').hidden = true;
} else {
  pintarMenu();
  requestAnimationFrame(t => { ultimo = t; bucle(t); });
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
