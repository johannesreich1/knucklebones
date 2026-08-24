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
import { playWardStrike, shieldBlocked, wardBurned } from './seals.ts';
import { flyDieToSlot } from './motion.ts';
import {
  clearSunderPresentation,
  markSunderVictim,
  releaseSunderVictim,
} from './sunder-presentation.ts';

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
async function destroySunderStrikes(
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

export async function animateGameMove(
  who: Player,
  col: number,
  die: number,
  spec: GameViewSpec,
): Promise<GameViewResult> {
  /* A superseded move/restart may have removed the old board before its async
     owner observed cancellation. Start every shared move from a clean grid. */
  clearBountyPresentation();
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
  const placementLandedAt = bountyPresentationNow();

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
      const result = await destroyAt(who, foe, strike.col, die, placementLandedAt, spec.isCurrent);
      if (result.interrupted) return { placed: true, interrupted: true, destroyed };
      destroyed += result.destroyed;
    }
    if (sundered) {
      const result = await destroySunderStrikes(
        who,
        foe,
        strikes.filter((strike) => !strike.warded),
        spec.isCurrent,
      );
      if (result.interrupted) return { placed: true, interrupted: true, destroyed };
      destroyed += result.destroyed;
    }
  } finally {
    clearBountyPresentation();
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
