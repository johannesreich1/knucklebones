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
  type Board,
  type CharmSt,
  type Player,
  type StrikeOutcome,
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
import { clearSunderPresentation, markSunderVictim } from './sunder-presentation.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const SUNDER_COLLAPSE_MS = 2600;
const SUNDER_STAGGER_MS = 160;

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

interface DestructionPlan {
  col: number;
  victims: number[];
  survivors: number[];
  lost: number;
}

function planDestruction(board: Board, col: number, victims: number[]): DestructionPlan {
  const survivors = board[col].filter((_, index) => !victims.includes(index));
  const lost = boardTotalMode(board, S.scoring)
    - boardTotalMode(board.map((column, index) => index === col ? survivors : column), S.scoring);
  return { col, victims, survivors, lost };
}

function stageDestruction(
  who: Player,
  plan: DestructionPlan,
  color: string,
  sunderOrder: number | null,
): number {
  let order = sunderOrder ?? 0;
  for (const index of plan.victims) {
    const slot = slotEl(who, plan.col, slotIdx(who, index));
    const doomed = slot?.firstElementChild as HTMLElement | null;
    if (!doomed) continue;
    if (sunderOrder !== null) {
      markSunderVictim(slot!, doomed, order);
      doomed.classList.add('sunder-collapse');
      doomed.style.setProperty('--sunder-delay', `${order++ * SUNDER_STAGGER_MS}ms`);
    } else {
      doomed.classList.add('dying');
      const rect = doomed.getBoundingClientRect();
      burst(rect.left + rect.width / 2, rect.top + rect.height / 2, color, 18);
    }
  }
  /* The aggregate loss belongs to an actually destroyed die, not whichever
     survivor happens to be last in the stack. */
  floatPts(who, plan.col, '−' + plan.lost, heatOf(who), plan.victims[0]);
  return order;
}

function playDestructionImpact(withGlobalVisual = true): void {
  Sfx.kill();
  vibrate([16, 30, 26]);
  if (withGlobalVisual) {
    shake(7);
    flash(0.22);
  }
}

async function destroyAt(
  who: Player,
  col: number,
  die: number,
  isCurrent: () => boolean,
): Promise<DestructionResult> {
  const victims = victimsOf(S.boards[who][col], die, S.scoring);
  if (!victims.length) return { destroyed: 0, interrupted: false };

  const plan = planDestruction(S.boards[who], col, victims);
  stageDestruction(who, plan, colorOf(who), null);
  playDestructionImpact();
  await pause(320);
  if (!isCurrent()) return { destroyed: 0, interrupted: true };
  S.boards[who][col] = plan.survivors;
  renderSide(who, true);
  return { destroyed: victims.length, interrupted: false };
}

/* SUNDER widens one placement, so its destruction is one visible event too.
   Stage every authoritative victim before waiting or repainting: resolving the
   columns through destroyAt one by one made later victims look disconnected
   from the warning and reset the stagger in every column. */
async function destroySunderStrikes(
  who: Player,
  strikes: StrikeOutcome[],
  isCurrent: () => boolean,
): Promise<DestructionResult> {
  if (!strikes.length) return { destroyed: 0, interrupted: false };
  /* Score each loss against the preceding planned removals. ROW modes couple
     columns, so measuring every column against the untouched board would
     overstate or understate the visible point loss. */
  const scratch = S.boards[who].map((column) => column.slice());
  const plans = strikes.map((strike) => {
    const plan = planDestruction(scratch, strike.col, strike.victims);
    scratch[strike.col] = plan.survivors;
    return plan;
  });
  let collapseOrder = 0;
  for (const plan of plans) {
    collapseOrder = stageDestruction(who, plan, '#ff9d66', collapseOrder);
  }
  /* SU6 already carries its authored whole-die shine. A generic centre burst,
     board shake or screen flash would introduce a new destruction language at
     release instead of letting the warning finish. */
  playDestructionImpact(false);
  await pause(REDUCED ? 0
    : SUNDER_COLLAPSE_MS + Math.max(0, collapseOrder - 1) * SUNDER_STAGGER_MS);
  if (!isCurrent()) return { destroyed: 0, interrupted: true };
  for (const plan of plans) S.boards[who][plan.col] = plan.survivors;
  renderSide(who, true);
  return {
    destroyed: plans.reduce((total, plan) => total + plan.victims.length, 0),
    interrupted: false,
  };
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
    /* Wards answer first, then every unwarded SUNDER victim collapses in one
       batch. Ordinary placement keeps its established per-column pipeline. */
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
      if (sundered) continue;
      const result = await destroyAt(foe, strike.col, die, spec.isCurrent);
      if (result.interrupted) return { placed: true, interrupted: true, destroyed };
      destroyed += result.destroyed;
    }
    if (sundered) {
      const result = await destroySunderStrikes(
        foe,
        strikes.filter((strike) => !strike.warded),
        spec.isCurrent,
      );
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
