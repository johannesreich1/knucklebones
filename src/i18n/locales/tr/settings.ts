import type { CatalogShape } from '../../catalog-shape.ts';
import { enSettings } from '../en/settings.ts';

export const trSettings = {
  title: 'AYARLAR',
  language: 'Dil',
  previousLanguage: 'Önceki dil',
  nextLanguage: 'Sonraki dil',
  yourColour: 'Senin rengin',
  opponentColour: 'Rakip rengi',
  sound: 'Ses',
  profileAppIcon: 'Profil zarını uygulama simgesi olarak kullan',
  accessibility: 'Erişilebilirlik',
  diceFaces: 'Zar yüzleri',
  pips: 'NOKTALAR',
  numbers: 'SAYILAR',
  colourBlindMode: 'Renk körü modu',
  colourBlindPalette: 'Renk körü modu · camgöbeği + altın',
  reducedMotion: 'Hareketi azalt',
  hues: {
    cyan: 'CAMGÖBEĞİ',
    magenta: 'MACENTA',
    gold: 'ALTIN',
    green: 'YEŞİL',
    violet: 'MOR',
    orange: 'TURUNCU',
    blue: 'MAVİ',
  },
} satisfies CatalogShape<typeof enSettings>;
