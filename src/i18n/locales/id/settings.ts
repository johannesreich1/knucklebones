import type { CatalogShape } from '../../catalog-shape.ts';
import { enSettings } from '../en/settings.ts';

export const idSettings = {
  title: 'PENGATURAN',
  language: 'Bahasa',
  previousLanguage: 'Bahasa sebelumnya',
  nextLanguage: 'Bahasa berikutnya',
  yourColour: 'Warna Anda',
  opponentColour: 'Warna lawan',
  sound: 'Suara',
  appIconColours: 'Ikon aplikasi dengan warnaku',
  accessibility: 'Aksesibilitas',
  diceFaces: 'Tampilan dadu',
  pips: 'TITIK',
  numbers: 'ANGKA',
  colourBlindMode: 'Mode buta warna',
  colourBlindPalette: 'Mode buta warna · sian + emas',
  reducedMotion: 'Kurangi gerakan',
  hues: {
    cyan: 'SIAN',
    magenta: 'MAGENTA',
    gold: 'EMAS',
    green: 'HIJAU',
    violet: 'UNGU',
    orange: 'JINGGA',
    blue: 'BIRU',
  },
} satisfies CatalogShape<typeof enSettings>;
