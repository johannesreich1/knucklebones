// One visible move pipeline for every driver. The caller supplies only the
// semantic differences (cancellation identity, charms and feedback cadence);
// placement, score feedback, protection and destruction stay one view.
import {
  BOUNTY,
  SPEC,
  boardTotalMode,
  isShielded,
  openStrikes,
  victimsOf,
  type CharmSt,
  type Player,
} from '../../core/rules.ts';
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../audio.ts';
import { setStageDie } from '../die.ts';
import { $, colEl, slotEl, slotIdx } from '../dom.ts';
import { REDUCED, burst, flash, floatPts, shake } from '../fx.ts';
import { colorOf, heatOf } from '../identity.ts';
import { renderSide } from './board.ts';
import { playWardStrike, shieldBlocked, wardBurned } from './seals.ts';
import { flyDieToSlot } from './motion.ts';
import { clearSunderPresentation } from './sunder-presentation.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface GameViewSpec {
  /* Captures a local generation or an exact ranked-match identity. */
  isCurrent: () => boolean;
  /* Ranked may paint a remotely supplied face before its flight. */
  stageDieBeforeFlight?: boolean;
  /* A reconstructed/full authoritative column must not target a fourth slot. */
  flyOnlyIntoOpenSlot?: boolean;
  placeVibration?: boolean;
  celebrateMultiplier?: boolean;
  afterPlacementMs?: number;
  afterMoveMs?: number;
  /* Local spells supply their charm; plain/ranked games omit it. */
  charm?: CharmSt;
  onPlaced?: () => void;
}

export interface GameViewResult {
  placed: boolean;
  interrupted: boolean;
  destroyed: number;
}

interface DestructionResult {
  destroyed: number;
  interrupted: boolean;
}

async function destroyAt(
  who: Player,
  col: number,
  die: number,
  isCurrent: () => boolean,
  sundered = false,
): Promise<DestructionResult> {
  const board = S.boards[who];
  const victims = victimsOf(board[col], die, S.scoring);
  if (!victims.length) return { destroyed: 0, interrupted: false };

  const color = sundered ? '#ff9d66' : colorOf(who);
  let collapseOrder = 0;
  for (const index of victims) {
    const slot = slotEl(who, col, slotIdx(who, index));
    const doomed = slot?.firstElementChild as HTMLElement | null;
    if (!doomed) continue;
    if (sundered) {
      doomed.classList.add('sunder-doomed', 'sunder-collapse');
      doomed.style.setProperty('--sunder-delay', `${collapseOrder++ * 70}ms`);
    } else {
      doomed.classList.add('dying');
    }
    const rect = doomed.getBoundingClientRect();
    burst(rect.left + rect.width / 2, rect.top + rect.height / 2, color, 18);
  }

  const survivors = board[col].filter((_, index) => !victims.includes(index));
  const lost = boardTotalMode(board, S.scoring)
    - boardTotalMode(board.map((column, index) => index === col ? survivors : column), S.scoring);
  floatPts(who, col, '−' + lost, heatOf(who));
  Sfx.kill();
  vibrate([16, 30, 26]);
  shake(7);
  flash(0.22);
  await pause(sundered ? (REDUCED ? 0 : 460 + Math.max(0, collapseOrder - 1) * 70) : 320);
  if (!isCurrent()) return { destroyed: 0, interrupted: true };
  S.boards[who][col] = survivors;
  renderSide(who, true);
  return { destroyed: victims.length, interrupted: false };
}

export async function animateGameMove(
  who: Player,
  col: number,
  die: number,
  spec: GameViewSpec,
): Promise<GameViewResult> {
  const sundered = !!spec.charm?.sunder[who];
  if (spec.stageDieBeforeFlight) setStageDie(die, who);
  const openSlot = S.boards[who][col].length < SPEC.rows;
  if (openSlot || !spec.flyOnlyIntoOpenSlot) await flyDieToSlot(who, col, die);
  if (!spec.isCurrent()) {
    if (sundered) clearSunderPresentation();
    return { placed: false, interrupted: true, destroyed: 0 };
  }

  const before = boardTotalMode(S.boards[who], S.scoring);
  S.boards[who][col].push(die);
  spec.onPlaced?.();
  Sfx.place();
  if (spec.placeVibration) vibrate(12);
  setStageDie(0);
  $('#dieStage').classList.remove('sundered');
  renderSide(who, !REDUCED);

  const gain = boardTotalMode(S.boards[who], S.scoring) - before;
  const multiplied = gain > die;
  floatPts(who, col, '+' + gain, multiplied ? heatOf(who) : colorOf(who));
  if (multiplied && spec.celebrateMultiplier) {
    Sfx.mult();
    const rect = colEl(who, col)?.getBoundingClientRect();
    if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height / 2, heatOf(who), 10);
  }

  if (spec.afterPlacementMs) await pause(spec.afterPlacementMs);
  if (!spec.isCurrent()) {
    if (sundered) clearSunderPresentation();
    return { placed: true, interrupted: true, destroyed: 0 };
  }

  // openStrikes consumes SUNDER exactly once and is also the headless replay
  // source of truth. Ranked omits charm, so its plan remains the plain move.
  const strikes = openStrikes(S.boards, who, col, die, S.scoring, spec.charm);
  const foe = (1 - who) as Player;
  if (isShielded(S.boards[foe][col], S.scoring) && S.boards[foe][col].includes(die)) {
    shieldBlocked(foe, col);
  }

  let destroyed = 0;
  try {
    for (const strike of strikes) {
      if (!spec.isCurrent()) return { placed: true, interrupted: true, destroyed };
      if (strike.warded && spec.charm) {
        const sourceIndex = S.boards[who][col].length - 1;
        const source = slotEl(who, col, slotIdx(who, sourceIndex))?.firstElementChild as HTMLElement | null;
        const completed = await playWardStrike({
          attacker: who,
          target: foe,
          targetColumn: strike.col,
          source,
          isCurrent: spec.isCurrent,
          impact: () => {
            spec.charm!.wards[foe][strike.col]--;
            wardBurned(foe, strike.col);
            Sfx.mult();
            vibrate([14, 26, 18]);
          },
        });
        if (!completed || !spec.isCurrent()) {
          return { placed: true, interrupted: true, destroyed };
        }
        renderSide(foe, true);
        continue;
      }
      const result = await destroyAt(foe, strike.col, die, spec.isCurrent, sundered);
      if (result.interrupted) return { placed: true, interrupted: true, destroyed };
      destroyed += result.destroyed;
    }
  } finally {
    if (sundered) clearSunderPresentation();
  }

  if (S.scoring === BOUNTY && destroyed) {
    S.bounty[who] += destroyed;
    floatPts(who, col, '+' + destroyed + ' ✦', heatOf(who));
    renderSide(who, true);
  }
  if (spec.afterMoveMs) await pause(spec.afterMoveMs);
  return { placed: true, interrupted: !spec.isCurrent(), destroyed };
}
