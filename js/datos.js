// Datos fijos del juego: mapa de Villaclara, unidades, preguntas, protocolos y niveles.
'use strict';

// ---------- Mapa: cuadrícula de cruces (columna = avenida, fila = calle) ----------
const COLS = 12, FILAS = 8;
const CALLES = ['Calle del Faro', 'Calle Mayor', 'Calle del Sol', 'Calle Real', 'Calle Luna', 'Calle Olivo', 'Calle del Puerto', 'Paseo Marítimo'];
const AVENIDAS = ['Av. Pinar', 'Av. Sierra', 'Av. Libertad', 'Av. Constitución', 'Av. Colón', 'Av. Goya', 'Av. Picasso', 'Av. Lorca', 'Av. Cervantes', 'Av. Industria', 'Av. Fábricas', 'Av. Mar Azul'];
const PUENTES = [2, 5, 8]; // columnas con puente sobre el río (entre filas 5 y 6)

const DISTRITOS = {
  centro: { nombre: 'Centro', color: '#243550' },
  norte: { nombre: 'Barrio Norte', color: '#22393f' },
  poligono: { nombre: 'Polígono', color: '#332c42' },
  puerto: { nombre: 'Puerto', color: '#1f3a4c' },
  bosque: { nombre: 'Sierra del Pinar', color: '#1f3a2a' },
};
function distritoDe(c, r) {
  if (r >= 6) return 'puerto';
  if (c <= 1) return 'bosque';
  if (c >= 10) return 'poligono';
  if (r <= 1) return 'norte';
  return 'centro';
}

// Lugares conocidos: los llamantes los usan como referencia
const LUGARES = [
  ['Ayuntamiento', 3, 2, '🏛️'], ['Mercado Central', 6, 2, '🧺'], ['Parque Central', 6, 4, '🌳'],
  ['Estación de tren', 8, 5, '🚉'], ['Gasolinera', 2, 4, '⛽'], ['Colegio San José', 3, 0, '🏫'],
  ['Polideportivo', 7, 1, '🏟️'], ['Residencia de mayores', 5, 0, '🏠'], ['Fábrica química', 11, 1, '🏭'],
  ['Almacenes Rivas', 10, 4, '📦'], ['Puerto deportivo', 4, 7, '⛵'], ['Lonja', 7, 7, '🐟'],
  ['Playa del Faro', 11, 7, '🏖️'], ['Faro', 10, 6, '🗼'], ['Camping Los Pinos', 0, 2, '🏕️'], ['Mirador', 1, 0, '🔭'],
].map(([nombre, c, r, ic]) => ({ nombre, c, r, ic }));

// Bases de las unidades
const BASES = {
  com: { nombre: 'Comisaría', c: 4, r: 3, ic: '🚔' },
  bom: { nombre: 'Bomberos', c: 7, r: 3, ic: '🚒' },
  hos: { nombre: 'Hospital', c: 5, r: 5, ic: '🏥' },
  bom2: { nombre: 'Bomberos Puerto', c: 9, r: 6, ic: '⚓' },
};

const TIPOS = {
  P: { nombre: 'Policía', ic: '🚓', color: '#3b82f6', vel: 1.0 },
  B: { nombre: 'Bomberos', ic: '🚒', color: '#ef4444', vel: 0.85 },
  A: { nombre: 'Ambulancia', ic: '🚑', color: '#f5f5f5', vel: 0.95 },
  H: { nombre: 'Helicóptero', ic: '🚁', color: '#f59e0b', vel: 2.0 }, // vuela en línea recta
};

