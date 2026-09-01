import type { CatalogShape } from '../../catalog-shape.ts';
import { enSettings } from '../en/settings.ts';

export const plSettings = {
  title: 'USTAWIENIA',
  language: 'Język',
  previousLanguage: 'Poprzedni język',
  nextLanguage: 'Następny język',
  yourColour: 'Twój kolor',
  opponentColour: 'Kolor rywala',
  sound: 'Dźwięk',
  profileAppIcon: 'Użyj kości z profilu jako ikony aplikacji',
  accessibility: 'Dostępność',
  diceFaces: 'Wygląd kości',
  pips: 'OCZKA',
  numbers: 'CYFRY',
  colourBlindMode: 'Tryb dla daltonistów',
  colourBlindPalette: 'Tryb dla daltonistów · cyjan + złoty',
  reducedMotion: 'Ogranicz ruch',
  hues: {
    cyan: 'CYJAN',
    magenta: 'MAGENTA',
    gold: 'ZŁOTY',
    green: 'ZIELONY',
    violet: 'FIOLETOWY',
    orange: 'POMARAŃCZOWY',
    blue: 'NIEBIESKI',
  },
} satisfies CatalogShape<typeof enSettings>;
