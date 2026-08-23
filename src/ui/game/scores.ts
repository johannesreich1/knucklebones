// Scores, mode rails and protection marks. This module owns every number and
// persistent column mark derived from board state.
import {
  BOUNTY,
  ROWMULT,
  ROWSWITCH,
  SPEC,
  colScore,
  counts,
  isShielded,
  rowScore,
  totalOf,
  type Player,
} from '../../core/rules.ts';
import { DICE_FACES } from '../../config.ts';
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
  setScoringPresentation(rowSwitch ? 'row-switch' : rowMultiply ? 'row-multiply' : 'columns');

  /* Decide the whole shield run before dressing any column. A full protected
     column is permanent, so adjacent runs may grow but never split mid-game. */
  const sealed = board.map((column) => isShielded(column, S.scoring));

  for (let col = 0; col < SPEC.cols; col++) {
    const column = board[col];
    const score = rowSwitch ? column.reduce((sum, value) => sum + value, 0) : colScore(column);
    const chip = chipEl(who, col);
    const scoreText = chip.querySelector<HTMLElement>('.cs')!;
    scoreText.textContent = rowSwitch ? '' : String(score);
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
    const merged = shielded && !!sealed[col - 1];
    columnElement.classList.toggle('sealmerged', merged);
    let span = 1;
    if (shielded && !merged) while (sealed[col + span]) span++;
    const regrown = setSealSpan(columnElement, span);
    if (!merged && (newShield || newWard || regrown)) playSealEngage(columnElement);

    const free = SPEC.rows - column.length;
    columnElement.setAttribute('aria-label',
      nameOf(who) + ' column ' + (col + 1) + ', score ' + score + ', '
      + (free ? free + ' space' + (free > 1 ? 's' : '') + ' free' : 'full'));
  }

  renderRowRail(who, rowSwitch, rowMultiply);
  renderTotal(who);
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
      ? String(value) : value ? String(value) : '';
    const multiplier = element.querySelector<HTMLElement>('.mx')!;
    multiplier.textContent = maxMultiplier >= 2 ? '×' + maxMultiplier : '';
    multiplier.classList.toggle('h3', maxMultiplier >= 3);
    element.classList.toggle('has', value > 0);
  }
}

function renderTotal(who: Player): void {
  const board = S.boards[who];
  const side = sideKey(who) === 'bot' ? 'Bot' : 'Top';
  const bounty = $('#bty' + side);
  if (bounty) {
    // Reserve the lane for the whole BOUNTY game so its late tally cannot move
    // the vertically centred score/rune cluster.
    const active = S.scoring === BOUNTY;
    const value = active ? S.bounty[who] : 0;
    bounty.hidden = !active;
    bounty.style.visibility = value ? '' : 'hidden';
    if (active) bounty.textContent = '✦' + value;
  }

  const total = totalOf(board, S.bounty[who], S.scoring);
  const score = $('#tot' + side);
  const plate = $('#plate' + side);
  if (score.textContent === String(total)) return;
  score.textContent = String(total);
  plate.classList.add('bump');
  setTimeout(() => plate.classList.remove('bump'), 190);
}
