// Reconocimiento de voz del jugador (Web Speech API de Chrome) y su interpretación como pregunta o acción.
'use strict';

const Escucha = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, activa = false;

  // Palabras clave por intención (sin tildes ni mayúsculas). Gana la que más texto coincide.
  const CLAVES = {
    que: ['que pasa', 'que ha pasado', 'que ocurre', 'que sucede', 'que le pasa', 'emergencia', 'cuenteme', 'digame', 'what happened', 'what is going on', 'whats going on', 'emergency', 'tell me'],
    donde: ['donde', 'direccion', 'en que calle', 'calle', 'ubicacion', 'en que sitio', 'where', 'address', 'location'],
    heridos: ['herid', 'sangr', 'lesion', 'alguien mal', 'hurt', 'injur', 'bleeding'],
    peligro: ['arma', 'fuego', 'peligr', 'cuchillo', 'pistola', 'danger', 'weapon', 'fire', 'safe'],
    respira: ['respira', 'conscien', 'despiert', 'le responde', 'breath', 'conscious', 'awake'],
    calma: ['calma', 'tranquil', 'respire hondo', 'relaj', 'no se preocupe', 'estoy con usted', 'calm', 'relax', 'breathe slowly', 'stay with me'],
    sino: ['si o no', 'solo si', 'puede hablar', 'esta usted en peligro', 'yes or no', 'can you talk'],
    ayuda: ['instruc', 'le voy a guiar', 'haga lo que', 'escucheme', 'rcp', 'compresion', 'vamos a hacer', 'instructions', 'listen to me'],
    colgar: ['voy a colgar', 'cuelgo', 'no es una emergencia', 'es una broma', 'hang up', 'prank', 'not an emergency'],
    'x:sosp': ['describ', 'como es', 'como era', 'sospechoso', 'ropa', 'llevaba', 'look like', 'wearing', 'detalles', 'details'],
    'x:huida': ['hacia donde', 'huy', 'escap', 'se fue', 'por donde', 'which way', 'where did', 'ran'],
    'x:edad': ['edad', 'anos tiene', 'cuantos anos', 'how old', 'age'],
    'x:medic': ['medic', 'enfermedad', 'pastilla', 'diabet', 'medication', 'illness'],
    'x:dentro': ['dentro', 'alguien mas', 'queda alguien', 'atrapad', 'inside', 'anyone else'],
    'x:humo': ['humo', 'color', 'smoke'],
    'x:vehic': ['vehiculo', 'coches', 'cuantos coches', 'vehicle', 'cars'],
    'x:via': ['cortad', 'calzada', 'carril', 'road', 'blocked'],
    'x:ver': ['le ve', 'lo ve', 'la ve', 'verle', 'puede ver', 'see him', 'see them', 'can you see'],
    'x:agua': ['agua', 'corriente', 'terreno', 'water', 'current'],
    'x:detalle': ['detalle', 'alguien en peligro', 'details'],
  };
  const normal = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,]/g, ' ').replace(/\s+/g, ' ').trim();

  // Devuelve la intención más probable entre las permitidas y el texto reconocido
  function interpretar(alternativas, permitidas) {
    let mejor = { intencion: null, texto: alternativas[0] || '', puntos: 0 };
    for (const alt of alternativas) {
      const t = ' ' + normal(alt) + ' ';
      for (const k of permitidas) {
        const puntos = (CLAVES[k] || []).filter(p => t.includes(p)).reduce((s, p) => s + p.length, 0);
        if (puntos > mejor.puntos) mejor = { intencion: k, texto: alt, puntos };
      }
    }
    return mejor;
  }

  function empezar(idioma, alResultado, alCambiar) {
    if (!SR || activa) return;
    rec = new SR(); rec.lang = idioma; rec.interimResults = false; rec.maxAlternatives = 4; rec.continuous = false;
    rec.onresult = e => alResultado([...e.results[0]].map(a => a.transcript));
    rec.onend = () => { activa = false; alCambiar?.(); };
    rec.onerror = () => { activa = false; alCambiar?.(); };
    try { rec.start(); activa = true; } catch { activa = false; }
  }
  function parar() { try { rec?.stop(); } catch { /* ya parado */ } }

  return { disponible: !!SR, get activa() { return activa; }, empezar, parar, interpretar, normal };
})();
