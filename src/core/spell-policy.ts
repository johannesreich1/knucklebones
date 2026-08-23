import { DICE_FACES } from '../config.ts';
import {
  AI, ME, SPEC, applyMove, boardTotalMode, cloneSt, isFull, legalCols,
  type CharmSt, type GameState, type Mode, type Player,
} from './rules.ts';
import type { CastCtx, SpellSpec } from './spell-types.ts';

/* The immediate worth of placing this die as well as possible: the best swing
   in the score difference one placement can buy. The yardstick every hand
   policy measures against; charm-aware when a scratch charm is passed. */
export function placeGain(
  st: GameState,
  who: Player,
  die: number,
  mode: Mode,
  charm?: CharmSt,
): number {
  const foe = (1 - who) as Player;
  const lead = (s: GameState) => boardTotalMode(s[who], mode) - boardTotalMode(s[foe], mode);
  let best = -Infinity;
  for (const c of legalCols(st[who])) {
    const ns = cloneSt(st);
    const scratch = charm && {
      wards: [charm.wards[0].slice(), charm.wards[1].slice()] as [number[], number[]],
      sunder: [charm.sunder[0], charm.sunder[1]] as [boolean, boolean],
    };
    applyMove(ns, who, c, die, mode, scratch);
    const gain = lead(ns) - lead(st);
    if (gain > best) best = gain;
  }
  return best;
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
  const foe = (1 - who) as Player;
  const lead = (state: GameState) => boardTotalMode(state[who], mode) - boardTotalMode(state[foe], mode);
  const after = cloneSt(st);
  spell.apply(after, who, col, ctx && sandbox(ctx));
  return lead(after) - lead(st);
}

function sandbox(ctx: CastCtx): CastCtx {
  return {
    mode: ctx.mode,
    die: ctx.die,
    bagLeft: ctx.bagLeft,
    setDie() {},
    draw: () => ctx.die,
    charm: {
      wards: [ctx.charm.wards[0].slice(), ctx.charm.wards[1].slice()],
      sunder: [ctx.charm.sunder[0], ctx.charm.sunder[1]],
    },
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
  spell.apply(after, who, pick, sandbox(ctx));
  if (isFull(after[ME]) || isFull(after[AI])) {
    const foe = (1 - who) as Player;
    if (boardTotalMode(after[who], ctx.mode) <= boardTotalMode(after[foe], ctx.mode)) return null;
  }
  return pick;
}
