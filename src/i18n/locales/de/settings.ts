import type { CatalogShape } from '../../catalog-shape.ts';
import { enSettings } from '../en/settings.ts';

export const deSettings = {
  title: 'EINSTELLUNGEN',
  language: 'Sprache',
  previousLanguage: 'Vorherige Sprache',
  nextLanguage: 'Nächste Sprache',
  yourColour: 'Deine Farbe',
  opponentColour: 'Gegnerfarbe',
  sound: 'Ton',
  profileAppIcon: 'Profilwürfel als App-Symbol verwenden',
  accessibility: 'Barrierefreiheit',
  diceFaces: 'Würfelflächen',
  pips: 'AUGEN',
  numbers: 'ZAHLEN',
  colourBlindMode: 'Farbenblind-Modus',
  colourBlindPalette: 'Farbenblind-Modus · Cyan + Gold',
  reducedMotion: 'Bewegung reduzieren',
  hues: {
    cyan: 'CYAN',
    magenta: 'MAGENTA',
    gold: 'GOLD',
    green: 'GRÜN',
    violet: 'VIOLETT',
    orange: 'ORANGE',
    blue: 'BLAU',
  },
} satisfies CatalogShape<typeof enSettings>;
