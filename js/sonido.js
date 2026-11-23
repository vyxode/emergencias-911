// Sonido sintetizado en tiempo real (Web Audio) y voces de los llamantes (síntesis de voz del sistema).
'use strict';

const Sonido = (() => {
  let ctx = null, master = null, ambiente = null, ruido = null;
  const opciones = { sonido: true, voz: true };

  // El audio solo puede arrancar tras un toque del usuario
  function iniciar() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = opciones.sonido ? 0.8 : 0; master.connect(ctx.destination);
      // Ruido blanco reutilizable
      ruido = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = ruido.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ctx = null; }
  }

  function tono(frec, ini, dur, { tipo = 'sine', vol = 0.2, fin = null, ataque = 0.005, salida = master } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + ini;
    o.type = tipo; o.frequency.setValueAtTime(frec, t);
    if (fin) o.frequency.exponentialRampToValueAtTime(fin, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + ataque); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(salida); o.start(t); o.stop(t + dur + 0.05);
  }
  function soplo(ini, dur, { frec = 1500, q = 1, vol = 0.2, tipo = 'bandpass' } = {}) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime + ini;
    s.buffer = ruido; s.loop = true; f.type = tipo; f.frequency.value = frec; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  const efectos = {
    // Cada línea de la centralita tiene su timbre, para distinguirlas de oído
    timbre(linea = 1) {
      if (linea === 1) for (let r = 0; r < 2; r++) for (let i = 0; i < 16; i++) tono(i % 2 ? 1150 : 920, r * 0.55 + i * 0.025, 0.03, { tipo: 'square', vol: 0.05 });
      else if (linea === 2) for (let i = 0; i < 4; i++) tono(i % 2 ? 1320 : 1100, i * 0.18, 0.14, { tipo: 'triangle', vol: 0.09 });
      else if (linea === 3) for (let r = 0; r < 2; r++) { tono(660, r * 0.5, 0.35, { vol: 0.08 }); tono(880, r * 0.5, 0.35, { vol: 0.06 }); tono(1320, r * 0.5 + 0.02, 0.25, { vol: 0.03 }); }
      else for (let i = 0; i < 3; i++) tono(1480, i * 0.12, 0.08, { tipo: 'sine', vol: 0.08 });
    },
    descolgar() { soplo(0, 0.05, { frec: 3000, vol: 0.3, tipo: 'highpass' }); tono(350, 0.04, 0.12, { vol: 0.05 }); },
    // Tono de ocupado español: 425 Hz cortado
    colgar() { for (let i = 0; i < 3; i++) tono(425, i * 0.4, 0.2, { vol: 0.08 }); },
    tecla() { soplo(0, 0.03, { frec: 4000, vol: 0.12, tipo: 'highpass' }); tono(1800, 0, 0.02, { vol: 0.02 }); },
    radio() { soplo(0, 0.12, { frec: 1800, q: 0.7, vol: 0.18 }); tono(1000, 0.12, 0.08, { tipo: 'square', vol: 0.03 }); soplo(0.2, 0.08, { frec: 2200, vol: 0.1 }); },
    sirena() {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), t = ctx.currentTime;
      o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 1800;
      o.frequency.setValueAtTime(650, t); o.frequency.linearRampToValueAtTime(1350, t + 0.6); o.frequency.linearRampToValueAtTime(650, t + 1.2);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 1.3);
      o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 1.35);
    },
    ok() { tono(1046, 0, 0.35, { vol: 0.12 }); tono(1318, 0.09, 0.45, { vol: 0.12 }); tono(1568, 0.18, 0.6, { vol: 0.1 }); },
    mal() { tono(160, 0, 0.3, { tipo: 'square', vol: 0.06 }); tono(120, 0.12, 0.3, { tipo: 'square', vol: 0.06 }); },
    latido() { tono(90, 0, 0.18, { vol: 0.35, fin: 45 }); },
    pulso() { tono(110, 0, 0.12, { vol: 0.25, fin: 60 }); soplo(0, 0.04, { frec: 900, vol: 0.1 }); },
    estrella() { tono(1568, 0, 0.4, { vol: 0.1 }); tono(2093, 0.06, 0.5, { vol: 0.08 }); },
    // Teléfono sonando en otra mesa, lejos y apagado
    lejano() {
      const f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0.35; f.connect(g).connect(master);
      for (let r = 0; r < 2; r++) for (let i = 0; i < 14; i++) tono(i % 2 ? 1150 : 920, r * 0.5 + i * 0.025, 0.03, { tipo: 'square', vol: 0.02, salida: f });
    },
    // Compañero tecleando en la sala
    teclado() { const n = 6 + Math.floor(Math.random() * 10); for (let i = 0; i < n; i++) soplo(i * (0.07 + Math.random() * 0.09), 0.025, { frec: 2500 + Math.random() * 2000, vol: 0.03, tipo: 'bandpass', q: 3 }); },
    alarma() { for (let i = 0; i < 3; i++) tono(880, i * 0.22, 0.15, { tipo: 'triangle', vol: 0.1 }); },
  };

  function play(nombre, arg) {
    if (!ctx || !opciones.sonido) return;
    try { efectos[nombre](arg); } catch { /* audio no disponible */ }
  }

  // Reproduce la voz neuronal con filtro de teléfono (300-3400 Hz). tasa < 1 la hace más grave.
  let fuenteVoz = null;
  function pcm({ pcm: datos, sr }, tasa = 1) {
    if (!ctx || !opciones.voz) return;
    callar();
    const b = ctx.createBuffer(1, datos.length, sr); b.copyToChannel(datos, 0);
    const s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = b; s.playbackRate.value = tasa;
    hp.type = 'highpass'; hp.frequency.value = 300; lp.type = 'lowpass'; lp.frequency.value = 3400;
    pk.type = 'peaking'; pk.frequency.value = 1700; pk.gain.value = 5; g.gain.value = 1.8;
    s.connect(hp).connect(lp).connect(pk).connect(g).connect(ctx.destination); s.start(); fuenteVoz = s;
  }

  // Zumbido de fondo de la sala (ruido marrón muy suave)
  function ambienteOn(on) {
    if (!ctx) return;
    if (on && !ambiente) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = ruido; s.loop = true; f.type = 'lowpass'; f.frequency.value = 220; g.gain.value = 0.035;
      s.connect(f).connect(g).connect(master); s.start(); ambiente = s;
    } else if (!on && ambiente) { ambiente.stop(); ambiente = null; }
  }

  // Siseo suave de la línea telefónica mientras hay una llamada
  let siseo = null;
  function linea(on) {
    if (!ctx) return;
    if (on && !siseo) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = ruido; s.loop = true; f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8; g.gain.value = 0.012;
      s.connect(f).connect(g).connect(master); s.start(); siseo = s;
    } else if (!on && siseo) { siseo.stop(); siseo = null; }
  }

  // ---- Voces ----
  let voces = [];
  const cargarVoces = () => { voces = window.speechSynthesis ? speechSynthesis.getVoices() : []; };
  if (window.speechSynthesis) { cargarVoces(); speechSynthesis.onvoiceschanged = cargarVoces; }

  function hablar(texto, { ingles = false, tono = 1, prisa = false } = {}) {
    if (!opciones.voz || !window.speechSynthesis) return;
    const limpio = texto.replace(/\([^)]*\)/g, '').trim(); // las acotaciones no se leen
    if (!limpio) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(limpio);
    u.lang = ingles ? 'en-GB' : 'es-ES';
    const v = voces.find(v => v.lang.replace('_', '-').startsWith(ingles ? 'en' : 'es-ES')) || voces.find(v => v.lang.startsWith(ingles ? 'en' : 'es'));
    if (v) u.voice = v;
    u.pitch = tono; u.rate = prisa ? 1.25 : 1.05; u.volume = 1;
    speechSynthesis.speak(u);
  }
  function callar() {
    try { fuenteVoz?.stop(); } catch { /* ya parada */ }
    fuenteVoz = null;
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  function config(o) {
    Object.assign(opciones, o);
    if (master) master.gain.value = opciones.sonido ? 0.8 : 0;
    if (!opciones.voz) callar();
  }

  return { iniciar, play, pcm, ambienteOn, linea, hablar, callar, config, opciones };
})();
