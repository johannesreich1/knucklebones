// The numbers and the reference players the bot gates share. Nothing here is
// typed from a run that is not named: a floor is a promise (docs/LADDER.md
// §4), a baseline is a suite's own printed cell, a reference human is one row
// of one table. botbench, bot-knowledge, rune-bot-fairness, ladder and the
// retune sweep all read this file so no two of them can disagree.
import { GROUPS } from '../../src/core/ladder.ts';
import {
  ALL_RANKED_CAPABILITIES, rankedOutcomePool, type RankedPoolTier,
} from '../../src/core/ranked-outcomes.ts';
import { rankedBotPool, type PoolCell, type Policy, type WeightedMode } from './policy-duel-bench.ts';

/* ---- the two promises ---------------------------------------------------- */

/* Human outcome share vs NEWCOMER, both seats, stone..neon. A newcomer — a
   builder who never looks across the table — is favoured through GOLD. Above
   it the apex may be a genuine favourite over a newcomer, but never a points
   drain: a win pays +80 and a loss −60 at level rating, so the human nets
   points at any share above 42.9% (43.3% under v2's finish transfer). */
export const LEAGUE_FLOORS = [0.50, 0.50, 0.50, 0.50, 0.50, 0.47, 0.45] as const;
/* Anyone who looks at the opponent's board is favoured everywhere: LEARNER is
   a depth-one player with full board sight and a modest risk sense — the
   first thing anyone learns is "see the six, kill the six". */
export const LEARNER_FLOOR = 0.60;
/* From GOLD up each league is measurably harder than the one below, in both
   seats. Depth does not separate them (measured); only slip does. */
export const SEPARATION_MIN = 0.02;
/* A slip may never decline a free upgrade (docs/LADDER.md §4): the residual
   after the rule is search-branch decisions with a story. STONE's kindness
   does not bend this: sparing filters by opponent loss, and a free upgrade is
   judged within an equal-loss class, so a kind column is never a free
   upgrade declined (measured 4.6% / 4.5% at STONE, the same as every league,
   2026-09-02). */
export const UNFORCED_ERROR_CEILING = 0.04;

/* ---- one reference table, three humans ----------------------------------- */

export const RANDOM: Policy = { random: true };
/** Builds, never looks at your board. The yardstick of the onboarding promise. */
export const NEWCOMER: Policy = { depth: 1, oppW: 0, risk: 0 };
/** Looks at your board, nothing else: depth one, full sight, a little fear. */
export const LEARNER: Policy = { depth: 1, oppW: 1, risk: 0.6 };

/* ---- Rune Trial ----------------------------------------------------------- */

/* Rune Trial is new at IVORY. A player who never uses a dealt rune can be an
   underdog in that outcome, so IVORY's permanent-pool aggregate substitutes a
   deliberately harsher share for a never-casting novice. From SILVER up the
   aggregate uses the production-path cell measured by
   tests/rune-bot-fairness.test.ts, pinned here exactly (that suite fails when
   its own run disagrees; regenerate both from ONE direct run). Re-measuring
   inside botbench was rejected: it would move 10,000 replayed games into a
   suite already near its shard budget. */
export const NOVICE_RUNE_FLOOR = { humanFirst: 0.38, botFirst: 0.40 } as const;
export const RUNE_CELL_BASELINE: Readonly<Record<string, { humanFirst: number; botFirst: number }>> = {
  // Measured 2026-09-02 with the cast decided on merit at each shape's castDemand.
  ivory: { humanFirst: 0.562, botFirst: 0.5255 },
  silver: { humanFirst: 0.512, botFirst: 0.5645 },
  gold: { humanFirst: 0.516, botFirst: 0.5595 },
  obsidian: { humanFirst: 0.5175, botFirst: 0.5365 },
  neon: { humanFirst: 0.5125, botFirst: 0.5195 },
};
export function runeCell(index: number, humanFirst: boolean): number {
  if (index <= 2) return humanFirst ? NOVICE_RUNE_FLOOR.humanFirst : NOVICE_RUNE_FLOOR.botFirst;
  const cell = RUNE_CELL_BASELINE[GROUPS[index].id];
  if (!cell) throw new Error(`no measured Rune cell for ${GROUPS[index].id}`);
  return humanFirst ? cell.humanFirst : cell.botFirst;
}

/* ---- the league cells ----------------------------------------------------- */

/* Read the real wheel instead of copying its weights here. Rune Trial remains
   a distinct reported outcome while its underlying board uses Classic; the
   dedicated rune suites own the spell decisions. */
export function productionPool(tier: RankedPoolTier): readonly WeightedMode[] {
  const entries = rankedOutcomePool([{ tier, capabilities: ALL_RANKED_CAPABILITIES }]);
  const total = entries.reduce((sum, { weight }) => sum + weight, 0);
  return entries.map(({ outcome, weight }) => [outcome.id, outcome.mode, weight / total] as const);
}

/** The same cell re-weighted over another reachable pool. */
export const reweight = (cell: PoolCell, pool: readonly WeightedMode[]): PoolCell => ({
  ...cell,
  weighted: pool.reduce((sum, [name, , weight]) => sum + cell.modes[name] * weight, 0),
  unforced: {
    ...cell.unforced,
    weighted: pool.reduce((sum, [name, , weight]) => sum + cell.unforced.byMode[name] * weight, 0),
  },
});

/* Deterministic gate cells are sized by search depth so the suite fits its
   shard; the bands carry ±3pp for it. */
export const curveGames = (index: number, depth: number) => index < 3 ? 600
  : depth >= 4 ? 400 : depth >= 3 ? 400 : depth >= 2 ? 600 : 800;

export interface LeagueCells {
  newcomer: { humanFirst: PoolCell; botFirst: PoolCell };
  learner: { humanFirst: PoolCell; botFirst: PoolCell };
}

/* ONE composition of a league's cells — both seats vs NEWCOMER over the IVORY
   wheel, plus LEARNER at half the games — read by botbench and by the retune
   sweep, so a sweep at the shipped shape reproduces the bench cell exactly. */
export function measureLeagueCells(bot: Policy, index: number, seed = 7200): LeagueCells {
  const pool = productionPool('ivory');
  const games = curveGames(index, bot.shape?.depth ?? bot.depth ?? 1);
  return {
    newcomer: {
      humanFirst: rankedBotPool(bot, pool, NEWCOMER, true, games, seed),
      botFirst: rankedBotPool(bot, pool, NEWCOMER, false, games, seed),
    },
    learner: {
      humanFirst: rankedBotPool(bot, pool, LEARNER, true, games / 2, seed + 1),
      botFirst: rankedBotPool(bot, pool, LEARNER, false, games / 2, seed + 1),
    },
  };
}

/* The published §4 cells (human opens / bot opens, per league) from botbench's
   own report; tests/ladder.test.ts holds docs/LADDER.md to them. Filled by
   the retune release. */
export const LEAGUE_CELL_BASELINE: Readonly<Record<string, { humanOpens: number; botOpens: number }>> = {};
