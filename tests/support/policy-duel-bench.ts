// The deterministic simulator the bot bench measures with: one policy, one
// game, one seat-alternating duel, one keyed pool of games over a weighted mode
// wheel. It is registry- and ladder-agnostic — it takes a bot SHAPE and a pool
// as DATA and never learns a group name, so a retune edits the registry and the
// bands, not this file.
//
// EVERY DRAW IS KEYED. Dice, the human's decisions and the bot's decisions each
// run on their own mulberry32 stream derived from the game seed, so a cell is
// the same number on every machine and a shape change cannot quietly change
// the rolls it receives. Nothing here reads Math.random.
import {
  AI, ME, emptyBoard, legalCols, applyMove, totalOf, isOver,
  CLASSIC, BOUNTY, LIMITED,
  type Mode, type GameState, type Player,
} from '../../src/core/rules.ts';
import { searchRoot } from '../../src/core/ai.ts';
import { makeBag } from '../../src/core/dice.ts';
import { botMoveWithShape, declinesFreeUpgrade, scoreColumns } from '../../src/core/bot.ts';
import type { BotShape } from '../../src/core/ladder.ts';

/* mulberry32, NOT a bare LCG: MINSTD's lattice swung near-deterministic
   policy duels by ±7pp run to run (the colshield decomposition, 2026-08-21
   — 60.6% one stream, 46.0% the next, far beyond sampling error). These
   thresholds may not depend on which stream position a duel starts at. */
export const seeded = (a: number) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* `shape` routes the decision through the production bot seam (slip, sparing
   filter, search); every other field describes a hand-rolled reference. A
   policy's own `mode` is the mode it SEARCHES under; the world it plays in is
   the game's, so a Classic-searching twin in a modded world is expressible. */
export interface Policy extends Partial<BotShape> { random?: boolean; mode?: Mode; shape?: BotShape }
export type WeightedMode = readonly [name: string, mode: Mode, weight: number];

/** Placements that declined a free upgrade, counted with the predicate
    production consults, so the bench and the bot cannot disagree. */
export interface UnforcedTally { placements: number; errors: number }

const rnd = (n: number, random: () => number) => Math.floor(random() * n);

function pick(p: Policy, st: GameState, who: Player, die: number, random: () => number): number {
  const mode = p.mode ?? CLASSIC;
  if (p.shape) return botMoveWithShape(st, who, die, p.shape, mode, random);
  const legal = legalCols(st[who]);
  if (p.random) return legal[rnd(legal.length, random)];
  return searchRoot(st, who, die, p.depth ?? 1, {
    mode,
    random,
    riskWeight: p.risk ?? 0,
    opponentWeight: p.oppW ?? 1,
  }).c;
}

/* One game. `world` is the mode the GAME obeys and scores under; a policy may
   search a different one (that mismatch is what the knowledge cells measure).
   Returns the human seat's outcome (win 1, draw ½, loss 0). */
export function policyGame(bot: Policy, human: Policy, humanFirst: boolean, world: Mode,
                           gameSeed: number, tally?: UnforcedTally): number {
  const st: GameState = [emptyBoard(), emptyBoard()];
  const bounty: [number, number] = [0, 0];
  const humanIdx: Player = humanFirst ? ME : AI;
  const botIdx = (1 - humanIdx) as Player;
  const humanPolicy: Policy = { mode: world, ...human };
  const botPolicy: Policy = { mode: world, ...bot };
  /* Production dice are seeded match truth; bot slips/tie breaks are decision
     randomness. Keep dice and both policies on independent keyed streams so
     changing a shape cannot quietly change the rolls it receives. The same
     gameSeed in the reverse seat uses the same dice. */
  const diceRandom = seeded(gameSeed ^ 0x243F6A88);
  const humanRandom = seeded(gameSeed ^ 0x85A308D3);
  const botRandom = seeded(gameSeed ^ 0x13198A2E);
  const bag = world === LIMITED ? makeBag(diceRandom) : null;
  let turn: Player = ME;
  for (;;) {
    const die = bag ? bag.shift()! : 1 + rnd(6, diceRandom);
    const policy = turn === humanIdx ? humanPolicy : botPolicy;
    const decisionRandom = turn === humanIdx ? humanRandom : botRandom;
    const col = pick(policy, st, turn, die, decisionRandom);
    if (tally && turn === botIdx) {
      tally.placements++;
      if (declinesFreeUpgrade(scoreColumns(st, turn, die, world), col)) tally.errors++;
    }
    const destroyed = applyMove(st, turn, col, die, world);
    if (world === BOUNTY) bounty[turn] += destroyed;
    if (isOver(st[turn], bag ? bag.length : null)) break;
    turn = (1 - turn) as Player;
  }
  const mine = totalOf(st[humanIdx], bounty[humanIdx], world);
  const theirs = totalOf(st[botIdx], bounty[botIdx], world);
  return mine > theirs ? 1 : mine < theirs ? 0 : 0.5;
}

/* Seat-alternating share for `a` over keyed seeds; the first-move edge
   cancels. `a` sits in the human slot, whose share policyGame returns. */
export function duel(a: Policy, b: Policy, n: number, world: Mode = CLASSIC, baseSeed = 0x5EED): number {
  let share = 0;
  for (let g = 0; g < n; g++) {
    const gameSeed = (baseSeed + Math.imul(g + 1, 0x6D2B79F5)) | 0;
    share += policyGame(b, a, g % 2 === 0, world, gameSeed);
  }
  return share / n;
}

export interface PoolCell {
  /** Human outcome share per outcome id. */
  modes: Record<string, number>;
  weighted: number;
  /** The bot's unforced-error rate per outcome id, and pool-weighted. */
  unforced: { byMode: Record<string, number>; weighted: number };
}

export function rankedBotPool(bot: Policy, pool: readonly WeightedMode[],
                              human: Policy, humanFirst: boolean, gamesPerMode: number,
                              baseSeed: number): PoolCell {
  const modes: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  let weighted = 0;
  let unforcedWeighted = 0;
  for (let outcomeIndex = 0; outcomeIndex < pool.length; outcomeIndex++) {
    const [name, mode, weight] = pool[outcomeIndex];
    const tally: UnforcedTally = { placements: 0, errors: 0 };
    let outcome = 0;
    for (let game = 0; game < gamesPerMode; game++) {
      const gameSeed = (baseSeed
        + Math.imul(outcomeIndex + 1, 0x9E3779B1)
        + Math.imul(game + 1, 0x6D2B79F5)) | 0;
      outcome += policyGame(bot, human, humanFirst, mode, gameSeed, tally);
    }
    const rate = outcome / gamesPerMode;
    modes[name] = rate;
    weighted += rate * weight;
    byMode[name] = tally.placements ? tally.errors / tally.placements : 0;
    unforcedWeighted += byMode[name] * weight;
  }
  return { modes, weighted, unforced: { byMode, weighted: unforcedWeighted } };
}
