// Plano de Villaclara: geometría de calles y dibujo del mapa base (edificios, parques, río, mar, puerto...).
// El mapa base se pinta una sola vez en alta resolución y luego solo se escala y desplaza: así el zoom es nítido y fluido.
'use strict';

// Generador pseudoaleatorio con semilla: la ciudad sale siempre igual
function semilla(s) { return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Los cruces se desplazan un poco para que las calles no sean una cuadrícula perfecta
const DESVIO = (() => { const r = semilla(1911); return Array.from({ length: COLS * FILAS }, () => [(r() - 0.5) * 0.24, (r() - 0.5) * 0.22]); })();
const posNodo = n => { const c = n % COLS, f = Math.floor(n / COLS); return [c + DESVIO[n][0], f + DESVIO[n][1]]; };

const ARISTAS = [];
for (let r = 0; r < FILAS; r++) for (let c = 0; c < COLS; c++) {
  if (c < COLS - 1) ARISTAS.push([r * COLS + c, r * COLS + c + 1]);
  if (r < FILAS - 1 && (r !== 5 || PUENTES.includes(c))) ARISTAS.push([r * COLS + c, (r + 1) * COLS + c]);
}
// Vías principales: más anchas y de otro color, como en un plano real
const esPrincipal = (a, b) => { const ca = a % COLS, ra = Math.floor(a / COLS), cb = b % COLS, rb = Math.floor(b / COLS); return ra === rb ? [1, 3, 7].includes(ra) : ca === cb && [3, 6, 9].includes(ca); };

// Manzanas: cuadriláteros entre cuatro cruces (la fila 5 es el río)
const MANZANAS = [];
for (let r = 0; r < FILAS - 1; r++) for (let c = 0; c < COLS - 1; c++) {
  if (r === 5) continue;
  const esq = [r * COLS + c, r * COLS + c + 1, (r + 1) * COLS + c + 1, (r + 1) * COLS + c].map(posNodo);
  MANZANAS.push({ c, r, esq, zona: distritoDe(c + (c >= 9 ? 1 : 0), r + (r >= 5 ? 1 : 0)) });
}
// Punto dentro de una manzana por interpolación bilineal (u, v entre 0 y 1)
const enManzana = (m, u, v) => {
  const [a, b, c, d] = m.esq;
  return [(a[0] * (1 - u) + b[0] * u) * (1 - v) + (d[0] * (1 - u) + c[0] * u) * v, (a[1] * (1 - u) + b[1] * u) * (1 - v) + (d[1] * (1 - u) + c[1] * u) * v];
};
const rioY = x => 5.5 + 0.1 * Math.sin(x * 1.1 + 0.6);
const costaY = x => 7.5 + 0.07 * Math.sin(x * 1.7) + 0.04 * Math.sin(x * 4.1);

// Manzanas especiales (columna, fila de la manzana)
const ESPECIAL = { '5,3': 'parque', '6,3': 'parque', '7,0': 'deporte', '3,0': 'colegio', '6,1': 'mercado', '2,2': 'plaza', '8,4': 'estacion', '0,2': 'camping', '10,0': 'quimica', '10,1': 'quimica', '4,4': 'hospital' };

const MAPA = { MARGEN: 1.3, SC: 180, lienzo: null };

function generarBase() {
  const { MARGEN, SC } = MAPA, R = semilla(911);
  const W = Math.round((COLS - 1 + MARGEN * 2) * SC), H = Math.round((FILAS - 1 + MARGEN * 2) * SC);
  const lz = document.createElement('canvas'); lz.width = W; lz.height = H;
  const g = lz.getContext('2d');
  const P = (x, y) => [(x + MARGEN) * SC, (y + MARGEN) * SC];
  const poli = (pts, relleno, borde, grosor = 1) => {
    g.beginPath(); pts.forEach((p, i) => { const [x, y] = P(...p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
    if (relleno) { g.fillStyle = relleno; g.fill(); }
    if (borde) { g.strokeStyle = borde; g.lineWidth = grosor; g.stroke(); }
  };
  const rect = (m, u0, v0, u1, v1) => [enManzana(m, u0, v0), enManzana(m, u1, v0), enManzana(m, u1, v1), enManzana(m, u0, v1)];
  const arbol = (x, y, r) => { const [px, py] = P(x, y); g.fillStyle = `hsl(${135 + R() * 20}, ${28 + R() * 12}%, ${16 + R() * 8}%)`; g.beginPath(); g.arc(px, py, r * SC, 0, 7); g.fill(); };

  // Suelo
  g.fillStyle = '#161d29'; g.fillRect(0, 0, W, H);
  // Sierra al oeste: monte bajo con textura
  for (let i = 0; i < 900; i++) { const x = -MARGEN + R() * (2.6 + MARGEN), y = -MARGEN + R() * (6.6 + MARGEN); arbol(x, y, 0.05 + R() * 0.06); }

  // Manzanas según el barrio
  for (const m of MANZANAS) {
    const tipo = ESPECIAL[`${m.c},${m.r}`] || m.zona, i0 = 0.11, i1 = 0.89;
    poli(rect(m, 0.06, 0.06, 0.94, 0.94), tipo === 'bosque' || tipo === 'camping' ? '#18291f' : tipo === 'norte' ? '#1a2620' : '#1d2433');
    if (tipo === 'parque' || tipo === 'camping') {
      poli(rect(m, i0, i0, i1, i1), tipo === 'parque' ? '#1d3a26' : '#1b3121');
      g.setLineDash([10, 8]); poli([enManzana(m, i0, 0.5), enManzana(m, i1, 0.5)], null, '#3c4a3a', 4); poli([enManzana(m, 0.5, i0), enManzana(m, 0.5, i1)], null, '#3c4a3a', 4); g.setLineDash([]);
      for (let k = 0; k < 40; k++) { const [x, y] = enManzana(m, i0 + R() * (i1 - i0), i0 + R() * (i1 - i0)); arbol(x, y, 0.035 + R() * 0.04); }
      if (tipo === 'camping') for (let k = 0; k < 10; k++) { const [x, y] = enManzana(m, 0.25 + R() * 0.5, 0.25 + R() * 0.5), [px, py] = P(x, y); g.fillStyle = ['#c0602e', '#2e7ac0', '#c0b02e'][k % 3]; g.beginPath(); g.moveTo(px, py - 10); g.lineTo(px - 9, py + 7); g.lineTo(px + 9, py + 7); g.fill(); }
      else { const [x, y] = enManzana(m, 0.5, 0.5); arbol(x, y, 0.001); const [px, py] = P(x, y); g.fillStyle = '#2a5a7a'; g.beginPath(); g.arc(px, py, SC * 0.07, 0, 7); g.fill(); }
      continue;
    }
    if (tipo === 'deporte' || tipo === 'colegio') {
      poli(rect(m, i0, i0, i1, i1), '#22332a');
      const campo = tipo === 'deporte' ? rect(m, 0.18, 0.2, 0.82, 0.8) : rect(m, 0.5, 0.2, 0.86, 0.75);
      poli(campo, tipo === 'deporte' ? '#2a5a35' : '#8a4a32', '#d8e6d8aa', 2);
      poli([enManzana(m, tipo === 'deporte' ? 0.5 : 0.68, tipo === 'deporte' ? 0.2 : 0.2), enManzana(m, tipo === 'deporte' ? 0.5 : 0.68, tipo === 'deporte' ? 0.8 : 0.75)], null, '#d8e6d8aa', 2);
      if (tipo === 'colegio') poli(rect(m, i0, i0, 0.44, i1), '#3a3f52', '#4b5168', 2);
      continue;
    }
    if (tipo === 'plaza') {
      poli(rect(m, i0, i0, i1, i1), '#2a2f3c');
      for (let k = 0; k < 6; k++) { const [x, y] = enManzana(m, 0.2 + (k % 3) * 0.3, k < 3 ? 0.22 : 0.78); arbol(x, y, 0.05); }
      const [x, y] = enManzana(m, 0.5, 0.5), [px, py] = P(x, y); g.strokeStyle = '#4a7aa0'; g.lineWidth = 4; g.beginPath(); g.arc(px, py, SC * 0.09, 0, 7); g.stroke();
      continue;
    }
    if (tipo === 'mercado' || tipo === 'hospital' || tipo === 'estacion') {
      poli(rect(m, i0, i0, i1, i1), tipo === 'hospital' ? '#2f3a4e' : '#343747', '#4a5068', 2);
      for (let k = 1; k < 6; k++) poli([enManzana(m, i0 + k * (i1 - i0) / 6, i0), enManzana(m, i0 + k * (i1 - i0) / 6, i1)], null, '#ffffff10', 2);
      if (tipo === 'hospital') { const [x, y] = enManzana(m, 0.5, 0.5), [px, py] = P(x, y); g.fillStyle = '#c94a4a'; g.fillRect(px - 14, py - 4, 28, 8); g.fillRect(px - 4, py - 14, 8, 28); }
      continue;
    }
    if (tipo === 'quimica') {
      poli(rect(m, i0, i0, i1, i1), '#262b36');
      for (let k = 0; k < 4; k++) { const [x, y] = enManzana(m, 0.28 + (k % 2) * 0.44, 0.3 + Math.floor(k / 2) * 0.4), [px, py] = P(x, y); g.fillStyle = '#5a6272'; g.strokeStyle = '#8a92a2'; g.lineWidth = 2; g.beginPath(); g.arc(px, py, SC * 0.12, 0, 7); g.fill(); g.stroke(); }
      continue;
    }
    if (tipo === 'bosque') { for (let k = 0; k < 60; k++) { const [x, y] = enManzana(m, R(), R()); arbol(x, y, 0.04 + R() * 0.05); } continue; }
    if (tipo === 'poligono') { // naves industriales con cubierta a dos aguas
      const n = R() < 0.5 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const u0 = i0 + k * (i1 - i0) / n + 0.02, u1 = i0 + (k + 1) * (i1 - i0) / n - 0.02;
        poli(rect(m, u0, i0 + 0.04, u1, i1 - 0.04), '#3a4152', '#525a6e', 2);
        poli([enManzana(m, u0, 0.5), enManzana(m, u1, 0.5)], null, '#ffffff14', 3);
      }
      continue;
    }
    if (tipo === 'puerto') { // contenedores de colores y almacenes
      poli(rect(m, i0, i0, i1, i1), '#232a37');
      for (let a = 0; a < 5; a++) for (let b = 0; b < 3; b++) if (R() > 0.25) poli(rect(m, 0.15 + a * 0.15, 0.2 + b * 0.22, 0.27 + a * 0.15, 0.34 + b * 0.22), ['#8a3b2e', '#2e5a8a', '#8a7a2e', '#3a7a4a', '#6a3a7a'][Math.floor(R() * 5)]);
      continue;
    }
    // Centro y Norte: parcelas con edificios, el Norte con jardines y casas más pequeñas
    const nu = m.zona === 'norte' ? 4 : 3 + Math.floor(R() * 2), nv = m.zona === 'norte' ? 3 : 2 + Math.floor(R() * 2);
    for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
      const u0 = i0 + a * (i1 - i0) / nu, u1 = i0 + (a + 1) * (i1 - i0) / nu, v0 = i0 + b * (i1 - i0) / nv, v1 = i0 + (b + 1) * (i1 - i0) / nv;
      const gap = m.zona === 'norte' ? 0.035 : 0.012;
      const pts = rect(m, u0 + gap, v0 + gap, u1 - gap, v1 - gap);
      const tono = m.zona === 'norte' ? 30 + R() * 8 : 24 + R() * 10;
      // sombra desplazada para dar volumen
      g.save(); g.translate(5, 6); poli(pts, '#0b0f17'); g.restore();
      poli(pts, `hsl(220, 16%, ${tono}%)`, `hsl(220, 18%, ${tono + 8}%)`, 1.5);
      if (m.zona !== 'norte' && R() < 0.25) poli(rect(m, u0 + 0.06, v0 + 0.06, u1 - 0.06, v1 - 0.06), `hsl(220, 16%, ${tono - 6}%)`); // patio interior
    }
  }

  // Vía del tren que llega a la estación
  g.strokeStyle = '#4a4f5c'; g.lineWidth = 7; g.beginPath(); g.moveTo(...P(6.2, 4.62)); g.lineTo(...P(COLS - 1 + MARGEN, 4.62)); g.stroke();
  g.strokeStyle = '#8a8f9c'; g.setLineDash([3, 9]); g.lineWidth = 11; g.beginPath(); g.moveTo(...P(6.2, 4.62)); g.lineTo(...P(COLS - 1 + MARGEN, 4.62)); g.stroke(); g.setLineDash([]);

  // Río con orillas
  const franja = (fy, ancho) => { const arriba = [], abajo = []; for (let x = -MARGEN; x <= COLS - 1 + MARGEN; x += 0.1) { arriba.push([x, fy(x) - ancho]); abajo.unshift([x, fy(x) + ancho]); } return [...arriba, ...abajo]; };
  poli(franja(rioY, 0.3), '#2a3a2e'); poli(franja(rioY, 0.24), '#0f3050'); poli(franja(rioY, 0.12), '#123a60');
  // Mar al sur, playa y espuma
  const mar = []; for (let x = -MARGEN; x <= COLS - 1 + MARGEN; x += 0.1) mar.push([x, costaY(x)]);
  poli([...mar.filter(p => p[0] > 8.6).map(([x, y]) => [x, y - 0.18]), [COLS - 1 + MARGEN, FILAS + MARGEN], [8.6, FILAS + MARGEN]], '#8a7a52');
  poli([...mar, [COLS - 1 + MARGEN, FILAS + MARGEN], [-MARGEN, FILAS + MARGEN]], '#0d2a47');
  g.strokeStyle = '#2f5f8a'; g.lineWidth = 3; g.beginPath(); mar.forEach(([x, y], i) => { const [px, py] = P(x, y + 0.03); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke();
  // Muelles del puerto deportivo y de la lonja, con barcos
  for (const [cx0, largo] of [[3.6, 0.9], [4.4, 0.7], [6.8, 1.0]]) {
    poli([[cx0, costaY(cx0) - 0.02], [cx0 + 0.08, costaY(cx0) - 0.02], [cx0 + 0.08, costaY(cx0) + largo], [cx0, costaY(cx0) + largo]], '#4a4f5c');
    for (let k = 0; k < 4; k++) { const [px, py] = P(cx0 + 0.16, costaY(cx0) + 0.15 + k * 0.18); g.fillStyle = '#d8dde8'; g.beginPath(); g.ellipse(px, py, 12, 5, 0, 0, 7); g.fill(); }
  }

  // Calles: borde oscuro y asfalto; las principales más anchas
  const tramo = (a, b) => { g.beginPath(); g.moveTo(...P(...posNodo(a))); g.lineTo(...P(...posNodo(b))); g.stroke(); };
  g.lineCap = 'round';
  for (const pass of [0, 1, 2]) for (const [a, b] of ARISTAS) {
    const prin = esPrincipal(a, b), puente = Math.floor(a / COLS) === 5 && Math.floor(b / COLS) === 6;
    const ancho = (prin ? 0.13 : 0.085) * SC;
    if (pass === 0) { g.strokeStyle = puente ? '#6a7080' : '#0c1018'; g.lineWidth = ancho + (puente ? 10 : 6); }
    else if (pass === 1) { g.strokeStyle = prin ? '#5b5034' : '#363f50'; g.lineWidth = ancho; }
    else { if (!prin) continue; g.strokeStyle = '#a08a4a66'; g.lineWidth = 2; g.setLineDash([14, 14]); }
    tramo(a, b); g.setLineDash([]);
  }
  // Árboles de alineación en las avenidas principales
  for (const [a, b] of ARISTAS) if (esPrincipal(a, b) && Math.floor(a / COLS) !== Math.floor(b / COLS)) {
    const [x1, y1] = posNodo(a), [x2, y2] = posNodo(b);
    for (let t = 0.2; t < 0.9; t += 0.2) { arbol(x1 + (x2 - x1) * t + 0.1, y1 + (y2 - y1) * t, 0.03); arbol(x1 + (x2 - x1) * t - 0.1, y1 + (y2 - y1) * t, 0.03); }
  }
  MAPA.lienzo = lz;
}
