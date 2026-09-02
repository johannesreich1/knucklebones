import type { CatalogShape } from '../../catalog-shape.ts';
import { enSettings } from '../en/settings.ts';

export const esSettings = {
  title: 'AJUSTES',
  language: 'Idioma',
  previousLanguage: 'Idioma anterior',
  nextLanguage: 'Idioma siguiente',
  yourColour: 'Tu color',
  opponentColour: 'Color del rival',
  sound: 'Sonido',
  appIconColours: 'Icono de la app con mis colores',
  accessibility: 'Accesibilidad',
  diceFaces: 'Caras de los dados',
  pips: 'PUNTOS',
  numbers: 'NÚMEROS',
  colourBlindMode: 'Modo para daltonismo',
  colourBlindPalette: 'Modo para daltonismo · cian + dorado',
  reducedMotion: 'Movimiento reducido',
  hues: {
    cyan: 'CIAN',
    magenta: 'MAGENTA',
    gold: 'DORADO',
    green: 'VERDE',
    violet: 'VIOLETA',
    orange: 'NARANJA',
    blue: 'AZUL',
  },
} satisfies CatalogShape<typeof enSettings>;
