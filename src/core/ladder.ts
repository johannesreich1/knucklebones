// The ladder: one number a player climbs, and the groups it climbs through.
//
// Spec and the measurements behind every constant: docs/LADDER.md. This is the
// ONE implementation — the client draws from it, the gate tests it, and the
// Edge Functions import a copy of it (supabase/functions/*/core), exactly like
// core/rules.ts. Pure by contract: no DOM, no timers, no randomness.
//
// It is not Elo any more. Elo is zero-sum and centred; this starts at zero,
// floors at zero, and pays a win more than a loss takes, so the ladder climbs
// for anyone who keeps playing. What it keeps from Elo is the one genuinely
// good idea: what a match is worth depends on who you played.

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
export interface Settled { da: number; db: number; a: LadderRow; b: LadderRow }

export function settle(a: LadderRow, b: LadderRow, aScore: Score): Settled {
  const da = delta(a.points, b.points, aScore);
  const db = delta(b.points, a.points, (1 - aScore) as Score);
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
  return { da, db, a: step(a, da, aScore), b: step(b, db, (1 - aScore) as Score) };
}

/* ---- groups --------------------------------------------------------- */

export interface Group {
  id: string;
  name: string;
  floor: number;
  width: number;   // 0 for the apex, which has no ceiling
}

/* Widths grow ~×1.35. Equal widths were the first proposal and the measurement
   killed them: every group took 64–77 games, so leaving STONE cost the same as
   reaching OBSIDIAN. Two independent things make climbing harder now — a match
   pays less when you outrank your opponent, and a group costs more than the
   last. Widths stay round numbers out of habit rather than need — the ring is
   one continuous fill now, so nothing has to divide evenly into it. */
export const GROUPS: readonly Group[] = [
  { id: 'stone',    name: 'STONE',    floor: 0,    width: 300 },
  { id: 'bone',     name: 'BONE',     floor: 300,  width: 420 },
  { id: 'ivory',    name: 'IVORY',    floor: 720,  width: 540 },
  { id: 'silver',   name: 'SILVER',   floor: 1260, width: 750 },
  { id: 'gold',     name: 'GOLD',     floor: 2010, width: 990 },
  { id: 'obsidian', name: 'OBSIDIAN', floor: 3000, width: 1350 },
  { id: 'neon',     name: 'NEON',     floor: 4350, width: 0 },
];

/* NEON is a POSITION, not a threshold. An always-climbing ladder is a ratchet:
   given enough games everyone arrives at the top — 735 of 900 simulated players
   cleared a fixed apex in 600 games, at which point it is a participation
   certificate. Its `floor` above is only a display fallback for a population
   too small to have a 1%. The real test is inApex(). */
export const APEX = GROUPS[GROUPS.length - 1];
export const APEX_SHARE = 0.01;

/* Is this player inside the apex? `rank` is 1-based, `population` the number of
   rated players in the season. A tiny population has no meaningful 1%, so the
   point floor stands in until there are enough players for a position to mean
   something. */
export function inApex(points: number, rank: number, population: number): boolean {
  if (population < 100) return points >= APEX.floor;
  return rank <= Math.max(1, Math.floor(population * APEX_SHARE));
}

/* A group is the WHOLE rank: there are no divisions inside it.
   Divisions existed to give a nearer milestone and a more frequent promotion,
   and they were paying for that with a segmented ring. Once the ring fills as
   a continuous percentage of the group, the bar already shows which part of it
   you are in and how far the next one is — so "GOLD II" beside a bar reading
   47% was a second, worse way of saying the same fact. Nothing functional ever
   read them: matchmaking pairs on points, bot difficulty on percentile, the
   leaderboard and the apex on points and rank. */

export function groupOf(points: number): Group {
  let found = GROUPS[0];
  for (const g of GROUPS) if (points >= g.floor) found = g;
  return found;
}

/* "GOLD" — the group IS the rank */
export const rankName = (points: number): string => groupOf(points).name;

/* How far through the group, 0..1. This is the ring: one continuous fill that
   moves on every single match, which is the feedback a rare promotion is not. */
export function groupFill(points: number): number {
  const g = groupOf(points);
  if (!g.width) return 1;
  return Math.min(1, Math.max(0, (points - g.floor) / g.width));
}

/* Points still owed to the next group. 0 in the apex, which has nothing above
   it — and which is a POSITION anyway, so no number could name the distance. */
export function toNext(points: number): number {
  const g = groupOf(points);
  if (!g.width) return 0;
  return Math.ceil(g.floor + g.width - points);
}

export const nextRankName = (points: number): string => {
  const g = groupOf(points);
  if (!g.width) return g.name;
  return GROUPS[GROUPS.indexOf(g) + 1].name;
};

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

export function peakState(points: number, peak: number): PeakState {
  if (peak <= points) return { kind: 'at' };
  const here = groupOf(points), there = groupOf(peak);
  if (there !== here) return { kind: 'above', group: there };
  return { kind: 'ahead', fill: groupFill(peak) };
}

/* ---- percentile → difficulty -------------------------------------------- */

/* Absolute point thresholds stop meaning anything the moment the ladder
   inflates, so everything that used to key off a rating number keys off the
   player's share of the population instead. `pct` is 0 at the bottom, 1 at the
   top. Replaces the 820 / 1080 / 1150 constants pvp-move used to carry. */
export interface BotShape { depth: number; risk: number; slip: number }

export function botShape(pct: number): BotShape {
  const p = Math.min(1, Math.max(0, pct));
  if (p < 0.20) return { depth: 1, risk: 0,    slip: 0.50 };
  if (p < 0.60) return { depth: 1, risk: (p - 0.20) / 0.40 * 0.6, slip: 0.18 };
  if (p < 0.85) return { depth: 2, risk: 1,    slip: 0 };
  return { depth: 3, risk: 1, slip: 0 };
}

/* Matchmaking looks at the same number from the other end: a crowded band can
   stay tight, a sparse one has to widen or nobody ever gets a match. */
export const MATCH_BAND_MIN = 150 * SCALE;
export const MATCH_BAND_MAX = 900 * SCALE;

export function matchBand(nearby: number): number {
  if (nearby >= 12) return MATCH_BAND_MIN;
  const t = Math.max(0, nearby) / 12;
  return Math.round(MATCH_BAND_MAX - (MATCH_BAND_MAX - MATCH_BAND_MIN) * t);
}
