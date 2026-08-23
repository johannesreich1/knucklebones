// Expectimax search with a risk term — pure, DOM-free, tuned by self-play.
// PERFORMANCE: this is the game's hot path. colScore/countOf run millions of
// times per move; Hard decides whether to search a 5th ply by timing the 4th
// against an 18ms budget, so slowing anything here quietly weakens the CPU on
// mid-range phones. Benchmark with tests/bench3.mjs before changing (and skip
// the first JIT-cold run when reading its numbers).
import { DICE_FACES } from '../config.ts';
import {
  AI, ME, SPEC, type GameState, type Player, type Mode,
  CLASSIC, ROWSWITCH, SINGLESTRIKE, BOUNTY,
  cloneSt, applyMove, legalCols, boardTotalMode, countOf, isFull,
} from './rules.ts';

let NODES = 0;
const BUDGET = 500000;                  // node cap: search degrades, never hangs
/* How much of the OPPONENT's board the eval sees. At 1 a full duelist, at 0 a
   pure builder that never AIMS a destroy (they still happen when its best
   build collides). NEGATIVE is the floor's floor: the eval prefers placements
   that SPARE the opponent's dice — passivity, the one below-random weakness
   that reads as a beginner rather than a drunk (slip alone cannot get below
   random-parity, because the un-slipped half of a greedy still takes every
   kill — measured: d1 slip .5 wins 60% vs random). STONE ships at -0.5.
   AI-seat perspective, like the eval itself: every bot in the game sits there. */

export const nodes = () => NODES;

/* expected value a player stands to lose to one enemy placement in a facing
   column. Mode heuristics: ROWSWITCH — a destroyed stack loses roughly its
   face value, not the squared column score (columns don't multiply there), so
   risk goes linear.
   COLSHIELD is deliberately ABSENT here. The risk model once skipped shielded
   columns — a true fact, and a measured loss: closing a column deleted its k²
   risk from the eval, so the searcher slammed columns shut on junk to bank
   the safety, and a d2/r0.9 bot with the skip won only 44.5% of colshield
   games against a twin scoring risk as CLASSIC (6,000 games, 10 mulberry32
   seeds; the skip cost 3–6pp in every decomposition, own-side-only variants
   included). Classic fear of a full column is wrong as a fact but right as a
   proxy for the upside a closed column forfeits — the eval has no term for
   foregone triples, so the phantom risk stands in for it. The TRUE dynamics
   stay in the search: applyMove knows shields block destroys (measured
   neutral, 50.2% vs a fully blind twin). */
export function riskOf(st: GameState, p: Player, mode: Mode = CLASSIC): number {
  const o = 1 - p, mine = st[p], theirs = st[o];
  let r = 0;
  for (let c = 0; c < SPEC.cols; c++) {
    if (theirs[c].length >= SPEC.rows) continue;   // they can't play into this column any more
    const col = mine[c];
    for (let v = 1; v <= DICE_FACES; v++) {
      const k = countOf(col, v);
      if (!k) continue;
      // 1-in-DICE_FACES chance they roll exactly this value. Per-mode loss:
      // SINGLESTRIKE removes one die from a k-stack (v·k² → v·(k−1)², so
      // v·(2k−1)); BOUNTY adds the +1/die they bank on top of the classic hit.
      const loss = mode === ROWSWITCH ? v * k
        : mode === SINGLESTRIKE ? v * (2 * k - 1)
        : mode === BOUNTY ? v * k * k + k
        : v * k * k;
      r += loss / DICE_FACES;
    }
  }
  return r;
}

function evalSt(st: GameState, options: ResolvedSearchOptions): number {
  const { mode, opponentWeight, riskWeight } = options;
  let s = boardTotalMode(st[AI], mode) - opponentWeight * boardTotalMode(st[ME], mode);
  if (riskWeight) s += riskWeight * (riskOf(st, ME, mode) - riskOf(st, AI, mode));
  return s;
}

export interface SearchResult { v: number; c: number; }
export interface SearchOptions {
  /** Required so callers choose replayable or ambient randomness explicitly. */
  random: () => number;
  mode?: Mode;
  /** Tuned default: 1.5 (55.3% vs risk-blind over 500 self-play games). */
  riskWeight?: number;
  opponentWeight?: number;
}

interface ResolvedSearchOptions {
  random: () => number;
  mode: Mode;
  riskWeight: number;
  opponentWeight: number;
}

export function searchRoot(st: GameState, who: Player, die: number, depth: number,
                           options: SearchOptions): SearchResult {
  NODES = 0;
  return search(st, who, die, depth, {
    random: options.random,
    mode: options.mode ?? CLASSIC,
    riskWeight: options.riskWeight ?? 1.5,
    opponentWeight: options.opponentWeight ?? 1,
  });
}

function search(st: GameState, who: Player, die: number, depth: number,
                options: ResolvedSearchOptions): SearchResult {
  NODES++;
  const { mode, random } = options;
  const legal = legalCols(st[who]);
  let bestV = who === AI ? -1e9 : 1e9, bestC = legal[0];
  for (const c of legal) {
    const ns = cloneSt(st);
    applyMove(ns, who, c, die, mode);
    let v: number;
    if (isFull(ns[who])) {
      const d = boardTotalMode(ns[AI], mode) - boardTotalMode(ns[ME], mode);   // game over: material only
      v = d + (d > 0 ? 14 : d < 0 ? -14 : 0);
    } else if (depth <= 1 || NODES > BUDGET) {
      v = evalSt(ns, options);
    } else {
      let sum = 0;
      for (let d = 1; d <= DICE_FACES; d++) {
        sum += search(ns, (1 - who) as Player, d, depth - 1, options).v;
      }
      v = sum / DICE_FACES;
    }
    v += (random() - 0.5) * 1e-4;                         // tie-break jitter
    if (who === AI ? v > bestV : v < bestV) { bestV = v; bestC = c; }
  }
  return { v: bestV, c: bestC };
}
