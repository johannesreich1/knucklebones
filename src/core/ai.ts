// Expectimax search with a risk term — pure, DOM-free, tuned by self-play.
// PERFORMANCE: this is the game's hot path. colScore/countOf run millions of
// times per move; Hard decides whether to search a 5th ply by timing the 4th
// against an 18ms budget, so slowing anything here quietly weakens the CPU on
// mid-range phones. Benchmark with tests/bench3.mjs before changing (and skip
// the first JIT-cold run when reading its numbers).
import { DICE_FACES } from '../config';
import {
  AI, ME, SPEC, type GameState, type Player,
  cloneSt, applyMove, legalCols, boardTotal, countOf, isFull,
} from './rules';

let NODES = 0;
const BUDGET = 500000;                  // node cap: search degrades, never hangs
let RISK_W = 1.5;                       // tuned by self-play: 55.3% vs risk-blind over 500 games

export const nodes = () => NODES;
export const getRiskW = () => RISK_W;
export const setRiskW = (w: number) => { RISK_W = w; };

/* expected value a player stands to lose to one enemy placement in a facing column */
export function riskOf(st: GameState, p: Player): number {
  const o = 1 - p, mine = st[p], theirs = st[o];
  let r = 0;
  for (let c = 0; c < SPEC.cols; c++) {
    if (theirs[c].length >= SPEC.rows) continue;   // they can't play into this column any more
    const col = mine[c];
    for (let v = 1; v <= DICE_FACES; v++) {
      const k = countOf(col, v);
      if (k) r += (v * k * k) / DICE_FACES;        // 1-in-DICE_FACES chance they roll exactly this value
    }
  }
  return r;
}

function evalSt(st: GameState): number {
  let s = boardTotal(st[AI]) - boardTotal(st[ME]);
  if (RISK_W) s += RISK_W * (riskOf(st, ME) - riskOf(st, AI));
  return s;
}

export interface SearchResult { v: number; c: number; }

export function searchRoot(st: GameState, who: Player, die: number, depth: number): SearchResult {
  NODES = 0;
  return search(st, who, die, depth);
}

export function search(st: GameState, who: Player, die: number, depth: number): SearchResult {
  NODES++;
  const legal = legalCols(st[who]);
  let bestV = who === AI ? -1e9 : 1e9, bestC = legal[0];
  for (const c of legal) {
    const ns = cloneSt(st);
    applyMove(ns, who, c, die);
    let v: number;
    if (isFull(ns[who])) {
      const d = boardTotal(ns[AI]) - boardTotal(ns[ME]);   // game over: material only
      v = d + (d > 0 ? 14 : d < 0 ? -14 : 0);
    } else if (depth <= 1 || NODES > BUDGET) {
      v = evalSt(ns);
    } else {
      let sum = 0;
      for (let d = 1; d <= DICE_FACES; d++) sum += search(ns, (1 - who) as Player, d, depth - 1).v;
      v = sum / DICE_FACES;
    }
    v += (Math.random() - 0.5) * 1e-4;                     // tie-break jitter
    if (who === AI ? v > bestV : v < bestV) { bestV = v; bestC = c; }
  }
  return { v: bestV, c: bestC };
}