// ---------- Preguntas del operador ----------
// El botón muestra la primera frase; en la conversación el operador usa cualquiera de las variantes.
const PREGUNTAS = {
  que: { es: ['¿Qué ha pasado exactamente?', 'Cuénteme qué está ocurriendo.', 'Dígame qué ha pasado, con calma.'], en: ['What happened exactly?', 'Tell me what is going on.'] },
  donde: { es: ['¿Dónde se encuentra exactamente?', '¿Me dice la dirección exacta?', '¿En qué calle está?'], en: ['Where are you exactly?', "What's the exact address?"] },
  heridos: { es: ['¿Hay alguien herido?', '¿Hay heridos?', '¿Alguien necesita atención médica?'], en: ['Is anyone injured?', 'Is anybody hurt?'] },
  peligro: { es: ['¿Hay armas, fuego o algún peligro?', '¿Hay algún peligro en la zona?', '¿Ve armas, fuego o algo peligroso?'], en: ['Are there weapons, fire or any danger?', 'Is there any danger around you?'] },
  respira: { es: ['¿La persona respira y está consciente?', '¿Respira? ¿Le responde?'], en: ['Is the person breathing and conscious?', 'Is the person breathing? Do they respond?'] },
  calma: { es: ['Respire hondo. La ayuda va en camino.', 'Tranquilo, estoy con usted. Respire despacio.', 'Escúcheme: le vamos a ayudar. Respire.'], en: ['Take a deep breath. Help is on the way.', "Stay with me. Breathe slowly, we're helping you."] },
  sino: { es: ['¿Está en peligro? Responda solo sí o no.', 'Si no puede hablar, conteste sí o no: ¿está en peligro?'], en: ['Are you in danger? Just say yes or no.'] },
};

// Preguntas de seguimiento según el tipo de emergencia. Dan información extra para la ficha y unos puntos.
// Cada respuesta se arma al azar con las piezas, así cambia en cada llamada.
const SEGUIMIENTO = {
  policia: [
    ['sosp', '¿Puede describir al sospechoso?', 'Can you describe the suspect?', [
      ['Un hombre de unos', ['20', '30', '40'], 'años,', ['con sudadera negra', 'con chaqueta roja', 'con gorra y gafas de sol', 'con chándal gris'], ['y barba.', 'muy delgado.', 'alto, de casi dos metros.', 'con un tatuaje en el cuello.']],
      ['Una mujer joven,', ['rubia,', 'morena,', 'pelirroja,'], ['con abrigo largo.', 'con mochila azul.', 'en bicicleta.']]],
      [['A man around', ['20', '30', '40'], ['in a black hoodie.', 'wearing a red jacket.', 'with a cap and sunglasses.']]]],
    ['huida', '¿Hacia dónde ha ido?', 'Which way did they go?', [
      ['Se ha ido corriendo hacia', '@calle', '.'], ['Se ha subido a un coche', ['blanco', 'negro', 'rojo'], 'y ha tirado por', '@calle', '.'], ['Sigue aquí, le estoy viendo ahora mismo.']],
      [['They ran towards', '@calle', '.'], ['They are still here, I can see them.']]],
  ],
  medico: [
    ['edad', '¿Qué edad tiene el paciente?', 'How old is the patient?', [['Tiene', ['8', '15', '34', '52', '67', '81'], 'años.']], [['', ['8', '34', '67'], 'years old.']]],
    ['medic', '¿Tiene alguna enfermedad o toma medicación?', 'Any illness or medication?', [
      [['Es diabético.', 'Toma pastillas para la tensión.', 'Tiene asma.', 'Que yo sepa, no.', 'Tuvo un infarto hace dos años.', 'Toma Sintrom, para la sangre.']]],
      [[['He has diabetes.', 'Not that I know.', 'She has asthma.']]]],
  ],
  fuego: [
    ['dentro', '¿Queda alguien dentro?', 'Is anyone still inside?', [[['No, hemos salido todos.', 'Creo que mi vecino del tercero sigue dentro.', 'No lo sé, no he visto salir a la señora del primero.', 'Solo el perro... está en la terraza.']]],
      [[['No, everyone is out.', 'I think my neighbour is still inside.']]]],
    ['humo', '¿De qué color es el humo?', 'What colour is the smoke?', [['Es', ['negro y muy espeso.', 'gris, sale mucho.', 'blanco, pero huele fatal.']]], [['It is', ['black and thick.', 'grey.']]]],
  ],
  trafico: [
    ['vehic', '¿Cuántos vehículos hay implicados?', 'How many vehicles are involved?', [[['Dos coches.', 'Un coche y una moto.', 'Tres coches, uno ha volcado.', 'Una furgoneta y un coche.']]], [[['Two cars.', 'A car and a motorbike.']]]],
    ['via', '¿La calzada está cortada?', 'Is the road blocked?', [[['Sí, no se puede pasar.', 'Un carril está libre.', 'Los coches pasan por la acera, es un caos.']]], [[['Yes, completely.', 'One lane is free.']]]],
  ],
  rescate: [
    ['ver', '¿Puede verle ahora mismo?', 'Can you see them right now?', [[['Sí, sigue agarrado, pero está agotado.', 'Lo veo a ratos, las olas lo tapan.', 'Sí, les veo desde aquí. Hacen señales.']]], [[['Yes, but he is exhausted.', 'Sometimes, the waves hide him.']]]],
    ['agua', '¿Cómo está el agua o el terreno?', 'How is the water or ground?', [[['La corriente es muy fuerte.', 'Hay mucho barro y sigue subiendo.', 'Hay rocas y mucho oleaje.']]], [[['The current is very strong.', 'Big waves and rocks.']]]],
  ],
};
SEGUIMIENTO.mixto = [SEGUIMIENTO.policia[0], SEGUIMIENTO.medico[0]];
SEGUIMIENTO.oculta = [SEGUIMIENTO.policia[0]];
SEGUIMIENTO.falsa = [['sosp', '¿Puede darme más detalles?', 'Can you give me more details?', [[['¡Es verde y tiene alas! Jajaja.', '¿Detalles? Pues... es muy grande. (risas)', 'Ehhh... sí... es que... ¡JAJAJA!']]], [[['It is very... big. Hahaha.']]]]];
SEGUIMIENTO.noemerg = [['detalle', '¿Hay alguien en peligro?', 'Is anyone in danger?', [[['No, no, peligro no. Pero es muy molesto.', 'Hombre, peligro peligro... no.']]], [[['No, not really.']]]]];

