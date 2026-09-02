import type { CatalogShape } from '../../catalog-shape.ts';
import { enSettings } from '../en/settings.ts';

export const itSettings = {
  title: 'IMPOSTAZIONI',
  language: 'Lingua',
  previousLanguage: 'Lingua precedente',
  nextLanguage: 'Lingua successiva',
  yourColour: 'Il tuo colore',
  opponentColour: "Colore dell'avversario",
  sound: 'Audio',
  profileAppIcon: 'Usa il dado del profilo come icona',
  accessibility: 'Accessibilità',
  diceFaces: 'Facce dei dadi',
  pips: 'PUNTINI',
  numbers: 'NUMERI',
  colourBlindMode: 'Modalità daltonismo',
  colourBlindPalette: 'Modalità daltonismo · ciano + oro',
  reducedMotion: 'Movimento ridotto',
  hues: {
    cyan: 'CIANO',
    magenta: 'MAGENTA',
    gold: 'ORO',
    green: 'VERDE',
    violet: 'VIOLA',
    orange: 'ARANCIONE',
    blue: 'BLU',
  },
} satisfies CatalogShape<typeof enSettings>;
