# Central 911

Simulador de operador de emergencias para **tablet Android en horizontal**. Contestas llamadas, sacas los datos al llamante, localizas la emergencia en el mapa de Villaclara y envías policía, bomberos, ambulancias o helicóptero. Mientras llegan, puedes guiar por teléfono una RCP, un parto o una evacuación.

**Jugar:** https://vyxode.github.io/emergencias-911/

## Instalar en la tablet

1. Abre el enlace en **Chrome** de la tablet.
2. Pulsa **📲 Instalar en la tablet** en el menú del juego (o menú ⋮ de Chrome → *Instalar aplicación*).
3. Se abre a pantalla completa, en horizontal, y funciona sin conexión.

El juego solo funciona en tablets táctiles: en móviles y ordenadores muestra un aviso.

## Campaña

10 turnos de unos 40 minutos. Cada uno añade algo nuevo:

| Turno | Novedad |
|---|---|
| 1. Primer turno | Lo básico, guiado por Marta, la supervisora |
| 2. Humo en el Norte | Bomberos, evacuaciones y fugas de gas |
| 3. Manos que salvan | RCP al ritmo correcto y primeros auxilios |
| 4. El niño que gritó lobo | Bromas, llamadas no urgentes y víctimas que piden ayuda disimulando |
| 5. Tormenta | Helicóptero, calles inundadas y el puerto |
| 6. Fiestas de Villaclara | Centro lleno de gente, niños perdidos, fuegos artificiales |
| 7. Turistas | Llamadas en inglés |
| 8. El incendiario | Historia de investigación con deducción final |
| 9. Fuego en la sierra | Incendio forestal: emergencia mayor de larga duración |
| 10. Apagón | Mapa a oscuras y todas las mecánicas juntas |

Cada turno da hasta 3 estrellas. La partida se guarda sola cada pocos segundos: puedes cerrar y seguir después.

## Estructura

```
index.html            Página y estructura de la interfaz
css/estilos.css       Estilos (consola de despacho)
js/datos.js           Mapa, unidades, preguntas, protocolos y niveles
js/escenarios.js      Plantillas de llamadas (unas 90)
js/sonido.js          Sonido sintetizado y voces de los llamantes
js/juego.js           Motor: llamadas, rutas, despacho, minijuegos y guardado
sw.js                 Service worker (juego sin conexión)
manifest.webmanifest  Datos de la app instalable
fuentes/              Barlow y Barlow Condensed (licencia SIL OFL, ver fuentes/OFL.txt)
```

## Añadir contenido

- **Nueva llamada:** añade un objeto a `PLANTILLAS` en `js/escenarios.js` (los campos están explicados al principio del archivo).
- **Nuevo nivel:** añade un objeto a `NIVELES` en `js/datos.js`.
- Al publicar cambios, sube `VERSION` en `sw.js` para que las tablets instaladas descarguen la versión nueva.

## Pruebas en ordenador

Para probar en un ordenador: `?prueba` salta el aviso de solo tablet y `?vel=20` acelera el tiempo. Ejemplo: `index.html?prueba&vel=20`.
