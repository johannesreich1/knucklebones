// The ladder: one number a player climbs, and the groups it climbs through.
//
// Spec and the measurements behind every constant: docs/LADDER.md. This is the
// ONE implementation — the client draws from it, the gate tests it, and every
// Edge Function that imports it uploads this file verbatim (tools/fnfiles.mjs),
// exactly like core/rules.ts. Pure by contract: no DOM, no timers, no randomness.
//
// It is not Elo any more. Elo is zero-sum and centred; this starts at zero,
// floors at zero, and pays a win more than a loss takes, so the ladder climbs
// for anyone who keeps playing. What it keeps from Elo is the one genuinely
// good idea: what a match is worth depends on who you played.

import {
  APEX_SHARE,
  LADDER_CURVE_VERSION,
  apexForCurve,
  groupsForCurve,
  type BotShape,
  type BotStanding,
  type Group,
  type LadderCurveVersion,
} from './ladder-groups.ts';
import { personalShape } from './bot-personality.ts';
export * from './ladder-groups.ts';
export * from './bot-personality.ts';

/* ---- points ------------------------------------------------------------ */

/* Scale relative to classic Elo. K and the logistic denominator BOTH scale
   with it: at ×5 a 400-point gap is a small gap, so the 400 in the exponent
   has to become 2000. Leaving it at 400 costs 8 points of skill fidelity
   (0.902 → 0.821, measured) and squashes the range — easy to get wrong,
   expensive to notice. */
export const SCALE = 5;
export const K = 32 * SCALE;          // 160
export const DENOM = 400 * SCALE;     // 2000
export const START = 0;
/* A win always pays more than a loss takes: that asymmetry IS the climb, and
   it is why seasons are mandatory rather than optional (docs/LADDER.md §3). */
export const LOSS_MULT = 0.75;
export const MIN_GAIN = 6 * SCALE;    // 30 — a win is never worth nothing
export const MAX_LOSS = 24 * SCALE;   // 120 — one match never guts you

export type Score = 0 | 0.5 | 1;      // loss | draw | win, from my side

/* What one match pays. Never shown before a match — it depends on the
   opponent, so any number previewed is wrong about half the time. */
export function delta(mine: number, theirs: number, score: Score): number {
  /* A draw settles NOTHING, whoever it was against. Elo disagrees, and it is
     not obviously wrong to: holding a player 2000 above you used to pay +65,
     and failing to convert against one 2000 below cost 49. But those numbers
     were only ever reachable by dice — production has recorded no drawn match
     at all in 30 played out — and paying them means the one outcome nobody
     earns is also the one hardest to explain. Simulated at draw rates from 3%
     to 30%, ignoring them costs no skill fidelity and slightly gains it
     (+0.006 at 3%, +0.030 at 30%), because a dice-driven result carries no
     signal to propagate. settle() still records the draw in the tally. */
  if (score === 0.5) return 0;
  const expected = 1 / (1 + Math.pow(10, (theirs - mine) / DENOM));
  const raw = Math.round(K * (score - expected));
  return raw > 0 ? Math.max(raw, MIN_GAIN) : Math.max(Math.round(raw * LOSS_MULT), -MAX_LOSS);
}

/* The floor is 0: a loss at zero costs nothing, so the bottom of the ladder is
   a ratchet rather than a pit. */
export const applyDelta = (points: number, d: number): number => Math.max(0, points + d);

/* ---- settling a match --------------------------------------------------- */

/* One ladder row as the server stores it. */
export interface LadderRow { points: number; peak: number; wins: number; losses: number; draws: number }

/* What a finished match does to both sides. PURE on purpose: three Edge
   Functions end a match — pvp-move when a board fills, pvp-claim when an
   opponent is claimed absent, pvp-join when an abandoned bot match is forfeited
   lazily — and each used to carry its own copy of this arithmetic. The reads
   and writes stay local to each (they are five lines of client code); the
   bookkeeping that can silently disagree lives here, once, with a test. */
export const LADDER_FORMULA_V1 = 1 as const;
export const LADDER_FORMULA_V2 = 2 as const;
export type LadderFormulaVersion = typeof LADDER_FORMULA_V1 | typeof LADDER_FORMULA_V2;
export const LADDER_FORMULA_VERSION: LadderFormulaVersion = LADDER_FORMULA_V2;
export const MIN_FINISH_TRANSFER = 2;
export const MAX_FINISH_TRANSFER = 7;

export interface DeltaComponents {
  /** Opponent-strength delta before the finish transfer. */
  base: number;
  /** Signed, actually funded finish transfer. */
  finish: number;
  /** The signed settlement authority persisted as the match delta. */
  total: number;
}

export type MatchFinish =
  | { kind: 'normal'; aScore: number; bScore: number }
  | { kind: 'forced' };

