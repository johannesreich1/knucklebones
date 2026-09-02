// The deterministic simulator the bot bench measures with: one policy, one
// game, one seat-alternating duel, one keyed pool of games over a weighted mode
// wheel. It is registry- and ladder-agnostic — it takes a bot SHAPE and a pool
// as DATA and never learns a group name, so a retune edits the registry and the
// bands, not this file.
//
// AMBIENT STREAM, ON PURPOSE: rnd/pick/play/duel reach randomness through
// `random: () => number = Math.random` default parameters, which resolve per
// call. That is the only reason the bench's one-time `Math.random = seeded(...)`
// reaches in here at all. Do not "tidy" those defaults into a module-scope
// `const ambient = Math.random`: the bench would silently run on the machine's
// unseeded stream and every threshold would become machine-dependent — a flake
// that reads as a retune regression rather than as a refactor bug.
import {
  AI, ME, emptyBoard, legalCols, applyMove, totalOf, isOver,
  CLASSIC, BOUNTY, LIMITED,
  type Mode, type GameState, type Player,
} from '../../src/core/rules.ts';
import { searchRoot } from '../../src/core/ai.ts';
import { makeBag } from '../../src/core/dice.ts';
import { botMoveWithShape } from '../../src/core/bot.ts';
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
   filter, search); every other field describes a hand-rolled reference. */
export interface Policy extends Partial<BotShape> { random?: boolean; mode?: Mode; shape?: BotShape }
export type WeightedMode = readonly [name: string, mode: Mode, weight: number];

const rnd = (n: number, random: () => number = Math.random) => Math.floor(random() * n);

function pick(p: Policy, st: ReturnType<typeof emptyBoard>[], who: 0 | 1, die: number,
              random: () => number = Math.random): number {
  if (p.shape) return botMoveWithShape(st as GameState, who, die, p.shape, p.mode ?? CLASSIC, random);
  const legal = legalCols(st[who]);
  if (p.random || (p.slip && random() < p.slip)) return legal[rnd(legal.length, random)];
  return searchRoot(st as never, who, die, p.depth ?? 1, {
    mode: p.mode ?? CLASSIC,
    random,
    riskWeight: p.risk ?? 0,
    opponentWeight: p.oppW ?? 1,
  }).c;
}

/* seatME moves first; returns the AI seat's score for one game. world is the
   mode the GAME obeys — a policy
   may search a different one (that mismatch is what §4 measures). */
function play(seatAI: Policy, seatME: Policy, world: Mode = CLASSIC): number {
  const st = [emptyBoard(), emptyBoard()];
  let turn: 0 | 1 = ME as 1, i = 0;
  for (;;) {
    const die = 1 + rnd(6);
    applyMove(st as never, turn, pick(turn === AI ? seatAI : seatME, st, turn, die), die, world);
    i++;
    if (isOver(st[turn], null)) break;
    turn = (1 - turn) as 0 | 1;
  }
  const a = totalOf(st[AI], 0, world), m = totalOf(st[ME], 0, world);
  return a > m ? 1 : a < m ? 0 : 0.5;
}

/* seats alternate so the first-move edge cancels; share for a */
export const duel = (a: Policy, b: Policy, n: number, world: Mode = CLASSIC) => {
  let w = 0;
  for (let g = 0; g < n; g++) w += g % 2 ? 1 - play(b, a, world) : play(a, b, world);
  return w / n;
};

function policyGame(bot: Policy, human: Policy, humanFirst: boolean, mode: Mode,
                    gameSeed: number): number {
  const st: GameState = [emptyBoard(), emptyBoard()];
  const bounty: [number, number] = [0, 0];
  const humanIdx: Player = humanFirst ? ME : AI;
  const botIdx = (1 - humanIdx) as Player;
  const humanPolicy = { ...human, mode };
  const botPolicy: Policy = { ...bot, mode };
  /* Production dice are seeded match truth; bot slips/tie breaks are ambient
     decision randomness. Keep dice and both policies on independent keyed
     streams so changing a shape cannot quietly change the rolls it receives.
     The same gameSeed in the reverse seat uses the same dice. */
  const diceRandom = seeded(gameSeed ^ 0x243F6A88);
  const humanRandom = seeded(gameSeed ^ 0x85A308D3);
  const botRandom = seeded(gameSeed ^ 0x13198A2E);
  const bag = mode === LIMITED ? makeBag(diceRandom) : null;
  let turn: Player = ME;
  for (;;) {
    const die = bag ? bag.shift()! : 1 + rnd(6, diceRandom);
    const policy = turn === humanIdx ? humanPolicy : botPolicy;
    const decisionRandom = turn === humanIdx ? humanRandom : botRandom;
    const destroyed = applyMove(st, turn, pick(policy, st, turn, die, decisionRandom), die, mode);
    if (mode === BOUNTY) bounty[turn] += destroyed;
    if (isOver(st[turn], bag ? bag.length : null)) break;
    turn = (1 - turn) as Player;
  }
  const mine = totalOf(st[humanIdx], bounty[humanIdx], mode);
  const theirs = totalOf(st[botIdx], bounty[botIdx], mode);
  return mine > theirs ? 1 : mine < theirs ? 0 : 0.5;
}

export function rankedBotPool(bot: Policy, pool: readonly WeightedMode[],
                              human: Policy, humanFirst: boolean, gamesPerMode: number,
                              baseSeed: number) {
  const modes: Record<string, number> = {};
  let weighted = 0;
  for (let outcomeIndex = 0; outcomeIndex < pool.length; outcomeIndex++) {
    const [name, mode, weight] = pool[outcomeIndex];
    let outcome = 0;
    for (let game = 0; game < gamesPerMode; game++) {
      const gameSeed = (baseSeed
        + Math.imul(outcomeIndex + 1, 0x9E3779B1)
        + Math.imul(game + 1, 0x6D2B79F5)) | 0;
      outcome += policyGame(bot, human, humanFirst, mode, gameSeed);
    }
    const rate = outcome / gamesPerMode;
    modes[name] = rate;
    weighted += rate * weight;
  }
  return { modes, weighted };
}
