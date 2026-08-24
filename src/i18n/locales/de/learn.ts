import type { CatalogShape } from '../../catalog-shape.ts';
import { enLearn } from '../en/learn.ts';

export const deLearn = {
  tutorial: {
    welcome: 'Willkommen bei Knucklebones! Dein Raster ist UNTEN. Fülle es mit Würfeln, bevor die KI ihres füllt — die höchste Summe gewinnt.',
    lesson1: 'Du hast eine 4 gewürfelt. Die +Anzeigen zeigen die mögliche Spaltenwertung — tippe eine Spalte an.',
    lesson2: 'Noch eine 4! Gleiche Würfel in einer Spalte multiplizieren sich: Zwei 4er zählen 16 statt 8. Staple sie auf die erste 4.',
    lesson3: 'Du hast eine 5 — und die KI hat eine 5 in der mittleren Spalte. Lege deine in DEINE mittlere Spalte, um ihre zu zerstören!',
    lesson4: 'Bumm. Das ist das ganze Spiel: Gleiche stapeln, gegnerische zerschlagen. Beende die Runde — die höchste Summe gewinnt.',
  },
  hub: {
    title: 'SPIELREGELN',
    tutorial: 'Tutorial',
    tutorialBlurb: 'Ein geführtes erstes Spiel — fünf Lektionen, gespielt statt gelesen',
    rules: 'Die Regeln',
    rulesBlurb: 'Wertung, Zerstörung und das Ende eines Spiels',
    modes: 'Spielmodi',
    modesBlurb: 'Alle möglichen Modi und was sie verändern',
    runes: 'Runen',
    runesBlurb: 'Alle Kräfte, ihre Ziele und ihre Einsätze',
  },
  rules: {
    title: 'REGELN',
    goal: {
      heading: 'Ziel',
      body: 'Fülle dein 3×3-Raster mit Würfeln. Sobald <b>eines</b> der Raster voll ist, endet das Spiel — die höchste Summe gewinnt.',
    },
    placing: {
      heading: 'Platzieren',
      body: 'Du würfelst und tippst dann eine <b>deiner</b> Spalten an, um den Würfel abzulegen. Du bestimmst nicht den Wurf, sondern nur seinen Platz.',
    },
    multipliers: {
      heading: 'Spaltenmultiplikatoren',
      body: 'Gleiche Würfel in derselben Spalte multiplizieren sich. Zwei 4er in einer Spalte = <b>4×2×2 = 16</b>, nicht 8. Drei 4er = <b>4×3×3 = 36</b>.',
    },
    destruction: {
      heading: 'Zerstörung',
      body: 'Beim Platzieren eines Würfels wird <span class="k">jeder gleiche Würfel in der gegenüberliegenden Spalte des Gegners zerstört</span>. Die Spalten liegen senkrecht gegenüber — deine linke Spalte trifft die linke des Gegners.',
    },
    reading: {
      heading: 'Das Feld lesen',
      body: 'Die Anzeigen neben jeder Spalte zeigen ihre laufende Wertung, und <b>×2</b>/<b>×3</b> kennzeichnet einen multiplizierten Stapel. Den besten Platz zu finden ist das Spiel — das <b>Tutorial</b> führt dich jedoch mit Punktevorschauen durch eine Runde.',
    },
    runes: {
      heading: 'Runen',
      body: 'Offline-Spiele können eine <b>Rune</b> neben dem aktuellen Würfel austeilen — sechs stehen im Offline-Setup direkt unter dem Spielmodus zur Wahl. <b>Keine</b> ist Standard; <b>Zufall</b> zieht eine gemeinsame Rune, <b>Zufall 2</b> mischt zweimal und gibt jedem Spieler eine andere Rune. Beide Runenkarten bleiben sichtbar, Spielerfarben zeigen ihre Besitzer. Tippe eine Rune, die auf deinen Würfel wirkt, um sie sofort einzusetzen; ziehe oder tippe eine Spaltenrune auf eine leuchtende Spalte. Ein Einsatz ist kein Zug, dein Würfel landet also danach noch. Die vollständige Übersicht findest du unter <b>SPIELREGELN → RUNEN</b>. Ranglistenspiele verwenden nie Runen.',
    },
    twoPlayers: {
      heading: 'Zwei Spieler',
      body: 'Wähle <b>2 SPIELER</b>, um ein Handy zu teilen, und dann eure Sitzordnung. <b>Handy weitergeben</b>: Zwischen den Zügen erscheint eine Karte und die Raster wechseln die Plätze, damit der aktive Spieler unten ist. <b>Gegenüber</b>: Legt das Handy flach zwischen euch — die obere Hälfte ist für Spieler 2 gedreht, die Züge wechseln automatisch und die helle Hälfte mit dem drehenden Mittelwürfel zeigt, wer dran ist.',
    },
  },
  library: {
    gameModes: 'SPIELMODI',
    runes: 'RUNEN',
    openMode: 'Regeln für {{name}} öffnen',
    openRune: 'Details zu {{name}} öffnen',
  },
  firstRun: {
    title: 'Zum ersten Mal?',
    body: 'Das Tutorial ist ein geführtes Spiel mit fünf Lektionen. Es dauert etwa eine Minute und wird nur einmal angeboten.',
    play: 'Tutorial spielen',
    startTutorial: 'Tutorial starten',
    skip: 'Überspringen, Regeln bekannt',
  },
} satisfies CatalogShape<typeof enLearn>;
