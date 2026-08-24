// Tutorial-only score/destruction previews plus the ordinary legal-column
// affordance. Strategy hints never leak into normal play.
import { ME, SPEC, colScore, countOf, type Player } from '../../core/rules.ts';
import { formatNumber } from '../../i18n/index.ts';
import { S } from '../../state.ts';
import { chipEl, colEl } from '../dom.ts';
import { appRoot } from '../embed.ts';

export function clearHints(): void {
  appRoot().querySelectorAll<HTMLElement>('.col').forEach((column) => {
    column.classList.remove('legal', 'danger');
  });
  appRoot().querySelectorAll<HTMLElement>('.chip .dl').forEach((detail) => {
    detail.classList.remove('show', 'gain', 'kill');
    detail.textContent = '';
  });
}

export function showHints(): void {
  clearHints();
  if (S.phase !== 'choose' || (S.mode === 'cpu' && S.turn !== ME)) return;
  const me = S.turn;
  const foe = (1 - S.turn) as Player;
  const die = S.die;
  const tutorial = !!S.tut;
  const restrict = S.tut?.restrict ?? null;

  for (let col = 0; col < SPEC.cols; col++) {
    if (S.boards[me][col].length >= SPEC.rows) continue;
    if (restrict != null && col !== restrict) continue;
    colEl(me, col)?.classList.add('legal');
    if (!tutorial) continue;

    const ownColumn = S.boards[me][col];
    const gain = colScore(ownColumn.concat([die])) - colScore(ownColumn);
    const gainDetail = chipEl(me, col).querySelector<HTMLElement>('.dl')!;
    gainDetail.textContent = '+' + formatNumber(gain);
    gainDetail.className = 'dl gain show';

    const foeColumn = S.boards[foe][col];
    if (!countOf(foeColumn, die)) continue;
    const loss = colScore(foeColumn) - colScore(foeColumn.filter((value) => value !== die));
    const killDetail = chipEl(foe, col).querySelector<HTMLElement>('.dl')!;
    killDetail.textContent = '−' + formatNumber(loss);
    killDetail.className = 'dl kill show';
    colEl(foe, col)?.classList.add('danger');
  }
}