// Cómo terminan las llamadas
const DESPEDIDAS = {
  es: ['¡Gracias! Ya oigo las sirenas.', 'Vale, les espero aquí. Muchas gracias.', 'Ya llegan... gracias, de verdad.', 'Gracias. Cuelgo para dejar la línea libre.', 'Vale, vale. Les espero en la puerta.'],
  en: ['Thank you! I can hear the sirens.', "Okay, we'll wait here. Thanks so much.", 'They are coming... thank you.'],
  operador: { es: ['La ayuda va de camino. Si algo cambia, vuelva a llamar.', 'Las unidades están en camino. Quédese en un lugar seguro.', 'Ya van hacia allí. Llámenos si la situación cambia.'], en: ['Help is on the way. Call us again if anything changes.'] },
  broma: { es: ['¡JAJAJAJA! ¡Picaste! (cuelga)', 'Jajaja... ¡adiós, agente! (cuelga)', '(se oyen risas y cuelgan)'], en: ['Hahaha! Gotcha! (hangs up)'] },
  noemerg: { es: ['Bueno, pues nada... ya llamaré a otro sitio. Adiós.', 'Vale, vale... perdone las molestias.'], en: ['Oh... okay. Sorry. Bye.'] },
  oculta: { es: ['(susurra) Gracias... gracias.', '(susurra) Vale. Les espero.'], en: ['(whispers) Thank you...'] },
};

// Modo libre: condiciones que pueden aparecer y desaparecer durante el turno
const CONDICIONES = {
  tormenta: ['Entra un temporal de lluvia: habrá calles inundadas.', 'Deja de llover. Las calles se van secando.'],
  fiesta: ['Empiezan unas fiestas en el Centro: mucha gente y tráfico lento.', 'Terminan las fiestas. El Centro vuelve a la normalidad.'],
  ingles: ['Llega un crucero lleno de turistas: habrá llamadas en inglés.', 'El crucero zarpa. Menos turistas en la ciudad.'],
  calor: ['Ola de calor: más golpes de calor y riesgo de incendios.', 'Bajan las temperaturas.'],
  apagon: ['¡Apagón! El mapa se queda a oscuras.', 'Vuelve la luz.'],
};
// Grandes emergencias que pueden surgir en el modo libre
const GRANDES = ['colegio_incendio', 'autobus_paso', 'fuegos_final', 'forestal', 'estacion_evac', 'nube_toxica', 'en_familia', 'avalancha'];

