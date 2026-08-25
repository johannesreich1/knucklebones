import type { CatalogShape } from '../../catalog-shape.ts';
import { enLearn } from '../en/learn.ts';

export const itLearn = {
  tutorial: {
    welcome: "Benvenuto in Knucklebones! La tua griglia è quella IN BASSO. Riempila prima dell'IA: vince il totale più alto.",
    lesson1: 'Hai ottenuto un 4. Le capsule + mostrano quanto segnerebbe ogni colonna: toccane una per piazzarlo.',
    lesson2: 'Un altro 4! Dadi uguali nella stessa colonna moltiplicano: due 4 valgono 16, non 8. Impilalo sul primo.',
    lesson3: "Hai ottenuto un 5 e l'IA ne ha uno nella colonna centrale. Mettilo nella TUA colonna centrale per distruggerlo!",
    lesson4: 'Ecco tutto: impila i doppioni e distruggi quelli avversari. Termina il round: vince il totale più alto.',
  },
  hub: {
    title: 'COME SI GIOCA',
    tutorial: 'Tutorial',
    tutorialBlurb: 'Una prima partita guidata — cinque lezioni da giocare',
    rules: 'Le regole',
    rulesBlurb: 'Punteggio, distruzione e fine della partita',
    modes: 'Modalità di gioco',
    modesBlurb: 'Tutte le modalità del selettore e cosa cambia ciascuna',
    runes: 'Rune',
    runesBlurb: 'Ogni potere, i bersagli e il numero di usi',
  },
  rules: {
    title: 'REGOLE',
    goal: {
      heading: 'Obiettivo',
      body: 'Riempi di dadi la tua griglia 3×3. Quando <b>una delle due</b> è piena, la partita finisce: vince il totale più alto.',
    },
    placing: {
      heading: 'Piazzamento',
      body: 'Lanci un dado e tocchi una delle <b>tue</b> colonne per piazzarlo. Non puoi scegliere il lancio, solo dove finisce.',
    },
    multipliers: {
      heading: 'Moltiplicatori di colonna',
      body: 'Dadi uguali nella stessa colonna moltiplicano. Due 4 in una colonna = <b>4×2×2 = 16</b>, non 8. Tre 4 = <b>4×3×3 = 36</b>.',
    },
    destruction: {
      heading: 'Distruzione',
      body: 'Piazzando un dado, <span class="k">tutti i dadi uguali nella colonna avversaria di fronte vengono distrutti</span>. Le colonne sono allineate in verticale: la tua colonna sinistra è di fronte alla colonna sinistra avversaria.',
    },
    reading: {
      heading: 'Leggere il tabellone',
      body: 'Le tessere accanto alle colonne mostrano il punteggio e <b>×2</b>/<b>×3</b> indicano una pila moltiplicata. Trovare la mossa migliore fa parte del gioco, ma il <b>tutorial</b> guida un round mostrando i punti previsti su ogni colonna.',
    },
    runes: {
      heading: 'Rune',
      body: 'Le partite offline possono dare una <b>runa</b> accanto al dado; ce ne sono sei nella configurazione, sotto la modalità di gioco. <b>Nessuna</b> è la scelta predefinita; quelle con nome e <b>casuale</b> danno la stessa runa a entrambi, mentre <b>casuale 2</b> ne estrae due diverse. Le carte di ogni giocatore restano visibili. Un bordo del suo colore indica il proprietario e la mano attiva passa davanti a ogni turno. Premi una runa che agisce sul dado per usarla subito; trascina o tocca una runa di colonna e poi una colonna illuminata. Usare una runa non è una mossa, quindi dopo piazzi ancora il dado. La lista completa è in <b>COME SI GIOCA → RUNE</b>. Le partite classificate non usano mai rune.',
    },
    twoPlayers: {
      heading: 'Due giocatori',
      body: 'Scegli <b>2 GIOCATORI</b> per condividere un telefono e indica come siete seduti. <b>Passa telefono</b>: tra i turni appare una carta e le griglie si scambiano per mettere in basso chi gioca. <b>Faccia a faccia</b>: posa il telefono tra voi; la metà superiore ruota per il Giocatore 2, i turni cambiano da soli e la metà luminosa con il dado centrale rotante mostra chi gioca.',
    },
  },
  library: {
    gameModes: 'MODALITÀ DI GIOCO',
    runes: 'RUNE',
    openMode: 'Apri le regole di {{name}}',
    openRune: 'Apri i dettagli di {{name}}',
  },
  firstRun: {
    title: 'Prima volta?',
    body: 'Il tutorial è una partita guidata con cinque lezioni pratiche. Dura circa un minuto e appare una volta sola.',
    play: 'Gioca il tutorial',
    startTutorial: 'Avvia tutorial',
    skip: 'Salta, conosco le regole',
  },
} satisfies CatalogShape<typeof enLearn>;
