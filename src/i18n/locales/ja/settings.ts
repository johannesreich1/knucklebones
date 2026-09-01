import type { CatalogShape } from '../../catalog-shape.ts';
import { enSettings } from '../en/settings.ts';

export const jaSettings = {
  title: '設定',
  language: '言語',
  previousLanguage: '前の言語',
  nextLanguage: '次の言語',
  yourColour: '自分の色',
  opponentColour: '相手の色',
  sound: 'サウンド',
  accessibility: 'アクセシビリティ',
  diceFaces: 'ダイス表示',
  pips: '目',
  numbers: '数字',
  colourBlindMode: '色覚サポート',
  colourBlindPalette: '色覚サポート・シアン＋ゴールド',
  reducedMotion: '動きを減らす',
  hues: {
    cyan: 'シアン',
    magenta: 'マゼンタ',
    gold: 'ゴールド',
    green: 'グリーン',
    violet: 'バイオレット',
    orange: 'オレンジ',
    blue: 'ブルー',
  },
} satisfies CatalogShape<typeof enSettings>;