export interface SettleOptions {
  /* Omit only for a legacy/formula-v1 settle. Formula v2 terminal paths pass
     either authoritative final scores or the forced-outcome discriminator. */
  finish?: MatchFinish;
}

export interface Settled {
  formulaVersion: LadderFormulaVersion;
  /** Backwards-compatible aliases for each seat's total signed delta. */
  da: number;
  db: number;
  aDelta: DeltaComponents;
  bDelta: DeltaComponents;
  a: LadderRow;
  b: LadderRow;
}

/** Requested transfer for a normally completed decisive board. Final scores
 * are authoritative non-negative integers; a draw is not a decisive finish. */
export function requestedFinishTransfer(winnerScore: number, loserScore: number): number {
  if (!Number.isInteger(winnerScore) || !Number.isInteger(loserScore)
    || winnerScore < 0 || loserScore < 0 || winnerScore <= loserScore) {
    throw new RangeError('A decisive finish requires non-negative integer scores and winner > loser.');
  }
  const scoreGap = winnerScore - loserScore;
  const marginShare = scoreGap / Math.max(1, winnerScore);
  return Math.min(
    MAX_FINISH_TRANSFER,
    Math.max(MIN_FINISH_TRANSFER, MIN_FINISH_TRANSFER + Math.round(5 * marginShare)),
  );
}

function requestedTransfer(aScore: Score, finish: MatchFinish | undefined): number {
  if (aScore === 0.5 || !finish) return 0;
  if (finish.kind === 'forced') return MAX_FINISH_TRANSFER;
  const winner = aScore === 1 ? finish.aScore : finish.bScore;
  const loser = aScore === 1 ? finish.bScore : finish.aScore;
  return requestedFinishTransfer(winner, loser);
}

export function settle(
  a: LadderRow,
  b: LadderRow,
  aScore: Score,
  options: SettleOptions = {},
): Settled {
  const aBase = delta(a.points, b.points, aScore);
  const bScore = (1 - aScore) as Score;
  const bBase = delta(b.points, a.points, bScore);
  const request = requestedTransfer(aScore, options.finish);

  let aFinish = 0;
  let bFinish = 0;
  if (request > 0) {
    const loser = aScore === 1 ? b : a;
    const loserBase = aScore === 1 ? bBase : aBase;
    const lossCapRoom = Math.max(0, MAX_LOSS - Math.abs(loserBase));
    const floorRoom = Math.max(0, loser.points + loserBase);
    const applied = Math.min(request, lossCapRoom, floorRoom);
    aFinish = aScore === 1 ? applied : -applied;
    bFinish = -aFinish;
  }

  const aDelta = Object.freeze({ base: aBase, finish: aFinish, total: aBase + aFinish });
  const bDelta = Object.freeze({ base: bBase, finish: bFinish, total: bBase + bFinish });
  const da = aDelta.total;
  const db = bDelta.total;
  const step = (row: LadderRow, d: number, score: Score): LadderRow => {
    const points = applyDelta(row.points, d);
    return {
      points,
      peak: Math.max(row.peak, points),   // a high-water mark is never lowered
      wins: row.wins + (score === 1 ? 1 : 0),
      losses: row.losses + (score === 0 ? 1 : 0),
      draws: row.draws + (score === 0.5 ? 1 : 0),
    };
  };
  return {
    formulaVersion: options.finish ? LADDER_FORMULA_V2 : LADDER_FORMULA_V1,
    da,
    db,
    aDelta,
    bDelta,
    a: step(a, da, aScore),
    b: step(b, db, bScore),
  };
}

/* Is this player inside the apex? `rank` is 1-based, `population` the number of
   rated players in the season. A tiny population has no meaningful 1%, so the
   point floor stands in until there are enough players for a position to mean
   something. */
export function inApex(
  points: number,
  rank: number,
  population: number,
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): boolean {
  if (population < 100) return points >= apexForCurve(version).floor;
  return rank <= Math.max(1, Math.floor(population * APEX_SHARE));
}

/* The group a LEADERBOARD row displays. NEON is a position, so only the apex
   flag the board RPC resolves can grant it — a player whose points cross the
   apex's fallback floor without holding a top-1% rank is shown in the group
   below: points can outgrow OBSIDIAN, but only rank can leave it. */
export function boardGroup(
  points: number,
  apex: boolean,
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): Readonly<Group> {
  const groups = groupsForCurve(version);
  const curveApex = groups[groups.length - 1];
  if (apex) return curveApex;
  const g = groupOf(points, version);
  return g === curveApex ? groups[groups.length - 2] : g;
}

