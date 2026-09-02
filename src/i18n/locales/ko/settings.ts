import type { CatalogShape } from '../../catalog-shape.ts';
import { enSettings } from '../en/settings.ts';

export const koSettings = {
  title: '설정',
  language: '언어',
  previousLanguage: '이전 언어',
  nextLanguage: '다음 언어',
  yourColour: '내 색상',
  opponentColour: '상대 색상',
  sound: '소리',
  appIconColours: '앱 아이콘을 내 색상으로',
  accessibility: '접근성',
  diceFaces: '주사위 표시',
  pips: '눈',
  numbers: '숫자',
  colourBlindMode: '색각 보정 모드',
  colourBlindPalette: '색각 보정 모드 · 시안 + 골드',
  reducedMotion: '동작 줄이기',
  hues: {
    cyan: '시안',
    magenta: '마젠타',
    gold: '골드',
    green: '그린',
    violet: '바이올렛',
    orange: '오렌지',
    blue: '블루',
  },
} satisfies CatalogShape<typeof enSettings>;
