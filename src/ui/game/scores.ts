// Scores, mode rails and protection marks. This module owns every number and
// persistent column mark derived from board state.
import {
  BOUNTY,
  ROWMULT,
  ROWSWITCH,
  SPEC,
  colScore,
  counts,
  distinctPipSum,
  isShielded,
  rowScore,
  totalOf,
  wardBonusOf,
  type Player,
} from '../../core/rules.ts';
import { DICE_FACES } from '../../config.ts';
import { formatNumber, t } from '../../i18n/index.ts';
import { S } from '../../state.ts';
import { $, chipEl, colEl, sideKey } from '../dom.ts';
import { nameOf } from '../identity.ts';
import { setScoringPresentation } from './root-state.ts';
import {
  playSealEngage,
  setSealSpan,
  shieldMark,
  wardMark,
} from './seals.ts';

export function updateScores(who: Player): void {
  const board = S.boards[who];
  const rowSwitch = S.scoring === ROWSWITCH;
  const rowMultiply = S.scoring === ROWMULT;
  setScoringPresentation(S.scoring);

  /* Decide the whole shield run before dressing any column. A full protected
     column is permanent. A scoring WARD is a spendable boundary inside such a
     run: keeping that column span-one gives the mint clasp an honest target;
     once its snap has finished, the surrounding gold shields can merge. */
  const sealed = board.map((column) => isShielded(column, S.scoring));
  const wardBoundary = board.map((_, col) => S.charm.wards[who][col] > 0
    || !!colEl(who, col)?.classList.contains('sealsnap'));

  for (let col = 0; col < SPEC.cols; col++) {
    const column = board[col];
    const score = rowSwitch ? column.reduce((sum, value) => sum + value, 0) : colScore(column);
    const chip = chipEl(who, col);
    const scoreText = chip.querySelector<HTMLElement>('.cs')!;
    scoreText.textContent = rowSwitch ? '' : formatNumber(score);
    chip.classList.toggle('has', !rowSwitch && score > 0);

    const columnCounts = counts(column);
    let multiplier = '';
    if (!rowSwitch) {
      for (const value in columnCounts) {
        if (columnCounts[value] === 3) multiplier = '×3';
        else if (columnCounts[value] === 2 && multiplier !== '×3') multiplier = '×2';
      }
    }
    const multiplierBadge = chip.querySelector<HTMLElement>('.mx')!;
    multiplierBadge.textContent = multiplier;
    multiplierBadge.classList.toggle('h3', multiplier === '×3');

    const columnElement = colEl(who, col)!;
    const shield = chip.querySelector<HTMLElement>('.sh')!;
    const shielded = sealed[col];
    const newShield = shielded && !shield.firstChild;
    if (newShield) {
      shield.innerHTML = shieldMark();
      shield.classList.add('pop');
    } else if (!shielded && shield.firstChild) {
      shield.innerHTML = '';
      shield.classList.remove('pop');
    }
    columnElement.classList.toggle('shielded', shielded);

    const ward = chip.querySelector<HTMLElement>('.wd')!;
    const warded = S.charm.wards[who][col] > 0;
    const newWard = warded && !ward.firstChild;
    if (newWard) {
      ward.innerHTML = wardMark();
      ward.classList.add('pop');
    } else if (!warded && ward.firstChild) {
      ward.innerHTML = '';
      ward.classList.remove('pop', 'block');
    }
    columnElement.classList.toggle('warded', warded);

    /* The first shielded column owns one seal spanning its adjacent run. Every
       column keeps its own chip mark so the underlying per-column fact remains
       visible and announceable. */
    const merged = shielded && !!sealed[col - 1]
      && !wardBoundary[col - 1] && !wardBoundary[col];
    columnElement.classList.toggle('sealmerged', merged);
    let span = 1;
    if (shielded && !merged) {
      while (sealed[col + span]
        && !wardBoundary[col + span - 1] && !wardBoundary[col + span]) span++;
    }
    const regrown = setSealSpan(columnElement, span);
    if (!merged && (newShield || newWard || regrown)) playSealEngage(columnElement);

    columnElement.setAttribute('aria-label', columnAriaLabel(who, col));
  }

  renderRowRail(who, rowSwitch, rowMultiply);
  renderTotal(who);
}

