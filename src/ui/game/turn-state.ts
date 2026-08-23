// Player-to-screen ownership, status and live-turn presentation. This is the
// seam shared by local and ranked drivers when a turn starts or settles.
import { AI, ME, type Player } from '../../core/rules.ts';
import { DIFF_LABEL, S } from '../../state.ts';
import { $ } from '../dom.ts';
import { nameOf } from '../identity.ts';
import { buildBoards, renderAll } from './board.ts';
import { clearHints } from './hints.ts';
import {
  isFaceToFace,
  setSeatingPresentation,
  setTurnPresentation,
} from './root-state.ts';

export function applySides(): void {
  const bottom = S.bottom;
  const top = (1 - S.bottom) as Player;
  $('#sideBot').dataset.owner = String(bottom);
  $('#sideTop').dataset.owner = String(top);
  $('#nameBot').textContent = nameOf(bottom);
  $('#nameTop').textContent = nameOf(top);
  const tag = $('#tagTop');
  tag.hidden = !(S.mode === 'cpu' && top === AI);
  tag.textContent = S.tut ? 'TUTORIAL' : DIFF_LABEL[S.diff];
  $('#tagBot').hidden = true;
  setSeatingPresentation(S.mode === 'duo' && S.seat === 'face' ? 'face-to-face' : 'shared');
  buildBoards();
  renderAll(false);
  setActivePlate();
}

export function setStatus(text: string, who: Player | null): void {
  const status = $('#status');
  status.textContent = text;
  status.className = 'status' + (who === ME ? ' me' : who === AI ? ' ai' : '');
}

export function setActivePlate(): void {
  const live = S.phase !== 'over' && S.phase !== 'menu';
  const topActive = S.turn !== S.bottom;
  $('#plateBot').classList.toggle('active', live && !topActive);
  $('#plateTop').classList.toggle('active', live && topActive);

  const face = isFaceToFace();
  $('#sideTop').classList.toggle('idle', face && live && !topActive);
  $('#sideBot').classList.toggle('idle', face && live && topActive);
  setTurnPresentation(!live ? 'none' : topActive ? 'top' : 'bottom');
}

export function settleBoard(): void {
  S.phase = 'over';
  S.busy = false;
  setActivePlate();
  clearHints();
}
