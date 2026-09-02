import { DICE_FACES } from '../config.ts';
import {
  AI, ME, SPEC, applyMove, boardTotalMode, cloneCharm, cloneSt, isFull, legalCols,
  type CharmSt, type GameState, type Mode, type Player,
} from './rules.ts';
import type { CastCtx, SpellSpec } from './spell-types.ts';

/* Normal usually honors a registry-coordinated follow-up placement, but keeps
   this small, measured imperfection. Flow and the standard evaluator share the
   token so the simulated policy cannot silently drift from the shipped bot. */
export const NORMAL_CHARM_COORDINATION_SLIP_RATE = 0.05;

export interface ImmediatePlacementOptions {
  charm?: CharmSt;
  /* Some modes bank value outside the boards. Keep that policy explicit so
     adding BOUNTY's +1 here cannot silently retune older spell policies. */
  bankPerKill?: number;
}

/* The immediate worth of placing this die as well as possible: the best swing
   in score difference one placement can buy, plus any explicitly requested
   off-board value per destroyed die. */
export function immediatePlacementGain(
  st: GameState,
  who: Player,
  die: number,
  mode: Mode,
  options: ImmediatePlacementOptions = {},
): number {
  const { charm, bankPerKill = 0 } = options;
  const before = leadOf(st, who, mode, charm);
  let best = -Infinity;
  for (const c of legalCols(st[who])) {
    const ns = cloneSt(st);
    const scratch = charm && cloneCharm(charm);
    const killed = applyMove(ns, who, c, die, mode, scratch);
    const gain = leadOf(ns, who, mode, scratch) - before + killed * bankPerKill;
    if (gain > best) best = gain;
  }
  return best;
}

function leadOf(
  st: GameState,
  who: Player,
  mode: Mode,
  charm?: CharmSt,
): number {
  const foe = (1 - who) as Player;
  return boardTotalMode(st[who], mode, charm?.wards[who])
    - boardTotalMode(st[foe], mode, charm?.wards[foe]);
}

/* Established board-only yardstick used by FATE/NUDGE and legacy tuning.
   Charm is optional; off-board bounty remains opt-in through the seam above. */
export function placeGain(
  st: GameState,
  who: Player,
  die: number,
  mode: Mode,
  charm?: CharmSt,
): number {
  return immediatePlacementGain(st, who, die, mode, { charm });
}

/* The charm an ordinary PLACEMENT search must see: every persistent WARD
   mark on either board — they change what a column scores and what a destroy
   can reach — but deliberately NOT a pending one-shot SUNDER, which belongs
   to the cast that projects it (a coordinated cast passes its own charm
   instead). Undefined when nothing is live, so the charm-free hot path keeps
   allocating nothing. Offline and ranked ask this one question. */
export function placementCharm(charm: CharmSt): CharmSt | undefined {
  if (!charm.wards[AI].some(Boolean) && !charm.wards[ME].some(Boolean)) return undefined;
  const searchCharm = cloneCharm(charm);
  searchCharm.sunder = [false, false];
  return searchCharm;
}

/* The one-column valuation WARD's catalog policy needs. */
export function colScoreOf(col: number[]): number {
  let score = 0;
  for (let value = 1; value <= DICE_FACES; value++) {
    let count = 0;
    for (const die of col) if (die === value) count++;
    if (count) score += value * count * count;
  }
  return score;
}

/* The swing in score difference from `who`'s side. Weighing a cast must never
   play it, so the boards and optional charm context are sandboxed. */
export function swingOf(
  st: GameState,
  who: Player,
  spell: SpellSpec,
  col: number,
  mode: Mode,
  ctx?: CastCtx,
): number {
  const after = cloneSt(st);
  const afterCtx = ctx && sandbox(ctx);
  spell.apply(after, who, col, afterCtx);
  return leadOf(after, who, mode, afterCtx?.charm) - leadOf(st, who, mode, ctx?.charm);
}

function sandbox(ctx: CastCtx): CastCtx {
  return {
    mode: ctx.mode,
    die: ctx.die,
    bagLeft: ctx.bagLeft,
    setDie() {},
    draw: () => ctx.die,
    charm: cloneCharm(ctx.charm),
  };
}

/* The best legal target and what it is worth, or null if none is legal. Ties
   go to the lower column, so the choice is deterministic and replayable. */
export function bestTarget(
  st: GameState,
  who: Player,
  spell: SpellSpec,
  mode: Mode,
  ctx?: CastCtx,
): { col: number; swing: number } | null {
  let best: { col: number; swing: number } | null = null;
  for (let col = 0; col < SPEC.cols; col++) {
    if (!spell.legal(st, who, col, ctx)) continue;
    const swing = swingOf(st, who, spell, col, mode, ctx);
    if (!best || swing > best.swing) best = { col, swing };
  }
  return best;
}

/* The machine's cast decision. Returns a column (−1 for a self spell), or
   null to hold the charge. `demand` is points of score difference. */
export function machineCast(
  st: GameState,
  who: Player,
  spell: SpellSpec,
  ctx: CastCtx,
  demand: number,
): number | null {
  const room = st[who].reduce((count, col) => count + (SPEC.rows - col.length), 0);
  const effectiveDemand = room <= 1 ? 1 : demand;
  let pick: number | null;
  if (spell.cpuCast) {
    pick = spell.cpuCast(st, who, ctx, effectiveDemand);
  } else {
    const best = bestTarget(st, who, spell, ctx.mode, ctx);
    pick = best && best.swing >= effectiveDemand ? best.col : null;
  }
  if (pick === null || !spell.legal(st, who, pick, ctx)) return null;

  // Never end the game on itself from behind.
  const after = cloneSt(st);
  const afterCtx = sandbox(ctx);
  spell.apply(after, who, pick, afterCtx);
  if (isFull(after[ME]) || isFull(after[AI])) {
    const foe = (1 - who) as Player;
    if (boardTotalMode(after[who], ctx.mode, afterCtx.charm.wards[who])
        <= boardTotalMode(after[foe], ctx.mode, afterCtx.charm.wards[foe])) return null;
  }
  return pick;
}

export interface MachineCastPlan {
  target: number | null;
  /* The one placement inspected while coordinating the cast. Callers may
     reuse it or deliberately make their ordinary choice again. Null means
     this cast needed no placement preview. */
  placement: number | null;
  rootCharm: CharmSt | null;
  vetoedByPlacement: boolean;
}

/* Coordinate a spell's registry-owned placement hazards and projected root
   charm with the ordinary placement policy. The cast decision itself stays
   machineCast's answer; only a spell that declares one of those hooks asks
   for a placement preview. */
export function machineCastPlan(
  st: GameState,
  who: Player,
  spell: SpellSpec,
  ctx: CastCtx,
  demand: number,
  previewPlacement?: (rootCharm?: CharmSt) => number,
): MachineCastPlan {
  const target = machineCast(st, who, spell, ctx, demand);
  if (target === null || !previewPlacement) {
    return { target, placement: null, rootCharm: null, vetoedByPlacement: false };
  }
  const rootCharm = spell.cpuRootCharm?.(st, who, target, ctx) ?? null;
  const forbidden = spell.cpuForbiddenPlacements?.(st, who, target, ctx) ?? [];
  if (!rootCharm && !forbidden.length) {
    return { target, placement: null, rootCharm: null, vetoedByPlacement: false };
  }
  const placement = previewPlacement(rootCharm ?? undefined);
  const vetoedByPlacement = forbidden.includes(placement);
  return {
    target: vetoedByPlacement ? null : target,
    placement,
    rootCharm,
    vetoedByPlacement,
  };
}