function columnAriaLabel(who: Player, col: number): string {
  const column = S.boards[who][col];
  const score = S.scoring === ROWSWITCH
    ? column.reduce((sum, value) => sum + value, 0)
    : colScore(column);
  const free = SPEC.rows - column.length;
  const label = free
    ? t('game', 'board.columnAvailable', {
      player: nameOf(who), column: formatNumber(col + 1), score: formatNumber(score), count: free,
    })
    : t('game', 'board.columnFull', {
      player: nameOf(who), column: formatNumber(col + 1), score: formatNumber(score),
    });
  const wardBonus = S.charm.wards[who][col] > 0 ? distinctPipSum(column) : 0;
  return wardBonus ? label + t('game', 'board.wardBonusDetail', {
    bonus: formatNumber(wardBonus),
  }) : label;
}

/** Locale-only repaint for the existing column nodes; no marks or dice move. */
export function repaintScoreLocale(): void {
  for (const who of [0, 1] as const satisfies readonly Player[]) {
    for (let col = 0; col < SPEC.cols; col++) {
      colEl(who, col)?.setAttribute('aria-label', columnAriaLabel(who, col));
    }
    renderTotal(who);
  }
}

function renderRowRail(who: Player, rowSwitch: boolean, rowMultiply: boolean): void {
  if (!rowSwitch && !rowMultiply) return;
  const board = S.boards[who];
  const side = sideKey(who);
  const rail = $('#' + side + 'Rows');
  if (!rail) return;

  for (let row = 0; row < SPEC.rows; row++) {
    const element = rail.children[side === 'bot' ? row : SPEC.rows - 1 - row] as HTMLElement | undefined;
    if (!element) continue;
    let maxMultiplier = 1;
    let bonus = 0;
    for (let value = 1; value <= DICE_FACES; value++) {
      let matches = 0;
      for (let col = 0; col < SPEC.cols; col++) if (board[col][row] === value) matches++;
      if (matches > maxMultiplier) maxMultiplier = matches;
      if (matches >= 2) bonus += value * matches * matches;
    }
    const value = rowSwitch ? rowScore(board, row) : bonus;
    element.querySelector<HTMLElement>('.cs')!.textContent = rowSwitch
      ? formatNumber(value) : value ? formatNumber(value) : '';
    const multiplier = element.querySelector<HTMLElement>('.mx')!;
    multiplier.textContent = maxMultiplier >= 2 ? '×' + maxMultiplier : '';
    multiplier.classList.toggle('h3', maxMultiplier >= 3);
    element.classList.toggle('has', value > 0);
  }
}

export function renderTotal(who: Player): void {
  const board = S.boards[who];
  const side = sideKey(who) === 'bot' ? 'Bot' : 'Top';
  const wards = S.charm.wards[who];
  const wardPoints = wardBonusOf(board, wards);
  const ward = $('#wpt' + side);
  if (ward) {
    // A dealt WARD reserves this lane before it is cast. The centre total must
    // not move when the bonus appears, changes, is cancelled, or is broken.
    const active = 'ward' in S.spellCharges[who] || wardPoints > 0;
    const previous = Number(ward.dataset.value ?? 0);
    ward.dataset.value = String(wardPoints);
    ward.hidden = !active;
    ward.style.visibility = active && wardPoints ? '' : 'hidden';
    const amount = ward.querySelector<HTMLElement>('b');
    if (amount) amount.textContent = '+' + formatNumber(wardPoints);
    if (active) {
      const label = t('game', 'board.wardBonus', { bonus: formatNumber(wardPoints) });
      ward.setAttribute('aria-label', label);
      ward.title = label;
    }
    if (wardPoints && wardPoints !== previous) {
      const beat = wardPoints > previous ? 'ward-rise' : 'ward-drop';
      ward.classList.remove('ward-rise', 'ward-drop');
      void ward.offsetWidth;
      ward.classList.add(beat);
      setTimeout(() => ward.classList.remove(beat), 260);
    }
  }
  const bounty = $('#bty' + side);
  if (bounty) {
    // Reserve the lane for the whole BOUNTY game so its late tally cannot move
    // the vertically centred score/rune cluster.
    const active = S.scoring === BOUNTY;
    const value = active ? S.bounty[who] : 0;
    bounty.hidden = !active;
    bounty.style.visibility = value ? '' : 'hidden';
    if (active) bounty.textContent = '✦' + formatNumber(value);
  }

  const total = totalOf(board, S.bounty[who], S.scoring, wards);
  const score = $('#tot' + side);
  const plate = $('#plate' + side);
  const renderedTotal = formatNumber(total);
  if (score.textContent === renderedTotal) return;
  score.textContent = renderedTotal;
  plate.classList.add('bump');
  setTimeout(() => plate.classList.remove('bump'), 190);
}