/* A group is the WHOLE rank: there are no divisions inside it.
   Divisions existed to give a nearer milestone and a more frequent promotion,
   and they were paying for that with a segmented ring. Once the ring fills as
   a continuous percentage of the group, the bar already shows which part of it
   you are in and how far the next one is — so "GOLD II" beside a bar reading
   47% was a second, worse way of saying the same fact. Nothing functional ever
   read them: matchmaking pairs on points, bot difficulty on the bot's own
   group, the ladder and the apex on points and rank. */

export function groupOf(
  points: number,
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): Readonly<Group> {
  const groups = groupsForCurve(version);
  let found = groups[0];
  for (const g of groups) if (points >= g.floor) found = g;
  return found;
}

/* How far through the group, 0..1. This is the ring: one continuous fill that
   moves on every single match, which is the feedback a rare promotion is not. */
export function groupFill(
  points: number,
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): number {
  const g = groupOf(points, version);
  if (!g.width) return 1;
  return Math.min(1, Math.max(0, (points - g.floor) / g.width));
}

/* The ring paints the DISPLAY league, not merely the points fallback. NEON is
   awarded by position once the season is large enough, so an apex player may
   sit below 4,350 points and still has no bounded group left to traverse. */
export function groupRingFill(
  points: number,
  apex: boolean,
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): number {
  return apex ? 1 : groupFill(points, version);
}

/* Points still owed to the next group. 0 in the apex, which has nothing above
   it — and which is a POSITION anyway, so no number could name the distance. */
export function toNext(
  points: number,
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): number {
  const g = groupOf(points, version);
  if (!g.width) return 0;
  return Math.ceil(g.floor + g.width - points);
}

/* ---- the peak notch ----------------------------------------------------- */

/* Where the season's high-water mark is drawn, relative to the ring showing
   the CURRENT group (docs/LADDER.md §5):
     at    — peak is where you stand: no notch, the fill's leading edge is gold
     ahead — peak is further up this same group: notch at its true position
     above — peak is in a higher group (you were demoted): notch pinned to the
             far right, "your best is beyond this ring", and the caller names
             the group it really sits in.
   The notch can never sit BEHIND the fill, because a peak is by definition at
   least the current score — so setting a new peak just pushes it along. */
export type PeakState =
  | { kind: 'at' }
  | { kind: 'ahead'; fill: number }
  | { kind: 'above'; group: Group };

export function peakState(
  points: number,
  peak: number,
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): PeakState {
  if (peak <= points) return { kind: 'at' };
  const here = groupOf(points, version), there = groupOf(peak, version);
  if (there !== here) return { kind: 'above', group: there };
  return { kind: 'ahead', fill: groupFill(peak, version) };
}

/* An unbounded positional league has no honest scale on which to place the
   peak. Profile keeps the exact number in its PEAK fact and omits the notch;
   bounded leagues retain the ordinary current-group mapping above. */
export function groupRingPeakState(
  points: number,
  peak: number,
  apex: boolean,
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): PeakState {
  return apex ? { kind: 'at' } : peakState(points, peak, version);
}

/* ---- the bot's group is its strength ------------------------------------ */

/* A bot plays the shape of the group its OWN points sit in. Difficulty tracks
   the player through pairing, and bots' points move through real settles, so a
   bot whose shape loses points sinks toward the group that plays like it — the
   label stays honest by construction. NEON is a POSITION: the apex flag comes
   from the board projection the ladder shows, so points above the fallback
   floor without the rank play OBSIDIAN (boardGroup's rule, consumed here). From
   GOLD up a bot with an id also plays its own personality
   (core/bot-personality.ts): the league is the identity, the personality is how
   far this one bot's attention wanders. */
export const botShapeAt = (
  bot: BotStanding,
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): BotShape => personalShape(
  boardGroup(bot.points, bot.apex, version), groupsForCurve(version), bot.id,
);

/* How far from the human a BACKFILL bot may be: the human's own group width.
   The general matchBand below must open wide when the ladder is sparse or no
   two humans would ever meet — but a bot is minted or picked, never waited
   for, so it has no reason to arrive from two groups up. This cap is what
   keeps "STONE bots are easy" true in STONE: without it a 148-point player
   sat across 784-point IVORY bots (live, 2026-08-20). */
export function botPairBand(
  points: number,
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): number {
  const groups = groupsForCurve(version);
  const g = groupOf(points, version);
  return g.width || groups[groups.length - 2].width;   // the apex borrows OBSIDIAN's
}

/* Matchmaking (humans): a crowded band can stay tight, a sparse one has to
   widen or nobody ever gets a match. */
export const MATCH_BAND_MIN = 150 * SCALE;
export const MATCH_BAND_MAX = 900 * SCALE;

export function matchBand(nearby: number): number {
  if (nearby >= 12) return MATCH_BAND_MIN;
  const t = Math.max(0, nearby) / 12;
  return Math.round(MATCH_BAND_MAX - (MATCH_BAND_MAX - MATCH_BAND_MIN) * t);
}
