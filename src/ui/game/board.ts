// Board construction and dice painting. Scores and protection furniture are
// delegated to their owners after the dice for one side have settled.
import {
  AI,
  ME,
  ROWMULT,
  ROWSWITCH,
  SPEC,
  counts,
  type Player,
} from '../../core/rules.ts';
import { S } from '../../state.ts';
import { $, slotEl, slotIdx } from '../dom.ts';
import { makeDie } from '../die.ts';
import { sealMarkup, watchSealCells } from './seals.ts';
import { updateScores } from './scores.ts';

export function buildBoards(): void {
  for (const side of ['top', 'bot'] as const) {
    const board = $('#' + side + 'Board');
    const chips = $('#' + side + 'Cols');
    board.innerHTML = '';
    chips.innerHTML = '';
    for (let col = 0; col < SPEC.cols; col++) {
      const column = document.createElement('div');
      column.className = 'col';
      column.dataset.col = String(col);
      column.setAttribute('role', 'button');
      column.setAttribute('tabindex', '-1');
      for (let row = 0; row < SPEC.rows; row++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.slot = String(row);
        slot.setAttribute('aria-hidden', 'true');
        column.appendChild(slot);
      }
      column.insertAdjacentHTML('beforeend', sealMarkup(1));
      board.appendChild(column);

      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = '<span class="cs">0</span><span class="mx"></span>'
        + '<span class="sh"></span><span class="wd"></span><span class="dl"></span>';
      chips.appendChild(chip);
    }

    const rowChips = document.createElement('div');
    rowChips.className = 'rowchips';
    rowChips.id = side + 'Rows';
    rowChips.setAttribute('aria-hidden', 'true');
    rowChips.innerHTML = '<span class="rc"><span class="cs"></span><span class="mx"></span></span>'
      .repeat(SPEC.rows);
    board.appendChild(rowChips);
  }
  watchSealCells();
}

export function renderSide(who: Player, animate: boolean): void {
  const board = S.boards[who];
  const rowSwitch = S.scoring === ROWSWITCH;
  const rowMultiply = S.scoring === ROWMULT;
  let rowCounts: Array<Record<number, number>> | null = null;

  if (rowSwitch || rowMultiply) {
    rowCounts = [];
    for (let row = 0; row < SPEC.rows; row++) {
      const matches: Record<number, number> = {};
      for (let col = 0; col < SPEC.cols; col++) {
        const value = board[col][row];
        if (value !== undefined) matches[value] = (matches[value] ?? 0) + 1;
      }
      rowCounts.push(matches);
    }
  }

  for (let col = 0; col < SPEC.cols; col++) {
    const columnCounts = counts(board[col]);
    for (let row = 0; row < SPEC.rows; row++) {
      const slot = slotEl(who, col, slotIdx(who, row));
      if (!slot) continue;
      const value = board[col][row];
      if (value === undefined) {
        if (slot.firstChild) slot.innerHTML = '';
        continue;
      }

      let die = slot.firstElementChild as HTMLElement | null;
      if (!die || Number(die.dataset.v) !== value) {
        slot.innerHTML = '';
        die = makeDie(value, who);
        slot.appendChild(die);
        if (animate) die.classList.add('settle');
      }
      // A compacted survivor can reuse an element whose old occupant was
      // dying; remove the forwards-filled animation before styling the die.
      die.classList.remove('dying');

      const rowMatches = rowCounts?.[row]?.[value] ?? 1;
      const multiplier = rowSwitch ? rowMatches : (columnCounts[value] ?? 1);
      die.classList.toggle('m2', multiplier === 2);
      die.classList.toggle('m3', multiplier === 3);

      // ROW MULTIPLY spans may jump a nonmatching middle die, so the renderer
      // marks the first and last matching dice rather than adjacent cells.
      const inRowMatch = rowMultiply && rowMatches >= 2;
      die.classList.toggle('rm2', inRowMatch && rowMatches === 2);
      die.classList.toggle('rm3', inRowMatch && rowMatches === 3);
      const ahead = board.slice(col + 1).some((column) => column[row] === value);
      const behind = board.slice(0, col).some((column) => column[row] === value);
      die.classList.toggle('rms', inRowMatch && !behind);
      die.classList.toggle('rme', inRowMatch && !ahead);
    }
  }
  updateScores(who);
}

export function renderAll(animate: boolean): void {
  renderSide(AI, animate);
  renderSide(ME, animate);
}
