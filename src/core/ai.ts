// Expectimax search with a risk term — pure, DOM-free, tuned by self-play.
// PERFORMANCE: this is the game's hot path. colScore/countOf run millions of
// times per move; Hard decides whether to search a 5th ply by timing the 4th
// against an 18ms budget, so slowing anything here quietly weakens the CPU on
// mid-range phones. Benchmark with tests/col-score-bench.mjs before changing
// (and skip the first JIT-cold run when reading its numbers).
import { DICE_FACES } from '../config.ts';
import {
  SPEC, type GameState, type Player, type Mode,
  CLASSIC, ROWSWITCH, SINGLESTRIKE, BOUNTY,
  bountyFor, cloneCharm, cloneSt, applyMove, legalCols, boardTotalMode, countOf, isFull,
  type CharmSt,
} from './rules.ts';

/** Points banked off the boards, by Player. BOUNTY's are real; every other
    mode's are this shared zero pair, so the classic path allocates nothing. */
export type Bank = readonly [number, number];
const NO_BANK: Bank = [0, 0];

let NODES = 0;
const BUDGET = 500000;                  // node cap: search degrades, never hangs
/* How much of the OPPONENT's board the eval sees. At 1 a full duelist, at 0 a
   pure builder that never AIMS a destroy (they still happen when its best
   build collides). NEGATIVE is the floor's floor: the eval prefers placements
   that SPARE the opponent's dice — passivity, the one below-random weakness
   that reads as a beginner rather than a drunk (slip alone cannot get below
   random-parity, because the un-slipped half of a greedy still takes every
   kill — measured: d1 slip .5 wins 60% vs random). STONE ships at -0.5.

   The perspective is the player passed to searchRoot, not the historical AI
   seat. Ranked bots may open as P1/ME, and applying a negative opponent weight
   from the fixed AI seat reverses its meaning: "spare the newcomer" becomes
   "minimise the newcomer's score" exactly when the gentle bot opens. */

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

function evalSt(st: GameState, options: ResolvedSearchOptions, charm: CharmSt | undefined,
                bank: Bank): number {
  const { perspective, mode, opponentWeight, riskWeight } = options;
  const opponent = (1 - perspective) as Player;
  let s = boardTotalMode(st[perspective], mode, charm?.wards[perspective])
    - opponentWeight * boardTotalMode(st[opponent], mode, charm?.wards[opponent]);
  /* A kill's bounty is seen the way the opponent's board is seen: a builder
     that never looks across the table (oppW 0, or STONE's sparing −0.5) does
     not hunt bounties either, so the bank enters the eval at the opponent
     weight's sight. The terminal branch pays the full bank — what totalOf
     pays. Measured 2026-09-02: against a Classic-eval twin a full-sight
     bank-aware search is parity (51.1%); a kill already pays v·k² on the
     board and the +1 is within noise. Unweighted, the bank turned the
     bench's blind NEWCOMER into a kill hunter (+20pp in BOUNTY). */
  const sight = Math.max(0, Math.min(1, opponentWeight));
  s += sight * (bank[perspective] - opponentWeight * bank[opponent]);
  if (riskWeight) {
    s += riskWeight * (riskOf(st, opponent, mode) - riskOf(st, perspective, mode));
  }
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
  /** Exact charm state at the root. It is cloned per candidate and carried
      through deeper plies so persistent WARD marks remain scoreable and
      attackable. One-shot SUNDER is naturally consumed by the root move. */
  rootCharm?: CharmSt;
  /** BOUNTY: the points each player has already banked at the root — the
      same pair MatchState, RankedActionState and the local S.bounty hold.
      The search carries every kill's bounty down the tree and scores the
      bank exactly as totalOf does, so it plays for what the game pays.
      Ignored in every other mode. */
  bounty?: Bank;
}

interface ResolvedSearchOptions {
  perspective: Player;
  random: () => number;
  mode: Mode;
  riskWeight: number;
  opponentWeight: number;
}

export function searchRoot(st: GameState, who: Player, die: number, depth: number,
                           options: SearchOptions): SearchResult {
  NODES = 0;
  const mode = options.mode ?? CLASSIC;
  return search(st, who, die, depth, {
    perspective: who,
    random: options.random,
    mode,
    riskWeight: options.riskWeight ?? 1.5,
    opponentWeight: options.opponentWeight ?? 1,
  }, options.rootCharm, mode === BOUNTY && options.bounty ? options.bounty : NO_BANK);
}

function search(st: GameState, who: Player, die: number, depth: number,
                options: ResolvedSearchOptions, charm?: CharmSt, bank: Bank = NO_BANK): SearchResult {
  NODES++;
  const { perspective, mode, random } = options;
  const legal = legalCols(st[who]);
  const maximizing = who === perspective;
  let bestV = maximizing ? -1e9 : 1e9, bestC = legal[0];
  for (const c of legal) {
    const ns = cloneSt(st);
    const nextCharm = charm && cloneCharm(charm);
    const killed = applyMove(ns, who, c, die, mode, nextCharm);
    /* A kill's bounty rides down the tree; outside BOUNTY it is zero and the
       shared pair is passed on untouched — no allocation on the hot path. */
    const worth = bountyFor(killed, mode);
    const nextBank: Bank = worth
      ? (who === 0 ? [bank[0] + worth, bank[1]] : [bank[0], bank[1] + worth])
      : bank;
    let v: number;
    if (isFull(ns[who])) {
      const opponent = (1 - perspective) as Player;
      const d = boardTotalMode(ns[perspective], mode, nextCharm?.wards[perspective])
        - boardTotalMode(ns[opponent], mode, nextCharm?.wards[opponent])
        + nextBank[perspective] - nextBank[opponent];          // game over: what totalOf pays
      v = d + (d > 0 ? 14 : d < 0 ? -14 : 0);
    } else if (depth <= 1 || NODES > BUDGET) {
      v = evalSt(ns, options, nextCharm, nextBank);
    } else {
      let sum = 0;
      for (let d = 1; d <= DICE_FACES; d++) {
        sum += search(ns, (1 - who) as Player, d, depth - 1, options, nextCharm, nextBank).v;
      }
      v = sum / DICE_FACES;
    }
    v += (random() - 0.5) * 1e-4;                         // tie-break jitter
    if (maximizing ? v > bestV : v < bestV) { bestV = v; bestC = c; }
  }
  return { v: bestV, c: bestC };
}
