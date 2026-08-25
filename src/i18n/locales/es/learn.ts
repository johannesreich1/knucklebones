import type { CatalogShape } from '../../catalog-shape.ts';
import { enLearn } from '../en/learn.ts';

export const esLearn = {
  tutorial: {
    welcome: '¡Te damos la bienvenida a Knucklebones! Tu cuadrícula es la de ABAJO. Llénala antes que la IA — gana el total más alto.',
    lesson1: 'Has sacado un 4. Las cápsulas + muestran cuánto sumaría cada columna; toca una para colocar el dado.',
    lesson2: '¡Otro 4! Los dados iguales de una columna multiplican: dos 4 suman 16, no 8. Apílalo sobre el primero.',
    lesson3: 'Has sacado un 5 y la IA tiene otro en su columna central. ¡Ponlo en TU columna central para destruir el suyo!',
    lesson4: 'Eso es todo: apila iguales y destruye los suyos. Termina la ronda — gana el total más alto.',
  },
  hub: {
    title: 'CÓMO JUGAR',
    tutorial: 'Tutorial',
    tutorialBlurb: 'Una primera partida guiada — cinco lecciones prácticas',
    rules: 'Las reglas',
    rulesBlurb: 'Puntuación, destrucción y cómo termina una partida',
    modes: 'Modos de juego',
    modesBlurb: 'Todos los modos del selector y lo que cambia cada uno',
    runes: 'Runas',
    runesBlurb: 'Cada poder, sus objetivos y cuántos usos tienes',
  },
  rules: {
    title: 'REGLAS',
    goal: {
      heading: 'Objetivo',
      body: 'Llena tu cuadrícula 3×3 con dados. Cuando <b>cualquiera</b> se llena, la partida termina; gana el total más alto.',
    },
    placing: {
      heading: 'Colocación',
      body: 'Tiras un dado y tocas una de <b>tus</b> columnas para colocarlo. No puedes elegir la tirada, solo dónde cae.',
    },
    multipliers: {
      heading: 'Multiplicadores de columna',
      body: 'Los dados iguales de una columna multiplican. Dos 4 en una columna = <b>4×2×2 = 16</b>, no 8. Tres 4 = <b>4×3×3 = 36</b>.',
    },
    destruction: {
      heading: 'Destrucción',
      body: 'Al colocar un dado, <span class="k">se destruyen todos los dados iguales de la columna rival enfrentada</span>. Las columnas se alinean en vertical: tu columna izquierda se enfrenta a la izquierda rival.',
    },
    reading: {
      heading: 'Cómo leer el tablero',
      body: 'Las fichas junto a las columnas muestran su puntuación y <b>×2</b>/<b>×3</b> señalan una pila multiplicada. Encontrar la mejor jugada es parte del juego, pero el <b>tutorial</b> guía una ronda con una vista previa de puntos en cada columna.',
    },
    runes: {
      heading: 'Runas',
      body: 'Las partidas sin conexión pueden dar una <b>runa</b> junto al dado; puedes elegir entre seis runas en la configuración, bajo el modo de juego. <b>Ninguna</b> es la opción predeterminada; las opciones con nombre y <b>aleatoria</b> dan la misma runa a ambos, mientras <b>aleatoria 2</b> sortea dos distintas. La pila de cartas de cada jugador permanece visible. Un borde de su color marca al dueño y la mano activa pasa delante cada turno. Pulsa una runa que actúe sobre el dado para usarla al instante; arrastra o toca una runa de columna y luego una columna iluminada. Usar una runa no es una jugada, así que después aún colocas el dado. La lista completa está en <b>CÓMO JUGAR → RUNAS</b>. Las partidas clasificatorias nunca usan runas.',
    },
    twoPlayers: {
      heading: 'Dos jugadores',
      body: 'Elige <b>2 JUGADORES</b> para compartir un teléfono y decide cómo sentarse. <b>Pasar teléfono</b>: aparece una tarjeta entre turnos y las cuadrículas cambian para dejar abajo a quien juega. <b>Cara a cara</b>: deja el teléfono plano entre ambos; la mitad superior gira para el Jugador 2, los turnos cambian solos y la mitad iluminada con el dado central giratorio muestra quién juega.',
    },
  },
  library: {
    gameModes: 'MODOS DE JUEGO',
    runes: 'RUNAS',
    openMode: 'Abrir reglas de {{name}}',
    openRune: 'Abrir detalles de {{name}}',
  },
  firstRun: {
    title: '¿Es tu primera vez?',
    body: 'El tutorial es una partida guiada con cinco lecciones prácticas. Dura cerca de un minuto y solo aparece una vez.',
    play: 'Jugar el tutorial',
    startTutorial: 'Iniciar tutorial',
    skip: 'Omitir, ya conozco las reglas',
  },
} satisfies CatalogShape<typeof enLearn>;
