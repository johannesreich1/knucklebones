// The rules of Knucklebones — pure functions over plain data. No DOM, no
// timers, no randomness: this module must run identically in the browser and
// on a server (score validation replays games through exactly this code).
import { CLASSIC, DICE_FACES, type BoardSpec } from '../config';

/* Player indices are fixed identities: 1 = cyan (P1 / the human in CPU mode),
   0 = magenta (P2 / the CPU). Which half of the screen they occupy is a UI
   concern (S.bottom) and never leaks in here. */
export const AI = 0, ME = 1;
export type Player = 0 | 1;

export type Col = number[];              // dice values, bottom of the stack first
export type Board = Col[];               // one column array per BoardSpec col
export type GameState = [Board, Board];  // indexed by Player

export const SPEC: BoardSpec = CLASSIC;

export function emptyBoard(): Board {
  const b: Board = [];
  for (let c = 0; c < SPEC.cols; c++) b.push([]);
  return b;
}

/* countOf stays a plain loop rather than an object tally: colScore runs millions
   of times inside the search, and building a map per call costs far more. */
export function countOf(col: Col, v: number): number {
  let k = 0;
  for (let i = 0; i < col.length; i++) if (col[i] === v) k++;
  return k;
}

export function legalCols(board: Board): number[] {
  const out: number[] = [];
  for (let c = 0; c < SPEC.cols; c++) if (board[c].length < SPEC.rows) out.push(c);
  return out;
}

/* value × count² per matching set: two 4s score 16, three 4s 36 */
export function colScore(col: Col): number {
  let s = 0;
  for (let v = 1; v <= DICE_FACES; v++) {
    const k = countOf(col, v);
    if (k) s += v * k * k;
  }
  return s;
}

export function boardTotal(b: Board): number {
  let s = 0;
  for (let c = 0; c < b.length; c++) s += colScore(b[c]);
  return s;
}

export function isFull(b: Board): boolean {
  let n = 0;
  for (let c = 0; c < b.length; c++) n += b[c].length;
  return n >= SPEC.cols * SPEC.rows;
}

export function counts(col: Col): Record<number, number> {
  const m: Record<number, number> = {};
  for (const v of col) m[v] = (m[v] || 0) + 1;
  return m;
}

/* hot path: called once per search node — plain loops, no closures */
export function cloneSt(st: GameState): GameState {
  const out: GameState = [[], []];
  for (let p = 0; p < 2; p++) {
    const b = st[p], nb = out[p];
    for (let c = 0; c < b.length; c++) nb.push(b[c].slice());
  }
  return out;
}

/* place a die, then destruction: every matching die in the opponent's facing
   column dies. Mutates st — callers clone first when they need to. */
export function applyMove(st: GameState, who: Player, col: number, die: number): void {
  st[who][col].push(die);
  const o = 1 - who, oc = st[o][col];
  let hit = false;
  for (let i = 0; i < oc.length; i++) if (oc[i] === die) { hit = true; break; }
  if (hit) st[o][col] = oc.filter(v => v !== die);
}
