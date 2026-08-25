// Player-to-screen ownership, status and live-turn presentation. This is the
// seam shared by local and ranked drivers when a turn starts or settles.
import { AI, ME, type Player } from '../../core/rules.ts';
import { t } from '../../i18n/index.ts';
import { S } from '../../state.ts';
import { $ } from '../dom.ts';
import { nameOf } from '../identity.ts';
import { buildBoards, renderAll } from './board.ts';
import { clearHints } from './hints.ts';
import { reflowBadge } from './hud.ts';
import {
  isFaceToFace,
  setOpponentTurnPresentation,
  setSeatingPresentation,
  setTurnPresentation,
} from './root-state.ts';

export function applySides(): void {
  const bottom = S.bottom;
  const top = (1 - S.bottom) as Player;
  $('#sideBot').dataset.owner = String(bottom);
  $('#sideTop').dataset.owner = String(top);
  repaintTurnLocale();
  $('#tagBot').hidden = true;
  setSeatingPresentation(S.mode === 'duo' && S.seat === 'face' ? 'face-to-face' : 'shared');
  buildBoards();
  renderAll(false);
  setActivePlate();
  /* Pass-phone swaps screen ownership without dealing new runes. Move the
     existing owner buttons to the newly matching player plates afterwards. */
  reflowBadge();
}

/** Repaint locale-owned turn chrome without rebuilding either live board. */
export function repaintTurnLocale(): void {
  const bottom = S.bottom;
  const top = (1 - S.bottom) as Player;
  $('#nameBot').textContent = nameOf(bottom);
  $('#nameTop').textContent = nameOf(top);
  const tag = $('#tagTop');
  tag.hidden = !(S.mode === 'cpu' && top === AI);
  tag.textContent = S.tut ? t('game', 'difficulty.tutorial') : t('game', {
    easy: 'difficulty.easy',
    medium: 'difficulty.normal',
    hard: 'difficulty.hard',
  }[S.diff] as 'difficulty.easy' | 'difficulty.normal' | 'difficulty.hard');
  repaintStatus();
}

export type StatusCopy = string | (() => string);
let liveStatusCopy: (() => string) | null = null;
let liveStatusWho: Player | null = null;

function paintStatus(text: string, who: Player | null): void {
  const status = $('#status');
  status.removeAttribute('data-i18n');
  status.textContent = text;
  status.className = 'status' + (who === ME ? ' me' : who === AI ? ' ai' : '');
}

function repaintStatus(): void {
  if (liveStatusCopy) paintStatus(liveStatusCopy(), liveStatusWho);
}

/* A localized status is supplied as a zero-argument renderer. applySides()
   runs on locale changes, so the live lane is repainted without guessing the
   current turn's sentence from mutable game state. Raw strings remain useful
   for server/user content and deliberately have no translation semantics. */
export function setStatus(copy: StatusCopy, who: Player | null): void {
  liveStatusCopy = typeof copy === 'function' ? copy : null;
  liveStatusWho = who;
  paintStatus(typeof copy === 'function' ? copy() : copy, who);
}

export function setActivePlate(viewer: Player | null = S.mode === 'cpu' ? ME : null): void {
  const live = S.phase !== 'over' && S.phase !== 'menu';
  const topActive = S.turn !== S.bottom;
  $('#plateBot').classList.toggle('active', live && !topActive);
  $('#plateTop').classList.toggle('active', live && topActive);

  const face = isFaceToFace();
  $('#sideTop').classList.toggle('idle', face && live && !topActive);
  $('#sideBot').classList.toggle('idle', face && live && topActive);
  setTurnPresentation(!live ? 'none' : topActive ? 'top' : 'bottom');
  setOpponentTurnPresentation(live && viewer !== null && S.turn !== viewer);
}

export function settleBoard(): void {
  S.phase = 'over';
  S.busy = false;
  setActivePlate();
  clearHints();
}
