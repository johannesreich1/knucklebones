import type { CatalogShape } from '../../catalog-shape.ts';
import { enSettings } from '../en/settings.ts';

export const frSettings = {
  title: 'PARAMÈTRES',
  language: 'Langue',
  previousLanguage: 'Langue précédente',
  nextLanguage: 'Langue suivante',
  yourColour: 'Votre couleur',
  opponentColour: 'Couleur adverse',
  sound: 'Son',
  accessibility: 'Accessibilité',
  diceFaces: 'Faces des dés',
  pips: 'POINTS',
  numbers: 'CHIFFRES',
  colourBlindMode: 'Mode daltonien',
  reducedMotion: 'Animations réduites',
  hues: {
    cyan: 'CYAN',
    magenta: 'MAGENTA',
    gold: 'OR',
    green: 'VERT',
    violet: 'VIOLET',
    orange: 'ORANGE',
    blue: 'BLEU',
  },
} satisfies CatalogShape<typeof enSettings>;
