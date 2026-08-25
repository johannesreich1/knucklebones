// One transaction for spending WARD and settling its derived score. Callers
// own why the mark breaks; this owner keeps every resulting visible fact in
// sync at the authoritative mutation's contact frame.
import { distinctPipSum, type Player } from '../../core/rules.ts';
import { formatNumber } from '../../i18n/index.ts';
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../audio.ts';
import { floatPts } from '../fx.ts';
import { spellHue } from '../spellicons.ts';
import { wardBurned } from './seals.ts';
import { renderTotal } from './scores.ts';

export function settleWardBreak(
  target: Player,
  column: number,
  mutate: () => void,
  onScoreSettled?: () => void,
): void {
  const lostBonus = distinctPipSum(S.boards[target][column]);
  mutate();
  wardBurned(target, column);
  // Update the total without repainting away the clasp that is still breaking.
  renderTotal(target);
  if (lostBonus) {
    floatPts(target, column, '−' + formatNumber(lostBonus), spellHue('ward'));
  }
  // The initiating effect may add its own contact mark before shared feedback.
  onScoreSettled?.();
  Sfx.mult();
  vibrate([14, 26, 18]);
}