const RESPUESTAS_DEFECTO = {
  es: {
    heridos: ['No, nadie está herido.', 'No, que yo sepa no.'],
    peligro: ['No, no veo nada peligroso.', 'No, ningún peligro.'],
    respira: ['Eh... aquí nadie está inconsciente.', 'Sí, todos estamos conscientes.'],
    sino: ['¿Cómo? No entiendo la pregunta.'],
    calma: ['Estoy tranquilo, gracias.', 'Sí, sí, estoy bien.'],
    panico: ['¡Por favor, dense prisa!', '¡No puedo pensar, no puedo!', '¡Ayúdenme, por favor!', '¡Dios mío, dios mío!'],
    donde: ['Estoy en {dir}.', 'Es en {dir}. ¡Rápido!', '{dir}.'],
    perdido: ['¡No lo sé! ¡No sé dónde estoy!', 'No conozco la zona... no sé decirle.'],
    calmado: ['Vale... vale. Lo intento.', '(respira) Está bien... ya puedo hablar.'],
  },
  en: {
    heridos: ['No, nobody is hurt.'], peligro: ['No, no danger.'],
    respira: ['Uh... nobody is unconscious here.'], sino: ['Sorry? I don\'t understand.'],
    calma: ["I'm calm, thanks."], panico: ['Please hurry!', "I can't think!", 'Oh my God, please help!'],
    donde: ["I'm at {dir}.", "It's {dir}. Hurry!"],
    perdido: ["I don't know! I don't know where I am!"],
    calmado: ['Okay... okay. I\'ll try.'],
  },
};

