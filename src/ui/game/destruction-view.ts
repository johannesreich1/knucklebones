// How destroyed dice leave the board. Destruction is a visible event with its
// own timing owner: the point-loss plan, the three victim languages (SUNDER
// collapse, BOUNTY mint press, ordinary burst), the impact, and the waits that
// must finish before the survivors are committed and the side repaints.
import {
  BOUNTY,
  boardTotalMode,
  victimsOf,
  type Board,
  type Player,
  type StrikeOutcome,
} from '../../core/rules.ts';
import { formatNumber } from '../../i18n/index.ts';
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../audio.ts';
import { slotEl, slotIdx } from '../dom.ts';
import { REDUCED, burst, flash, floatPts, shake } from '../fx.ts';
import { colorOf, heatOf } from '../identity.ts';
import { renderSide } from './board.ts';
import {
  BOUNTY_TIMING,
  bountyPlacementDelay,
  bountyPresentationNow,
  bountySequenceDuration,
  bountySunderDelay,
  clearBountyPresentation,
  markBountyVictim,
  waitForBountyOffset,
} from './bounty-presentation.ts';
import { markSunderVictim, releaseSunderVictim } from './sunder-presentation.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const SUNDER_COLLAPSE_MS = 2600;
const SUNDER_STAGGER_MS = 160;

export interface DestructionResult {
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
  attacker: Player,
  plan: DestructionPlan,
  color: string,
  sunderOrder: number | null,
  placementLandedAt?: number,
): number {
  let order = sunderOrder ?? 0;
  /* Sample the placement clock once for the whole batch. Reading it per die
     turns the authored 108ms cadence into 107.xms by subtracting loop time. */
  const bountyBaseDelay = sunderOrder === null && S.scoring === BOUNTY
    ? bountyPlacementDelay(placementLandedAt!, 0)
    : 0;
  for (const index of plan.victims) {
    const slot = slotEl(who, plan.col, slotIdx(who, index));
    const doomed = slot?.firstElementChild as HTMLElement | null;
    if (!doomed) continue;
    if (sunderOrder !== null) {
      const victimOrder = order++;
      markSunderVictim(slot!, doomed, victimOrder);
      releaseSunderVictim(slot!, doomed, victimOrder * SUNDER_STAGGER_MS);
      if (S.scoring === BOUNTY) {
        markBountyVictim({
          slot: slot!,
          die: doomed,
          attacker,
          order: victimOrder,
          delayMs: bountySunderDelay(victimOrder, SUNDER_COLLAPSE_MS, SUNDER_STAGGER_MS),
          flatten: false,
          reduced: REDUCED,
          source: 'sunder',
        });
      }
    } else if (S.scoring === BOUNTY) {
      const victimOrder = order++;
      markBountyVictim({
        slot: slot!,
        die: doomed,
        attacker,
        order: victimOrder,
        delayMs: bountyBaseDelay + victimOrder * BOUNTY_TIMING.victimStaggerMs,
        flatten: true,
        reduced: REDUCED,
        source: 'ordinary',
      });
    } else {
      doomed.classList.add('dying');
      const rect = doomed.getBoundingClientRect();
      burst(rect.left + rect.width / 2, rect.top + rect.height / 2, color, 18);
    }
  }
  /* The aggregate loss belongs to an actually destroyed die, not whichever
     survivor happens to be last in the stack. */
  floatPts(who, plan.col, '−' + formatNumber(plan.lost), heatOf(who), plan.victims[0]);
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

export async function destroyAt(
  attacker: Player,
  target: Player,
  col: number,
  die: number,
  placementLandedAt: number,
  isCurrent: () => boolean,
): Promise<DestructionResult> {
  const victims = victimsOf(S.boards[target][col], die, S.scoring);
  if (!victims.length) return { destroyed: 0, interrupted: false };

  const plan = planDestruction(S.boards[target], col, victims);
  if (S.scoring === BOUNTY) {
    const presentationStartedAt = REDUCED ? bountyPresentationNow() : placementLandedAt;
    const ready = REDUCED || await waitForBountyOffset(
      placementLandedAt,
      BOUNTY_TIMING.pressStartMs,
      isCurrent,
    );
    if (!ready) return { destroyed: 0, interrupted: true };
    stageDestruction(target, attacker, plan, colorOf(target), null, placementLandedAt);
    playDestructionImpact();
    const completed = await waitForBountyOffset(
      presentationStartedAt,
      REDUCED ? BOUNTY_TIMING.reducedHoldMs : bountySequenceDuration(victims.length),
      isCurrent,
    );
    /* Clear before repaint: a compacted survivor can reuse the victim's DOM
       node when it has the same face, and must not inherit the filled press. */
    clearBountyPresentation();
    if (!completed) return { destroyed: 0, interrupted: true };
  } else {
    stageDestruction(target, attacker, plan, colorOf(target), null);
    playDestructionImpact();
    await pause(320);
    if (!isCurrent()) return { destroyed: 0, interrupted: true };
  }
  S.boards[target][col] = plan.survivors;
  renderSide(target, true);
  return { destroyed: victims.length, interrupted: false };
}

/* SUNDER widens one placement, so its destruction is one visible event too.
   Stage every authoritative victim before waiting or repainting: resolving the
   columns through destroyAt one by one made later victims look disconnected
   from the warning and reset the stagger in every column. */
export async function destroySunderStrikes(
  attacker: Player,
  target: Player,
  strikes: StrikeOutcome[],
  isCurrent: () => boolean,
): Promise<DestructionResult> {
  if (!strikes.length) return { destroyed: 0, interrupted: false };
  /* Score each loss against the preceding planned removals. ROW modes couple
     columns, so measuring every column against the untouched board would
     overstate or understate the visible point loss. */
  const scratch = S.boards[target].map((column) => column.slice());
  const plans = strikes.map((strike) => {
    const plan = planDestruction(scratch, strike.col, strike.victims);
    scratch[strike.col] = plan.survivors;
    return plan;
  });
  let collapseOrder = 0;
  for (const plan of plans) {
    collapseOrder = stageDestruction(target, attacker, plan, '#ff9d66', collapseOrder);
  }
  /* SU6 already carries its authored whole-die shine. A generic centre burst,
     board shake or screen flash would introduce a new destruction language at
     release instead of letting the warning finish. */
  playDestructionImpact(false);
  const collapseStartedAt = bountyPresentationNow();
  const collapseDuration = REDUCED
    ? (S.scoring === BOUNTY ? BOUNTY_TIMING.reducedHoldMs : 0)
    : SUNDER_COLLAPSE_MS + Math.max(0, collapseOrder - 1) * SUNDER_STAGGER_MS;
  const completed = S.scoring === BOUNTY
    ? await waitForBountyOffset(collapseStartedAt, collapseDuration, isCurrent)
    : (await pause(collapseDuration), isCurrent());
  clearBountyPresentation();
  if (!completed) return { destroyed: 0, interrupted: true };
  for (const plan of plans) S.boards[target][plan.col] = plan.survivors;
  renderSide(target, true);
  return {
    destroyed: plans.reduce((total, plan) => total + plan.victims.length, 0),
    interrupted: false,
  };
}
