import type { CatalogShape } from '../../catalog-shape.ts';
import { enLearn } from '../en/learn.ts';

export const frLearn = {
  tutorial: {
    welcome: 'Bienvenue dans Knucklebones ! Votre grille est celle du BAS. Remplissez-la avant l’IA — le total le plus élevé gagne.',
    lesson1: 'Vous avez obtenu un 4. Les pastilles + prévisualisent le score de chaque colonne — touchez-en une pour placer le dé.',
    lesson2: 'Encore un 4 ! Les dés identiques dans une colonne se multiplient : deux 4 valent 16, pas 8. Empilez-le sur le premier.',
    lesson3: 'Vous avez un 5 — et l’IA en a un dans sa colonne centrale. Placez le vôtre dans VOTRE colonne centrale pour détruire le sien !',
    lesson4: 'Voilà tout le jeu : empilez les dés identiques, détruisez ceux d’en face. Finissez la manche — le meilleur total l’emporte.',
  },
  hub: {
    title: 'COMMENT JOUER',
    tutorial: 'Tutoriel',
    tutorialBlurb: 'Une première partie guidée — cinq leçons à jouer',
    rules: 'Les règles',
    rulesBlurb: 'Score, destruction et fin de partie',
    modes: 'Modes de jeu',
    modesBlurb: 'Chaque mode possible et ce qu’il change',
    runes: 'Runes',
    runesBlurb: 'Chaque pouvoir, ses cibles et son nombre d’usages',
  },
  rules: {
    title: 'RÈGLES',
    goal: {
      heading: 'But',
      body: 'Remplissez votre grille de 3×3 dés. Quand <b>l’une</b> des grilles est pleine, la partie se termine — le total le plus élevé gagne.',
    },
    placing: {
      heading: 'Placement',
      body: 'Vous lancez un dé, puis touchez l’une de <b>vos</b> colonnes pour l’y placer. Vous ne choisissez pas le lancer, seulement sa destination.',
    },
    multipliers: {
      heading: 'Multiplicateurs de colonne',
      body: 'Les dés identiques d’une même colonne se multiplient. Deux 4 dans une colonne = <b>4×2×2 = 16</b>, pas 8. Trois 4 = <b>4×3×3 = 36</b>.',
    },
    destruction: {
      heading: 'Destruction',
      body: 'Posez un dé et <span class="k">tous les dés identiques de la colonne adverse en face sont détruits</span>. Les colonnes sont alignées verticalement — votre colonne gauche fait face à la sienne.',
    },
    reading: {
      heading: 'Lire le plateau',
      body: 'Les pastilles à côté de chaque colonne affichent son score actuel, et <b>×2</b>/<b>×3</b> signale une pile multipliée. Trouver le meilleur placement est tout le jeu — mais le <b>tutoriel</b> propose une manche guidée avec le score prévu pour chaque colonne.',
    },
    runes: {
      heading: 'Runes',
      body: 'Hors ligne, les deux joueurs reçoivent la même <b>rune</b>, près du dé courant — six sont proposées sur l’écran de configuration hors ligne, sous le mode de jeu (<b>aucune</b> par défaut, ou <b>aléatoire</b> pour en tirer une). Appuyez sur une rune qui agit sur votre dé pour l’utiliser immédiatement ; glissez ou touchez une rune de colonne sur une colonne illuminée. Un usage n’est pas un coup : votre dé est toujours posé ensuite. La liste complète se trouve sous <b>COMMENT JOUER → RUNES</b>. Les parties classées n’utilisent jamais de runes.',
    },
    twoPlayers: {
      heading: 'Deux joueurs',
      body: 'Choisissez <b>2 JOUEURS</b> pour partager un téléphone, puis votre disposition. <b>Passer le téléphone</b> : une carte apparaît entre les tours et les grilles s’échangent pour que le joueur actif soit en bas. <b>Face à face</b> : posez le téléphone à plat entre vous — la moitié haute est tournée pour le joueur 2, les tours alternent automatiquement et la moitié lumineuse avec le dé central tournant indique qui joue.',
    },
  },
  library: {
    gameModes: 'MODES DE JEU',
    runes: 'RUNES',
    openMode: 'Ouvrir les règles de {{name}}',
    openRune: 'Ouvrir les détails de {{name}}',
  },
  firstRun: {
    title: 'Première partie ?',
    body: 'Le tutoriel est une partie guidée en cinq leçons. Il dure environ une minute et ne vous sera proposé qu’une fois.',
    play: 'Jouer le tutoriel',
    startTutorial: 'Lancer le tutoriel',
    skip: 'Passer, je connais les règles',
  },
} satisfies CatalogShape<typeof enLearn>;
