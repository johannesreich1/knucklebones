import type { CatalogShape } from '../../catalog-shape.ts';
import { enSettings } from '../en/settings.ts';

export const ptSettings = {
  title: 'CONFIGURAÇÕES',
  language: 'Idioma',
  previousLanguage: 'Idioma anterior',
  nextLanguage: 'Próximo idioma',
  yourColour: 'Sua cor',
  opponentColour: 'Cor do oponente',
  sound: 'Som',
  profileAppIcon: 'Usar o dado do perfil como ícone',
  accessibility: 'Acessibilidade',
  diceFaces: 'Faces dos dados',
  pips: 'PONTOS',
  numbers: 'NÚMEROS',
  colourBlindMode: 'Modo para daltonismo',
  colourBlindPalette: 'Modo para daltonismo · ciano + dourado',
  reducedMotion: 'Movimento reduzido',
  hues: {
    cyan: 'CIANO',
    magenta: 'MAGENTA',
    gold: 'DOURADO',
    green: 'VERDE',
    violet: 'VIOLETA',
    orange: 'LARANJA',
    blue: 'AZUL',
  },
} satisfies CatalogShape<typeof enSettings>;