// ---------- Protocolos de instrucciones (paso: [lo que dice el llamante, correcta, incorrecta, incorrecta]) ----------
const PROTOCOLOS = {
  incendio: ['Evacuación por incendio', [
    ['¡Hay mucho humo en el pasillo!', 'Salgan agachados: el aire limpio está abajo.', 'Abran todas las ventanas para que entre aire.', 'Cojan lo de valor antes de salir.'],
    ['¡Ya estamos en la escalera!', 'Bajen por la escalera, nunca usen el ascensor.', 'Suban a la azotea en el ascensor.', 'Esperen en el rellano.'],
    ['¡Estamos en la calle!', 'Aléjense del edificio y no vuelvan a entrar.', 'Vuelvan a entrar a cerrar el gas.', 'Quédense en el portal.']]],
  gas: ['Fuga de gas', [
    ['¡Huele muchísimo a gas!', 'No toque interruptores ni enchufes, no encienda nada.', 'Encienda la luz para ver de dónde sale.', 'Use un mechero para buscar la fuga.'],
    ['Vale, no toco nada.', 'Abra puertas y ventanas si puede hacerlo rápido.', 'Cierre todas las ventanas.', 'Llame al timbre de los vecinos.'],
    ['¿Y ahora qué hago?', 'Salga de casa y espere fuera a los bomberos.', 'Quédese dentro esperando.', 'Encienda el extractor de la cocina.']]],
  hemorragia: ['Control de hemorragia', [
    ['¡Sangra muchísimo!', 'Presione fuerte la herida con un paño limpio.', 'Lave la herida con alcohol.', 'Déjela sangrar para que se limpie.'],
    ['¡El paño se ha empapado!', 'No lo quite: ponga otro encima y siga apretando.', 'Quite el paño y mire la herida.', 'Ponga hielo directamente.'],
    ['Sigo apretando...', 'Si es un brazo o una pierna, elévelo y que esté tumbado.', 'Que se levante y camine un poco.', 'Dele una copa para el dolor.']]],
  atragantamiento: ['Atragantamiento', [
    ['¡Se lleva las manos al cuello!', 'Si puede toser, anímele a seguir tosiendo.', 'Dele agua para que trague.', 'Métale los dedos en la boca a ciegas.'],
    ['¡Ya no tose, se pone morado!', 'Dele 5 golpes fuertes entre los omóplatos.', 'Túmbelo boca arriba y espere.', 'Sacúdalo por los pies.'],
    ['¡Sigue sin salir!', 'Colóquese detrás y haga 5 compresiones abdominales hacia arriba.', 'Dele más agua.', 'Espere sin hacer nada.']]],
  parto: ['Asistencia al parto', [
    ['¡Viene ya, veo la cabeza!', 'Que se tumbe boca arriba con las rodillas dobladas.', 'Que se levante y camine.', 'Tire de la cabeza del bebé.'],
    ['¡Ya ha salido!', 'Séquelo y póngalo piel con piel sobre la madre.', 'Corte el cordón con unas tijeras.', 'Póngalo boca abajo y dele una palmada.'],
    ['¿Y el cordón?', 'No lo corte. Mantengan el calor y esperen a la ambulancia.', 'Átelo con un cordón de zapato y córtelo.', 'Tire de él con suavidad.']]],
  lateral: ['Posición lateral de seguridad', [
    ['Respira, pero no se despierta.', 'Póngalo de lado, con la pierna de arriba doblada.', 'Siéntelo en una silla.', 'Dele café para despertarlo.'],
    ['Ya está de lado.', 'Incline su cabeza un poco hacia atrás para que respire bien.', 'Póngale una almohada muy alta.', 'Dele un vaso de agua.'],
    ['¿Lo dejo así?', 'Sí. No lo deje solo y vigile que siga respirando.', 'Vaya a buscar ayuda y déjelo solo.', 'Póngalo boca arriba otra vez.']]],
  quemadura: ['Quemaduras', [
    ['¡Se ha quemado el brazo!', 'Póngalo bajo agua del grifo templada entre 10 y 20 minutos.', 'Ponga hielo directamente.', 'Échele pasta de dientes.'],
    ['Tiene la ropa pegada.', 'No arranque nada que esté pegado a la piel.', 'Arránquela de un tirón.', 'Pinche las ampollas.'],
    ['¿Se la tapo?', 'Cúbrala con un paño limpio, sin apretar.', 'Úntele mantequilla.', 'Tápela con algodón.']]],
  alergia: ['Reacción alérgica grave', [
    ['¡Se le hincha la cara y le cuesta respirar!', 'Si tiene autoinyector de adrenalina, úselo ya en el muslo.', 'Dele un vaso de leche.', 'Que se tumbe boca abajo.'],
    ['¡Ya se lo he puesto!', 'Apunte la hora y déjelo sentado si respira mejor así.', 'Póngale otra dosis enseguida.', 'Dele algo de comer.'],
    ['Parece que respira mejor.', 'Que no se levante ni camine: la ambulancia está cerca.', 'Que se vaya a casa andando.', 'Dele otra vez lo que le sentó mal.']]],
  convulsion: ['Convulsiones', [
    ['¡Está temblando entero en el suelo!', 'Aparte los objetos para que no se golpee. No lo sujete.', 'Sujétele fuerte brazos y piernas.', 'Métale algo en la boca.'],
    ['Sigue convulsionando...', 'Proteja su cabeza con algo blando y mire el reloj.', 'Échele agua fría a la cara.', 'Intente darle de beber.'],
    ['¡Ha parado, pero está como dormido!', 'Póngalo de lado y compruebe que respira.', 'Despiértelo a gritos.', 'Siéntelo de golpe.']]],
  quimico: ['Nube tóxica', [
    ['¡Sale una nube amarilla de la fábrica!', 'Entre en un edificio y cierre puertas y ventanas.', 'Acérquese a mirar qué es.', 'Vaya en coche hacia la nube.'],
    ['Ya estamos dentro.', 'Apague el aire acondicionado y la ventilación.', 'Abra las ventanas para ventilar.', 'Ponga el ventilador.'],
    ['¿Podemos salir ya?', 'No salgan hasta que lo digan las autoridades.', 'Salgan cuando deje de oler.', 'Vayan a la fábrica a ayudar.']]],
  cables: ['Cable eléctrico caído', [
    ['¡Hay un cable en el suelo echando chispas!', 'Aléjese al menos 10 metros y no lo toque.', 'Apártelo con un palo.', 'Písele para que deje de soltar chispas.'],
    ['Se está acercando gente.', 'Avíseles para que no se acerquen.', 'Dígales que lo muevan entre todos.', 'Que lo rieguen con agua.'],
    ['¡Hay un charco al lado!', 'Que nadie pise el agua cercana al cable.', 'Salte el charco para pasar.', 'Eche más agua para enfriarlo.']]],
  escondite: ['Intruso en casa', [
    ['(susurrando) Hay alguien dentro de mi casa...', 'Enciérrese en una habitación y no haga ruido.', 'Salga a enfrentarse a él.', 'Grite para asustarle.'],
    ['(susurrando) Estoy en el baño con el pestillo.', 'Ponga el móvil en silencio y no cuelgue.', 'Ponga música para disimular.', 'Llame a gritos a los vecinos.'],
    ['(susurrando) Oigo pasos...', 'Quédese ahí. No abra a nadie salvo a la policía.', 'Salga a mirar quién es.', 'Abra la ventana y salte.']]],
  calor: ['Golpe de calor', [
    ['¡Está mareado, rojo y ardiendo!', 'Llévelo a la sombra o a un sitio fresco.', 'Abríguelo para que sude.', 'Dele una cerveza fría.'],
    ['Ya estamos a la sombra.', 'Refrésquelo con paños húmedos en cuello, axilas e ingles.', 'Métalo de golpe en agua con hielo.', 'Tápelo con una manta.'],
    ['Ya está más despierto.', 'Dele agua a sorbos si traga bien.', 'Que beba un litro de golpe.', 'Dele un café.']]],
  co: ['Intoxicación por monóxido', [
    ['Estamos todos mareados... el generador está en el garaje.', 'Salgan todos al aire libre ya.', 'Échense un rato a dormir.', 'Cierren la puerta del garaje y quédense.'],
    ['Ya estamos fuera.', 'No vuelvan a entrar, ni para apagar el generador.', 'Entre un momento a apagarlo.', 'Vuelvan a por mantas.'],
    ['Mi abuelo está muy adormilado.', 'Manténgalo al aire libre y vigile que respire.', 'Déjelo dormir dentro, en su cama.', 'Dele un café bien cargado.']]],
};

