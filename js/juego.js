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
  const [tx, ty] = posNodo(destino);
  if (u.tipo === 'H') return Math.hypot(tx - u.x, ty - u.y) / (VEL_BASE * TIPOS.H.vel);
  const desde = u.ruta.length ? u.ruta[0] : u.desde, [dx, dy] = posNodo(desde);
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
      const [bx, by] = posNodo(nodo(b.c, b.r));
      unidades.push({ id: `${tipo}-${num}`, tipo, base, x: bx, y: by, ruta: [], desde: nodo(b.c, b.r), est: 'libre', inc: null });
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
  tip('sonando', 'Suena el teléfono: toca la línea que parpadea, abajo a la izquierda.');
  return true;
}

const rellenar = (s, c) => s.replace(/\{(\w+)\}/g, (_, k) => c.vars[k] ?? '');
const plDe = c => PL[c.pl];
const esReal = p => !['falsa', 'noemerg'].includes(p.tipo);
const lang = c => plDe(c).en ? 'en' : 'es';

function atender(id) {
  if (S.activa) return;
  const c = S.cola.find(x => x.id === id); if (!c) return;
  c.est = 'activa'; S.activa = c.id; c.tA = S.t;
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

function preguntar(q, dicho) {
  const c = activa(); if (!c || c.pend || c.fin) return;
  const p = plDe(c), L = lang(c), D = RESPUESTAS_DEFECTO[L];
  Sonido.play('tecla'); c.nPreg++;
  if (q.startsWith('x:')) { // pregunta de seguimiento
    const s = seguimiento(p, q.slice(2));
    c.log.push({ yo: 1, t: dicho || (L === 'en' ? s[2] : s[1]) });
    if (c.pan > 0) return responder(c, txt(D.panico), null);
    return responder(c, armar(azar(L === 'en' ? s[4] : s[3])), q);
  }
  c.log.push({ yo: 1, t: dicho || azar(PREGUNTAS[q][L]) });
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
  tip('pin', '¡Localizado! Pulsa «Seleccionar recomendadas» y después «Despachar».');
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
    const [tx, ty] = posNodo(u.ruta[0]), dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
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
  const [x, y] = nodoTxt != null ? posNodo(nodoTxt) : [COLS / 2, FILAS / 2];
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
function atasco() { radio(`Atasco en ${nombreArista(cortarAleatorias('atasco', 3, 3)[0])} (en rojo discontinuo).`, 'Radio'); }

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

// ======================= Interfaz (puesto CAD) =======================
const COLOR_SERV = { P: '#4c8dff', A: '#f4f7fb', B: '#ff4d4d', H: '#ffb547' };
const CODIGO = { medico: 'MED', fuego: 'INC', policia: 'POL', trafico: 'TRF', rescate: 'RES', mixto: 'MUL', oculta: 'VIO', falsa: 'INF', noemerg: 'INF' };
const ESCENA = {
  policia: 'Los agentes aseguran la zona y toman declaración.', medico: 'Los sanitarios atienden al paciente.', fuego: 'Los bomberos trabajan para controlar la situación.',
  trafico: 'Se atiende a los heridos y se despeja la calzada.', rescate: 'El equipo de rescate trabaja para sacar a las víctimas.', mixto: 'Varios servicios trabajan juntos en la escena.',
  oculta: 'La policía entra con cuidado y protege a la víctima.',
};
const EST_U = { libre: ['Disponible', 'disp'], vuelta: ['Regresa', 'regr'], ruta: ['En ruta', 'ruta'], escena: ['En escena', 'esc'] };
const numInc = id => `${String(S.nivel === LIBRE_N ? 99 : S.nivel + 1).padStart(2, '0')}-${String(id).padStart(4, '0')}`;
const llamadaDe = inc => S.cola.find(x => x.inc === inc.id);
const conocido = inc => { const c = llamadaDe(inc); return !c || c.preg.que; };
// Prioridad: P1 vida en riesgo ... P4 informativo
const prioridad = inc => { const p = PL[inc.pl]; return !conocido(inc) ? '—' : !esReal(p) ? 'P4' : 'P' + (4 - p.grav); };
const estadoInc = inc => inc.est === 'trabajo' || inc.env.some(id => S.unidades.find(u => u.id === id)?.est === 'escena') ? ['En escena', 'esc'] : inc.env.length ? ['Enviado', 'ruta'] : ['Pendiente', 'pend'];
const etiqueta = inc => { const p = PL[inc.pl], c = llamadaDe(inc); return conocido(inc) ? (c?.preg.sino && p.et2 ? p.et2 : p.et) : 'Sin clasificar'; };

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
  pintarTelefonia(); pintarAli(); pintarEntrevista(); pintarFicha(); pintarCola(); pintarTablero(); pintarRadio();
  const [texto, destino] = pista();
  $('#pista').textContent = texto;
  document.querySelectorAll('.guia').forEach(e => e.classList.remove('guia'));
  if (destino) document.querySelector(destino)?.classList.add('guia');
}

// Botonera telefónica: cuatro líneas de 911 con piloto
function pintarTelefonia() {
  const c = activa();
  setHTML($('#telefonia'), `<span class="tel-et">911</span>` + [1, 2, 3, 4].map(l => {
    const x = S.cola.find(y => y.linea === l);
    if (!x) return `<div class="linea-tel libre"><i class="piloto"></i><span><b>Línea ${l}</b><small>Libre</small></span></div>`;
    if (x.est === 'activa') return `<div class="linea-tel activa"><i class="piloto"></i><span><b>${x.tel}</b><small class="dur-l"></small></span></div>`;
    return `<button class="linea-tel sonando ${c ? 'retenida' : ''}" data-a="atender" data-id="${x.id}"><i class="piloto"></i><span><b>${x.tel}</b><small>${c ? 'En espera' : 'Contestar'}</small></span><i class="espera" data-t0="${x.t0}"></i></button>`;
  }).join('') + `<button class="btn tel-colgar" data-a="${S.confirmar && c ? 'colgar-ya' : 'colgar'}" ${c ? '' : 'disabled'}>${S.confirmar && c ? '¿Sin localizar? Toca otra vez' : '☎ Liberar'}</button>`);
  document.querySelectorAll('#telefonia .espera').forEach(e => { e.style.width = `${Math.max(0, 100 - (S.t - e.dataset.t0) / 55 * 100)}%`; });
  const d = $('.dur-l'); if (d && c) d.textContent = mmss(S.t - c.tA);
}

// ANI/ALI: número, titular, tipo de línea y ubicación (aproximada hasta que el llamante la confirma)
function pintarAli() {
  const c = activa();
  if (!c) return setHTML($('#ali'), `<div class="pane-cab">LLAMANTE <span class="cab-nota">ANI/ALI</span></div><div class="ali vacio">Sin llamada en curso</div>`);
  const p = plDe(c), z = DISTRITOS[distritoDe(...cr(c.nodo))].nombre;
  setHTML($('#ali'), `<div class="pane-cab">LLAMANTE <span class="cab-nota">ANI/ALI</span><span class="cab-der">Línea ${c.linea}</span></div>
    <div class="ali"><div><span>Número</span><b class="mono">${c.tel}</b></div><div><span>Titular</span><b>${esc(c.nom)}</b></div>
    <div><span>Clase</span><b>${p.en ? 'Móvil roaming (UK)' : c.linea % 2 ? 'Móvil, fase II' : 'Fijo residencial'}</b></div><div><span>Idioma</span><b>${p.en ? 'Inglés' : 'Español'}</b></div>
    <div class="ancho"><span>Ubicación</span><b class="${c.preg.donde ? 'ok' : 'aprox'}">${c.preg.donde ? '📍 ' + esc(c.vars.dir) : `Aproximada: ${z}, radio ±${150 + (c.id * 37) % 250} m`}</b></div></div>`);
}

function pintarEntrevista() {
  const el = $('#entrevista'), c = activa();
  if (!c) {
    return setHTML(el, `<div class="pane-cab">ENTREVISTA</div><div class="sin-llamada"><div class="auriculares">🎧</div><p>Puesto libre</p>
      <small>${S.cola.length ? 'Hay líneas sonando: contesta abajo.' : 'Las llamadas entrantes parpadean en la botonera de abajo.'}</small></div>`);
  }
  const p = plDe(c), L = lang(c);
  const log = c.log.map(l => `<div class="linea ${l.yo ? 'yo' : 'el'}"><span>${l.yo ? 'OPERADOR' : 'LLAMANTE'}</span>${esc(l.t)}</div>`).join('') + (c.pend ? '<div class="linea el escribiendo"><i></i><i></i><i></i></div>' : '');
  const base = ['que', 'donde', 'heridos', 'peligro', 'respira', 'calma', ...(S.nivel >= 3 ? ['sino'] : [])].filter(q => q === 'calma' || !c.preg[q]);
  const extra = c.preg.que ? c.extra.filter(k => !c.preg['x:' + k]).map(k => { const s = seguimiento(p, k); return [`x:${k}`, L === 'en' ? s[2] : s[1]]; }) : [];
  const ops = [...base.map(q => [q, PREGUNTAS[q][L][0]]), ...extra];
  const puedeAyudar = p.ayuda && c.preg.que && !c.ayuda && c.pan === 0;
  setHTML(el, `<div class="pane-cab">ENTREVISTA <span class="onda" aria-hidden="true">${'<i></i>'.repeat(7)}</span>
      <span class="cab-der">${c.pan > 0 ? '<span class="chip rojo">Muy nervioso</span>' : '<span class="chip verde">Colabora</span>'}</span></div>
    <div class="transcripcion" id="trans">${log}</div>
    <div class="opciones ${c.pend || c.fin ? 'esperando' : ''}">
      ${ops.map(([q, t]) => `<button class="op ${q === 'calma' && c.pan > 0 ? 'urge' : ''} ${q.startsWith('x:') ? 'extra' : ''}" data-a="preguntar" data-q="${q}">${esc(t)}</button>`).join('')}
    </div>
    <div class="acciones">
      ${Escucha.disponible ? `<button class="btn hablar" id="btn-hablar" data-hablar="1">🎙 Mantén para hablar</button>` : ''}
      ${puedeAyudar ? `<button class="btn ayuda" data-a="ayuda">🩺 ${esc(p.ayuda === 'rcp' ? 'Guiar RCP' : PROTOCOLOS[p.ayuda][0])}</button>` : ''}
    </div>`);
  el.querySelector('.onda').classList.toggle('habla', !!(c.pend || S.t < (c.habla || 0)));
  const b = $('#btn-hablar'); if (b) b.classList.toggle('escuchando', Escucha.activa);
  const t = $('#trans'); if (t && t._n !== c.log.length + !!c.pend) { t._n = c.log.length + !!c.pend; t.scrollTop = t.scrollHeight; }
}

// Ficha del incidente seleccionado: datos, recomendación, unidades asignadas y despacho
function pintarFicha() {
  const inc = S.inc.find(i => i.id === S.sel);
  if (!inc) return setHTML($('#ficha'), `<div class="pane-cab">INCIDENTE</div><div class="ficha-vacia">Selecciona un incidente en la cola o en el mapa.</div>`);
  const p = PL[inc.pl], c = llamadaDe(inc), pr = prioridad(inc), k = conocido(inc);
  const dato = (q, v) => !c || c.preg[q] ? esc(c ? rellenar(v, c) : v) : '<span class="falta">Sin preguntar</span>';
  const completa = c && c.preg.que && c.preg.heridos && c.preg.peligro && (p.tipo !== 'oculta' || c.preg.sino) || (S.nivel < 2 && c?.preg.que);
  const rec = !c ? '' : !completa ? '<span class="falta">Completa la entrevista (qué pasa, heridos y peligro) para ver la recomendación</span>'
    : p.rec ? esc(p.rec) : p.tipo === 'falsa' ? '⚠️ Datos poco creíbles: ¿es una broma? Si lo es, libera la línea.' : Object.entries(p.nec).map(([t, n]) => `<span class="serv" style="--c:${COLOR_SERV[t]}">${TIPOS[t].ic} ${TIPOS[t].nombre} ×${n}</span>`).join('') +
      (faltanTipos(inc).length ? '<button class="btn btn-recomendadas" data-a="recomendadas">✔ Seleccionar recomendadas</button>' : '');
  const asignadas = inc.env.map(id => {
    const u = S.unidades.find(x => x.id === id), [e, cl] = EST_U[u.est];
    return `<span class="asig ${cl}">${TIPOS[u.tipo].ic} <b>${u.id}</b> ${e}${u.est === 'ruta' ? ` ${Math.round(eta(u, inc.nodo))} s` : ''}<button data-a="retirar" data-id="${u.id}" aria-label="Retirar ${u.id}">✕</button></span>`;
  }).join('');
  const prog = inc.est === 'trabajo' ? Math.min(1, 1 - (inc.fin - S.t) / (p.trabajo || 6 + 4 * p.grav)) : 0;
  const resto = Math.max(0, inc.lim - (S.t - inc.t0)), n = S.selU.length;
  setHTML($('#ficha'), `<div class="pane-cab">INCIDENTE <b class="mono">${numInc(inc.id)}</b>
      <span class="cab-der"><span class="prio ${pr}">${pr}</span><span class="chip ${inc.est === 'trabajo' ? 'verde' : resto ? 'ambar' : 'rojo'}">${inc.est === 'trabajo' ? 'En curso' : resto ? '⏱ ' + Math.ceil(resto) + ' s' : 'Retrasado'}</span></span></div>
    <div class="ficha">
      <div class="ancho"><span>Tipo</span><b>${k ? `<span class="cod">${CODIGO[p.tipo]}</span> ${p.ic} ${esc(etiqueta(inc))}` : '<span class="falta">Sin clasificar</span>'}</b></div>
      <div class="ancho"><span>Ubicación</span><b>📍 ${esc(inc.dir)}</b></div>
      <div><span>Heridos</span><b>${dato('heridos', p.fh || 'Ninguno')}</b></div><div><span>Peligro</span><b>${dato('peligro', p.fp || 'Ninguno')}</b></div>
      ${c?.notas.length ? `<div class="ancho"><span>Notas</span>${c.notas.map(x => `<b class="nota-l">· ${esc(x)}</b>`).join('')}</div>` : ''}
      <div class="ancho"><span>Recomendación</span><div class="rec">${rec}</div></div>
      ${inc.env.length ? `<div class="ancho"><span>Unidades asignadas</span><div class="asignadas">${asignadas}</div>${inc.est === 'trabajo' ? `<p class="escena-t">${esc(ESCENA[p.tipo] || ESCENA.mixto)}</p><div class="progreso"><i style="width:${Math.round(prog * 100)}%"></i></div>` : ''}</div>` : ''}
    </div>
    <button class="btn enviar" data-a="enviar" ${n ? '' : 'disabled'}>${n ? `🚨 Despachar ${S.selU.join(', ')}` : 'Elige unidades en el tablero o en el mapa'}</button>`);
}

// Cola de incidentes abiertos
// Tipos de unidad que aún faltan por enviar a un incidente
function faltanTipos(inc) {
  const env = {}; inc.env.forEach(id => { env[id[0]] = (env[id[0]] || 0) + 1; });
  return Object.entries(inc.nec).flatMap(([t, n]) => Array(Math.max(0, n - (env[t] || 0))).fill(t));
}
// Elige las unidades disponibles más rápidas de los tipos que faltan
function seleccionarRecomendadas() {
  const inc = S.inc.find(i => i.id === S.sel); if (!inc) return;
  const sel = [];
  for (const t of faltanTipos(inc)) {
    const u = S.unidades.filter(x => x.tipo === t && disponible(x) && !sel.includes(x.id)).sort((a, b) => eta(a, inc.nodo) - eta(b, inc.nodo))[0];
    if (u) sel.push(u.id);
  }
  if (!sel.length) return radio('No quedan unidades disponibles de ese tipo. Espera a que alguna quede libre.', 'Central');
  S.selU = sel; Sonido.play('tecla'); ui();
}

// Siguiente paso recomendado: se muestra arriba y se resalta el botón correspondiente
function pista() {
  const c = activa(), sel = S.inc.find(i => i.id === S.sel);
  if (c) {
    const p = plDe(c), inc = S.inc.find(i => i.id === c.inc);
    if (c.fin || c.pend) return ['Escucha al llamante…', null];
    if (c.pan > 0) return ['Está muy nervioso: tranquilízale antes de preguntar', '[data-q="calma"]'];
    if (!c.preg.que) return ['Pregunta qué ha pasado', '[data-q="que"]'];
    if (!c.preg.donde || (p.des && !c.inc)) return ['Pregunta dónde está', '[data-q="donde"]'];
    if (!c.preg.heridos) return ['Pregunta si hay heridos', '[data-q="heridos"]'];
    if (!c.preg.peligro) return ['Pregunta si hay peligro', '[data-q="peligro"]'];
    if (!esReal(p)) return ['Si no es una emergencia real, libera la línea', '.tel-colgar'];
    if (p.tipo === 'oculta' && !c.preg.sino && S.nivel >= 3) return ['Si habla de forma extraña, usa la pregunta de sí o no', '[data-q="sino"]'];
    if (inc && S.sel !== inc.id) return ['Toca el incidente de esta llamada en la cola', '#cola-inc tr.pend'];
    if (inc && !inc.env.length) return S.selU.length ? ['Pulsa Despachar', '.enviar'] : ['Pulsa «Seleccionar recomendadas»', '.btn-recomendadas'];
    if (p.ayuda && !c.ayuda) return ['Guía al llamante mientras llega la ayuda', '.btn.ayuda'];
    return ['La ayuda va en camino. El llamante colgará solo', null];
  }
  if (S.cola.some(x => x.est === 'sonando')) return ['Contesta la línea que parpadea', '#telefonia .sonando'];
  if (sel && faltanTipos(sel).length && conocido(sel) && esReal(PL[sel.pl])) return S.selU.length ? ['Pulsa Despachar', '.enviar'] : ['Faltan unidades: pulsa «Seleccionar recomendadas»', '.btn-recomendadas'];
  if (S.inc.some(i => !i.env.length && esReal(PL[i.pl]))) return ['Hay incidentes pendientes: tócalos en la cola', '#cola-inc tr.pend'];
  return ['Todo en orden. Espera la próxima llamada', null];
}

function pintarCola() {
  const filas = S.inc.map(i => {
    const pr = prioridad(i), tarde = i.est === 'abierto' && S.t - i.t0 > i.lim;
    return `<tr class="${i.id === S.sel ? 'sel' : ''} ${tarde ? 'tarde' : ''} ${estadoInc(i)[1]}" data-a="sel-inc" data-id="${i.id}"><td class="mono">${String(i.id).padStart(4, '0')}</td><td><span class="prio ${pr}">${pr}</span></td>
      <td>${conocido(i) ? `<span class="cod">${CODIGO[PL[i.pl].tipo]}</span> ${esc(etiqueta(i))}` : '<span class="falta">Sin clasificar</span>'}</td>
      <td><span class="est-i ${estadoInc(i)[1]}">${estadoInc(i)[0]}</span></td><td class="mono">${mmss(S.t - i.t0)}</td></tr>`;
  }).join('');
  setHTML($('#cola-inc'), `<div class="pane-cab">COLA DE INCIDENTES <span class="cab-der">${S.inc.length} abiertos</span></div>
    <div class="tabla-caja"><table class="tabla"><thead><tr><th>Nº</th><th>P</th><th>Tipo</th><th>Estado</th><th>T</th></tr></thead><tbody>${filas || '<tr><td colspan="5" class="falta">Sin incidentes abiertos</td></tr>'}</tbody></table></div>`);
}

// Tablero de estado de unidades
function pintarTablero() {
  const inc = S.inc.find(i => i.id === S.sel);
  const filas = S.unidades.map(u => {
    const [e, cl] = EST_U[u.est], i = S.inc.find(x => x.id === u.inc);
    const info = u.est === 'ruta' && i ? `${Math.round(eta(u, i.nodo))} s` : inc && disponible(u) ? `≈${Math.round(eta(u, inc.nodo))} s` : BASES[u.base].nombre;
    return `<tr class="${S.selU.includes(u.id) ? 'sel' : ''} ${disponible(u) ? '' : 'ocupada'}" data-a="unidad" data-id="${u.id}"><td><span class="u-tipo" style="--c:${COLOR_SERV[u.tipo]}">${TIPOS[u.tipo].ic}</span><b>${u.id}</b></td>
      <td><span class="est-u ${cl}">${e}</span></td><td class="mono">${i ? String(i.id).padStart(4, '0') : '—'}</td><td>${info}</td></tr>`;
  }).join('');
  setHTML($('#tablero'), `<div class="pane-cab">UNIDADES <span class="cab-der">${S.unidades.filter(disponible).length}/${S.unidades.length} disponibles</span></div>
    <div class="tabla-caja"><table class="tabla"><thead><tr><th>Unidad</th><th>Estado</th><th>Inc.</th><th>${inc ? 'Llegada' : 'Base'}</th></tr></thead><tbody>${filas}</tbody></table></div>`);
}

function pintarRadio() {
  const r = S.radio.slice(-4).reverse();
  const canal = q => /^P-|Policía/.test(q) ? 'POL' : /^B-/.test(q) ? 'BOM' : /^A-|^H-/.test(q) ? 'SAN' : 'CEN';
  setHTML($('#radio'), `<span class="tel-et">RADIO</span><div class="radio-log">${r.map((m, i) => `<div class="radio-l ${i ? '' : 'nueva'}"><span class="mono">${m.h}</span><span class="canal ${canal(m.quien)}">${canal(m.quien)}</span><b>${esc(m.quien)}:</b> ${esc(m.t)}</div>`).join('')}</div>`);
}

// ======================= Mapa con cámara (zoom y arrastre) =======================
const cv = $('#mapa'), cx = cv.getContext('2d');
let M = { w: 0, h: 0, celda: 40, ox: 0, oy: 0, cX: 40, cY: 40, fondo: null, clave: '' };
const cam = { z: 1, x: 0, y: 0 };
const ZMAX = 3.5;
const base = (c, r) => [M.ox + c * M.cX, M.oy + r * M.cY];
const px = (c, r) => { const [x, y] = base(c, r); return [x * cam.z + cam.x, y * cam.z + cam.y]; };

function ajustarMapa() {
  const caja = $('#mapa-caja'), dpr = Math.min(2, devicePixelRatio || 1), w = caja.clientWidth, h = caja.clientHeight;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  M.w = w; M.h = h; M.dpr = dpr;
  const arriba = 34, abajo = 44, lados = 30;
  M.cX = (w - lados * 2) / (COLS - 1); M.cY = (h - arriba - abajo) / (FILAS - 1);
  M.cX = Math.min(M.cX, M.cY * 1.45); M.cY = Math.min(M.cY, M.cX * 1.3);
  M.celda = Math.min(M.cX, M.cY);
  M.ox = (w - M.cX * (COLS - 1)) / 2; M.oy = arriba + (h - arriba - abajo - M.cY * (FILAS - 1)) / 2;
  limitarCam();
}

function limitarCam() {
  cam.z = Math.max(1, Math.min(ZMAX, cam.z));
  const [x0, y0] = base(-1, -1), [x1, y1] = base(COLS, FILAS);
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
  const [bx, by] = base(...posNodo(n)), visible = M.w;
  cam.objetivo = { x: visible / 2 - bx * cam.z, y: M.h / 2 - by * cam.z };
}

// Capas que cambian con el nivel: barrios fuera de servicio y rótulos (se dibujan encima del mapa base)
function dibujarBase() {
  if (!MAPA.lienzo) generarBase();
  const { MARGEN } = MAPA, [x0, y0] = px(-MARGEN, -MARGEN), [x1, y1] = px(COLS - 1 + MARGEN, FILAS - 1 + MARGEN);
  cx.fillStyle = '#0d2a47'; cx.fillRect(0, 0, M.w, M.h);
  cx.imageSmoothingQuality = 'high'; cx.drawImage(MAPA.lienzo, x0, y0, x1 - x0, y1 - y0);
  // Barrios cerrados en este turno: oscurecidos
  cx.fillStyle = 'rgba(4,7,13,0.72)';
  for (const m of MANZANAS) if (!N().zonas.includes(m.zona)) { cx.beginPath(); m.esq.forEach((p, i) => cx[i ? 'lineTo' : 'moveTo'](...px(...p))); cx.closePath(); cx.fill(); }
}

function rotulo(t, x, y, tam, color = '#cdd7e8', ang = 0, peso = 500) {
  cx.save(); cx.translate(x, y); cx.rotate(ang); cx.font = `${peso} ${tam}px Barlow, system-ui`;
  cx.lineJoin = 'round'; cx.strokeStyle = 'rgba(8,12,20,0.9)'; cx.lineWidth = 3.5; cx.strokeText(t, 0, 0); cx.fillStyle = color; cx.fillText(t, 0, 0); cx.restore();
}

function dibujarRotulos() {
  const z = cam.z, C = M.celda * z;
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  // Nombres de calles siguiendo su dirección; con poco zoom, solo las principales
  const vistos = new Set();
  for (const [a, b] of ARISTAS) {
    const prin = esPrincipal(a, b), [ca, ra] = cr(a), [cb] = cr(b), horiz = ca !== cb;
    const nombre = horiz ? CALLES[ra] : AVENIDAS[ca];
    if (!zonaOk(a) || !zonaOk(b) || (z < 1.5 && !prin)) continue;
    const idx = horiz ? ca : ra, cada = z >= 2.2 ? 2 : 4;
    if ((idx + (horiz ? ra : ca)) % cada || vistos.has(nombre + idx)) continue;
    vistos.add(nombre + idx);
    const [x1, y1] = px(...posNodo(a)), [x2, y2] = px(...posNodo(b));
    let ang = Math.atan2(y2 - y1, x2 - x1); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    rotulo(nombre, (x1 + x2) / 2, (y1 + y2) / 2, Math.max(10, Math.min(14, C * 0.13)), prin ? '#e6d6a8' : '#cdd7e8', ang);
  }
  // Agua y barrios
  rotulo('Río Clara', ...px(2.6, rioY(2.6)), Math.max(11, C * 0.14), '#7fb2e0', 0, 600);
  rotulo('Mar Mediterráneo', ...px(5.5, 8.05), Math.max(12, C * 0.18), '#6fa0cf', 0, 600);
  [['centro', 5.5, 3.5], ['norte', 5.5, 0.5], ['poligono', 10.5, 2.5], ['puerto', 6, 6.5], ['bosque', 0.5, 3]].forEach(([zn, c, r]) => {
    const [x, y] = px(c, r), abierta = N().zonas.includes(zn);
    rotulo((abierta ? '' : '🔒 ') + DISTRITOS[zn].nombre.toUpperCase(), x, y, Math.max(12, C * (abierta ? 0.2 : 0.17)), abierta ? 'rgba(220,230,245,0.35)' : 'rgba(220,230,245,0.55)', 0, 700);
  });
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
  const z = cam.z, C = M.celda * z, K = M.celda * (0.7 + 0.2 * z), ahora = performance.now() / 1000;
  dibujarBase();
  for (const [k, v] of Object.entries(S.cortes)) {
    const [a, b] = k.split('-').map(Number), [x1, y1] = px(...posNodo(a)), [x2, y2] = px(...posNodo(b));
    // Inundada: azul; atasco: rojo discontinuo; gente de fiestas: violeta discontinuo
    cx.strokeStyle = v.tipo === 'agua' ? `rgba(56,152,255,${0.6 + 0.15 * Math.sin(ahora * 3)})` : v.tipo === 'gente' ? 'rgba(200,120,255,0.55)' : 'rgba(255,70,70,0.75)';
    cx.lineWidth = C * (v.tipo === 'agua' ? 0.12 : 0.06); cx.lineCap = 'butt'; cx.setLineDash(v.tipo === 'agua' ? [] : [C * 0.08, C * 0.06]);
    cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke(); cx.setLineDash([]);
  }
  dibujarRotulos();
  // Puntos de interés: chincheta circular con icono y nombre
  for (const l of LUGARES) {
    if (!zonaOk(nodo(l.c, l.r))) continue;
    const [nx, ny] = posNodo(nodo(l.c, l.r)), [x, y] = px(nx + 0.3, ny - 0.3), r = Math.max(9, K * 0.13);
    cx.fillStyle = 'rgba(240,244,250,0.92)'; cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
    cx.font = `${r * 1.15}px system-ui`; cx.fillStyle = '#000'; cx.fillText(l.ic, x, y + 1);
    rotulo(l.nombre, x, y + r + 9, Math.max(10, K * 0.12), '#f0f4fa', 0, 600);
  }
  for (const k of new Set(S.unidades.map(u => u.base))) {
    const b = BASES[k], [x, y] = px(...posNodo(nodo(b.c, b.r))), r = K * 0.3;
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
    cx.strokeStyle = COLOR_SERV[u.tipo]; cx.beginPath(); cx.moveTo(...px(u.x, u.y)); u.ruta.forEach(n => cx.lineTo(...px(...posNodo(n)))); cx.stroke();
  }
  cx.setLineDash([]);
  // Avisos
  const porNodo = {};
  for (const inc of S.inc) {
    const k = porNodo[inc.nodo] = (porNodo[inc.nodo] || 0) + 1;
    const [bx, by] = px(...posNodo(inc.nodo)), x = bx + (k - 1) * K * 0.42;
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
  // Zona aproximada de la llamada en curso mientras no se confirma la dirección
  const ca = activa();
  if (ca && !ca.inc) {
    const [nx, ny] = posNodo(ca.nodo), [x, y] = px(nx + ((ca.id * 7) % 5 - 2) * 0.15, ny + ((ca.id * 3) % 5 - 2) * 0.15), r = C * 1.3;
    cx.fillStyle = 'rgba(255,181,71,0.08)'; cx.strokeStyle = 'rgba(255,181,71,0.7)'; cx.setLineDash([8, 6]); cx.lineWidth = 2;
    cx.beginPath(); cx.arc(x, y, r * (1 + 0.04 * Math.sin(ahora * 3)), 0, 7); cx.fill(); cx.stroke(); cx.setLineDash([]);
    cx.font = `600 ${Math.max(11, K * 0.12)}px Barlow, system-ui`; cx.fillStyle = '#ffb547'; cx.fillText('Ubicación aproximada de la llamada', x, y - r - 10);
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
const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
cv.addEventListener('pointerdown', e => {
  if (!S) return;
  const q = pos(e); cv.setPointerCapture(e.pointerId); toques.set(e.pointerId, q);
  cam.objetivo = null;
  if (toques.size === 1) gesto = { tipo: 'tap', x0: q.x, y0: q.y, cx0: cam.x, cy0: cam.y };
  else if (toques.size === 2) {
    const [a, b] = [...toques.values()];
    gesto = { tipo: 'pinza', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx0: cam.x, cy0: cam.y };
  }
});
cv.addEventListener('pointermove', e => {
  if (!toques.has(e.pointerId) || !gesto) return;
  const q = pos(e); toques.set(e.pointerId, q);
  if (gesto.tipo === 'pinza' && toques.size === 2) {
    const [a, b] = [...toques.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const z = Math.max(1, Math.min(ZMAX, gesto.z0 * d / gesto.d0));
    cam.z = z; cam.x = mx - (gesto.mx - gesto.cx0) * z / gesto.z0; cam.y = my - (gesto.my - gesto.cy0) * z / gesto.z0; limitarCam();
  } else if (gesto.tipo === 'tap' || gesto.tipo === 'arrastre') {
    const dx = q.x - gesto.x0, dy = q.y - gesto.y0;
    if (gesto.tipo === 'tap' && Math.hypot(dx, dy) > 10) gesto.tipo = 'arrastre';
    if (gesto.tipo === 'arrastre') { cam.x = gesto.cx0 + dx; cam.y = gesto.cy0 + dy; limitarCam(); }
  }
});
function finToque(e) {
  if (!toques.has(e.pointerId)) return;
  toques.delete(e.pointerId);
  if (gesto?.tipo === 'tap' && !toques.size) {
    const { x, y } = pos(e), ahora = performance.now();
    if (ahora - ultimoTap.t < 320 && Math.hypot(x - ultimoTap.x, y - ultimoTap.y) < 40) { zoomEn(1.7, x, y); ultimoTap.t = 0; }
    else { ultimoTap = { t: ahora, x, y }; tocarMapa(x, y); }
  }
  if (!toques.size) gesto = null; else if (gesto?.tipo === 'pinza') gesto = { tipo: 'nada' };
}
cv.addEventListener('pointerup', finToque);
cv.addEventListener('pointercancel', finToque);
cv.addEventListener('wheel', e => { e.preventDefault(); const q = pos(e); zoomEn(e.deltaY < 0 ? 1.15 : 1 / 1.15, q.x, q.y); }, { passive: false });

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
  S.sel = id;
  Sonido.play('tecla'); ui(); centrarEn(inc.nodo);
}
function destello() { const d = $('#destello'); d.classList.remove('on'); void d.offsetWidth; d.classList.add('on'); }

// ======================= Hablar con el llamante =======================
// Mantener pulsado el micrófono: lo dicho se interpreta como una de las preguntas o acciones disponibles
function procesarVoz(alternativas) {
  const c = activa(); if (!c || c.pend || c.fin) return;
  const p = plDe(c), opciones = ['que', 'donde', 'heridos', 'peligro', 'respira', 'calma', 'colgar', ...(S.nivel >= 3 ? ['sino'] : []),
    ...(c.preg.que ? c.extra.map(k => 'x:' + k) : []), ...(p.ayuda && c.preg.que && !c.ayuda && c.pan === 0 ? ['ayuda'] : [])];
  const { intencion, texto } = Escucha.interpretar(alternativas, opciones);
  const dicho = texto.charAt(0).toUpperCase() + texto.slice(1);
  if (intencion === 'ayuda') { c.log.push({ yo: 1, t: dicho }); return abrirAyuda(); }
  if (intencion === 'colgar') return colgar(false);
  if (intencion) return preguntar(intencion, dicho);
  c.log.push({ yo: 1, t: dicho });
  responder(c, lang(c) === 'en' ? azar(["Sorry? I didn't understand.", 'What? Can you repeat that?']) : azar(['¿Perdone? No le he entendido.', '¿Cómo? ¿Puede repetirlo?', 'No le oigo bien... ¿qué me dice?']), null);
  ui();
}
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('[data-hablar]') || !activa()) return;
  e.preventDefault(); Sonido.callar();
  Escucha.empezar(lang(activa()) === 'en' ? 'en-US' : 'es-ES', procesarVoz, () => ui());
  ui();
});
addEventListener('pointerup', () => Escucha.activa && Escucha.parar());
addEventListener('pointercancel', () => Escucha.activa && Escucha.parar());

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
  cam.z = 1; cam.x = 0; cam.y = 0; cam.objetivo = null;
  ajustarMapa(); ui();
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
  unidad: d => toggleUnidad(d.id), enviar, retirar: d => retirar(d.id), 'sel-inc': d => seleccionar(+d.id), ayuda: abrirAyuda, recomendadas: seleccionarRecomendadas,
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
new ResizeObserver(() => { if (S) ajustarMapa(); }).observe($('#mapa-caja'));

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