// ---------- Niveles (40 minutos de turno cada uno) ----------
const DURACION = 2400; // segundos reales por turno

// Turno libre: sin final, con condiciones que cambian. Se completa al crear la partida (nivelLibre en juego.js).
const LIBRE = {
  titulo: 'Turno libre', hora: 20, zonas: ['centro', 'norte', 'poligono', 'puerto', 'bosque'], cada: [42, 66], libre: true,
  unidades: [['P', 'com', 4], ['A', 'hos', 4], ['B', 'bom', 3], ['B', 'bom2', 1], ['H', 'hos', 2]],
  intro: 'Turno sin final en toda Villaclara. Cada pocos minutos cambian las condiciones: tormentas, fiestas, turistas, olas de calor o apagones, y de vez en cuando una gran emergencia. Juega lo que quieras y termina el turno desde la pausa.',
  nuevo: ['Turno infinito', 'Condiciones aleatorias', 'Grandes emergencias'], reto: ['Superar tu récord', () => false], guion: [],
};

// unidades: [tipo, base, cantidad]
const NIVELES = [
  {
    titulo: 'Primer turno', hora: 8, zonas: ['centro'], cada: [55, 80],
    unidades: [['P', 'com', 2], ['A', 'hos', 2]],
    intro: 'Bienvenido a la Central 911 de Villaclara. Soy Marta, tu supervisora. Hoy cubres el Centro con dos patrullas y dos ambulancias. Contesta, pregunta lo justo, localiza y envía. Yo te iré guiando.',
    nuevo: ['Contestar llamadas', 'Policía y ambulancias', 'Centro de la ciudad'],
    reto: ['No colgar ninguna llamada real sin localizarla', s => s.cortadas === 0],
    guion: [{ t: 4, llamada: 'tuto_accidente' }, { t: 1300, llamada: 'remedios_gato' },
      { t: 600, radio: 'Vas muy bien. Recuerda: si preguntas qué pasa, si hay heridos y si hay peligro, el sistema te recomienda unidades.' },
      { t: 1800, radio: 'Queda poco del turno de mañana. Mantén el ritmo.' }],
  },
  {
    titulo: 'Humo en el Norte', hora: 15, zonas: ['centro', 'norte'], cada: [52, 78],
    unidades: [['P', 'com', 2], ['A', 'hos', 2], ['B', 'bom', 2]],
    intro: 'Hoy se une el parque de bomberos y ampliamos al Barrio Norte. Ojo con los incendios y las fugas de gas: mientras llegan los bomberos, puedes dar instrucciones al llamante.',
    nuevo: ['Bomberos', 'Instrucciones de evacuación y gas', 'Barrio Norte'],
    reto: ['Enviar como mucho 3 unidades innecesarias', s => s.innecesarias <= 3],
    guion: [{ t: 30, radio: 'Toca el botón 🩺 Instrucciones cuando el llamante esté en peligro: ganarás tiempo.' },
      { t: 1500, llamada: 'colegio_incendio' }, { t: 1560, radio: '¡Incendio en el Colegio San José! Prioridad máxima.' }],
  },
  {
    titulo: 'Manos que salvan', hora: 22, zonas: ['centro', 'norte'], cada: [50, 75],
    unidades: [['P', 'com', 2], ['A', 'hos', 3], ['B', 'bom', 2]],
    intro: 'Turno de noche con el médico regulador de baja. Te toca guiar primeros auxilios por teléfono: RCP, atragantamientos, hemorragias, partos... Una buena instrucción puede salvar una vida antes de que llegue la ambulancia.',
    nuevo: ['RCP al ritmo correcto', 'Primeros auxilios guiados', 'Tercera ambulancia'],
    reto: ['Calidad media de instrucciones del 70 % o más', s => s.ayudaN > 0 && s.ayudaSum / s.ayudaN >= 0.7],
    guion: [{ t: 20, radio: 'En una parada, las compresiones van a 100-120 por minuto. Sigue el ritmo con el dedo.' },
      { t: 1200, llamada: 'remedios_paco' }],
  },
  {
    titulo: 'El niño que gritó lobo', hora: 16, zonas: ['centro', 'norte', 'poligono'], cada: [48, 72],
    unidades: [['P', 'com', 3], ['A', 'hos', 3], ['B', 'bom', 2]],
    intro: 'Abrimos el Polígono industrial. Además, hoy hay muchas llamadas de broma y otras que no son emergencias: cuélgalas. Pero cuidado: hay personas que piden ayuda disimulando porque no pueden hablar.',
    nuevo: ['Bromas y llamadas no urgentes', 'Llamadas encubiertas (pregunta sí/no)', 'Polígono industrial'],
    reto: ['Detectar 4 bromas y no colgar a nadie en apuros', s => s.bromas >= 4 && s.ocultasCortadas === 0],
    guion: [{ t: 25, radio: 'Si alguien habla raro, como si pidiera una pizza, usa la pregunta de sí o no.' },
      { t: 300, llamada: 'lucas1' }, { t: 900, llamada: 'lucas2' }, { t: 1650, llamada: 'lucas3' }],
  },
  {
    titulo: 'Tormenta', hora: 19, zonas: ['centro', 'norte', 'poligono', 'puerto'], cada: [48, 70], tormenta: true,
    unidades: [['P', 'com', 3], ['A', 'hos', 3], ['B', 'bom', 2], ['B', 'bom2', 1], ['H', 'hos', 1]],
    intro: 'Alerta roja por lluvias. Abrimos el Puerto, con un segundo parque de bomberos y el helicóptero de rescate, que vuela recto y no le afectan las calles. Las calles inundadas (en azul) retrasan a las unidades.',
    nuevo: ['Helicóptero', 'Calles inundadas', 'Puerto y río'],
    reto: ['3 rescates a tiempo con helicóptero', s => s.heliBien >= 3],
    guion: [{ t: 1600, llamada: 'autobus_paso' }, { t: 1610, radio: 'Un autobús atrapado en el paso inferior. Hará falta de todo.' }],
  },
  {
    titulo: 'Fiestas de Villaclara', hora: 21, zonas: ['centro', 'norte', 'poligono', 'puerto'], cada: [45, 68], fiesta: true,
    unidades: [['P', 'com', 4], ['A', 'hos', 3], ['B', 'bom', 2], ['B', 'bom2', 1], ['H', 'hos', 1]],
    intro: 'Noche de fiestas: miles de personas en el Centro, que está cortado al tráfico (calles en violeta, más lentas). Niños perdidos, fuegos artificiales y mucha gente que llama sin motivo.',
    nuevo: ['Centro lleno de gente (rutas lentas)', 'Niños perdidos', 'Fuegos artificiales'],
    reto: ['Dejar sin contestar como mucho 2 llamadas', s => s.perdidas <= 2],
    guion: [{ t: 1100, llamada: 'remedios_bolso' }, { t: 2050, llamada: 'fuegos_final' }, { t: 2040, radio: 'Empieza el castillo de fuegos en el Parque Central. Atentos.' }],
  },
  {
    titulo: 'Turistas', hora: 10, zonas: ['centro', 'norte', 'poligono', 'puerto'], cada: [46, 70], ingles: true,
    unidades: [['P', 'com', 3], ['A', 'hos', 3], ['B', 'bom', 2], ['B', 'bom2', 1], ['H', 'hos', 1]],
    intro: 'Ha llegado un crucero y la ciudad está llena de turistas. Muchas llamadas serán en inglés: las preguntas te aparecerán en inglés. What happened exactly? = ¿Qué ha pasado exactamente?',
    nuevo: ['Llamadas en inglés', 'Atascos aleatorios', 'Playa del Faro'],
    reto: ['Resolver bien 5 llamadas en inglés', s => s.inglesBien >= 5],
    glosario: ['injured = herido', 'breathing = respirando', 'stuck = atrapado', 'wallet = cartera', 'lost = perdido', 'stabbed = apuñalado', 'drowning = ahogándose', 'unconscious = inconsciente'],
    guion: [{ t: 1500, llamada: 'en_familia' }],
  },
  {
    titulo: 'El incendiario', hora: 23, zonas: ['centro', 'norte', 'poligono', 'puerto'], cada: [50, 72],
    unidades: [['P', 'com', 4], ['A', 'hos', 3], ['B', 'bom', 2], ['B', 'bom2', 1], ['H', 'hos', 1]],
    intro: 'Alguien está provocando incendios por la ciudad y deja una letra pintada en cada uno. Escucha bien a testigos y bomberos: si descubres su próximo objetivo, la policía podrá esperarle allí.',
    nuevo: ['Historia: el incendiario', 'Pistas en las llamadas', 'Deducción final'],
    reto: ['Atrapar al incendiario', s => s.detenido > 0],
    guion: [{ t: 200, llamada: 'provocado', lugar: 'Mercado Central', vars: { letra: 'F' } },
      { t: 620, llamada: 'testigo_gorra' },
      { t: 800, llamada: 'provocado', lugar: 'Almacenes Rivas', vars: { letra: 'A' } },
      { t: 1250, llamada: 'provocado', lugar: 'Residencia de mayores', vars: { letra: 'R' } },
      { t: 1600, llamada: 'provocado', lugar: 'Polideportivo', vars: { letra: 'O' } },
      { t: 1700, radio: 'Los bomberos confirman las letras: F, A, R, O. ¿Te dice algo?' },
      { t: 1790, deduccion: true }, { t: 2050, desenlace: true }],
  },
  {
    titulo: 'Fuego en la sierra', hora: 14, zonas: ['centro', 'norte', 'poligono', 'puerto', 'bosque'], cada: [50, 75], forestal: true,
    unidades: [['P', 'com', 3], ['A', 'hos', 3], ['B', 'bom', 3], ['B', 'bom2', 1], ['H', 'hos', 2]],
    intro: 'Ola de calor y viento. Se abre la Sierra del Pinar, con su camping y el mirador. Si se declara un incendio forestal, será una emergencia mayor: necesitará muchas unidades durante mucho tiempo. Reparte bien.',
    nuevo: ['Incendio forestal (emergencia mayor)', 'Segundo helicóptero', 'Sierra del Pinar'],
    reto: ['Controlar el incendio forestal', s => s.mayorOk > 0],
    guion: [{ t: 420, llamada: 'forestal' }, { t: 430, radio: 'Incendio forestal en la sierra. Necesitará al menos 3 dotaciones de bomberos y un helicóptero.' },
      { t: 900, llamada: 'camping_evac' }, { t: 1400, llamada: 'excursionista' }],
  },
  {
    titulo: 'Apagón', hora: 20, zonas: ['centro', 'norte', 'poligono', 'puerto', 'bosque'], cada: [45, 66], apagon: [480, 1950],
    unidades: [['P', 'com', 4], ['A', 'hos', 4], ['B', 'bom', 2], ['B', 'bom2', 2], ['H', 'hos', 1]],
    intro: 'Último turno de Marta antes de jubilarse. Ola de calor, red eléctrica al límite... Si hay apagón, el mapa se quedará a oscuras y solo verás lo que alumbran tus unidades. Todo lo aprendido, junto.',
    nuevo: ['Apagón: mapa a oscuras', 'Todas las mecánicas', 'Final de la historia'],
    reto: ['Ninguna emergencia con resultado grave', s => s.grave === 0],
    guion: [{ t: 470, radio: '¡Se cae la red eléctrica! Seguimos con el generador. El mapa irá a oscuras.' },
      { t: 900, llamada: 'remedios_calor' }, { t: 2000, llamada: 'estacion_evac' },
      { t: 1950, radio: 'Vuelve la luz en el Centro... pero la Estación de tren sigue a oscuras.' }],
  },
];
