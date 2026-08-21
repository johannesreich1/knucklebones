// The rules of Knucklebones — pure functions over plain data. No DOM, no
// timers, no randomness: this module must run identically in the browser and
// on a server (score validation replays games through exactly this code).
import { CLASSIC as CLASSIC_BOARD, DICE_FACES, type BoardSpec } from '../config.ts';

/* Player indices are fixed identities: 1 = cyan (P1 / the human in CPU mode),
   0 = magenta (P2 / the CPU). Which half of the screen they occupy is a UI
   concern (S.bottom) and never leaks in here. */
export const AI = 0, ME = 1;
export type Player = 0 | 1;

export type Col = number[];              // dice values, bottom of the stack first
export type Board = Col[];               // one column array per BoardSpec col
export type GameState = [Board, Board];  // indexed by Player

export const SPEC: BoardSpec = CLASSIC_BOARD;

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

/* ---- game-mode additions (the ranked wheel) ----
   Mode 0 is classic and must stay BIT-IDENTICAL to the pre-mode game: every
   mode branch below is written so the mode===CLASSIC path does exactly what
   the code did before modes existed. The wheel registry lives in modes.ts;
   the numeric vocabulary lives here because rules and AI branch on it. */
export const CLASSIC = 0, ROWSWITCH = 1, ROWMULT = 2, COLSHIELD = 3, SINGLESTRIKE = 4, BOUNTY = 5, LIMITED = 6;
export type Mode = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/* LIMITED changes only the SUPPLY (a finite bag, see dice.ts poolSequence) and
   the end condition (bag empty) — scoring and destruction stay pure classic,
   which every default branch below already delivers. */

/* value × count² across a horizontal row (same formula, orientation flipped) */
export function rowScore(b: Board, r: number): number {
  let s = 0;
  for (let v = 1; v <= DICE_FACES; v++) {
    let k = 0;
    for (let c = 0; c < b.length; c++) if (b[c][r] === v) k++;
    if (k) s += v * k * k;
  }
  return s;
}

/* ROWMULT: only MATCHES (2+) add — singles already counted by the columns */
export function rowBonus(b: Board): number {
  let s = 0;
  for (let r = 0; r < SPEC.rows; r++) {
    for (let v = 1; v <= DICE_FACES; v++) {
      let k = 0;
      for (let c = 0; c < b.length; c++) if (b[c][r] === v) k++;
      if (k >= 2) s += v * k * k;
    }
  }
  return s;
}

export function boardTotalMode(b: Board, mode: Mode): number {
  if (mode === ROWSWITCH) {
    let s = 0;
    for (let r = 0; r < SPEC.rows; r++) s += rowScore(b, r);
    return s;
  }
  if (mode === ROWMULT) return boardTotal(b) + rowBonus(b);
  return boardTotal(b);
}

/* a full column under COLUMN SHIELD cannot be touched. ONE definition — the
   rules, the board's shield chip and both play flows all ask this same
   question, and they must never disagree. (The AI's risk model asked it too
   once, and LOST games by believing the answer — see core/ai.ts riskOf.) */
export function isShielded(col: Col, mode: Mode): boolean {
  return mode === COLSHIELD && col.length >= SPEC.rows;
}

/* WHICH enemy dice a strike takes, as indices into their column (bottom-first,
   so index 0 is closest to the centre line). The single source of truth for
   destruction: core replay, the AI and the animated flows all read it, so what
   you SEE fall can never differ from what actually falls. */
export function victimsOf(oc: Col, die: number, mode: Mode = CLASSIC): number[] {
  if (isShielded(oc, mode)) return [];                  // shielded: full columns are safe
  if (mode === SINGLESTRIKE) {
    const i = oc.indexOf(die);                          // first match = closest to the centre
    return i < 0 ? [] : [i];
  }
  const hits: number[] = [];
  for (let i = 0; i < oc.length; i++) if (oc[i] === die) hits.push(i);
  return hits;
}

/* the score a player is holding: their board under the active mode, plus any
   permanently banked bounty. Server finishes, client displays and the local
   end screen all settle here. */
export function totalOf(b: Board, banked: number, mode: Mode): number {
  return boardTotalMode(b, mode) + (mode === BOUNTY ? banked : 0);
}

/* the game is over when a mover fills their board — or, under LIMITED, when
   the finite bag runs dry (pass bagLeft = null when the supply is endless) */
export function isOver(b: Board, bagLeft: number | null): boolean {
  return isFull(b) || bagLeft === 0;
}

/* place a die, then destruction: every matching die in the opponent's facing
   column dies — unless COLSHIELD protects their full column, or SINGLESTRIKE
   limits the damage to ONE die. Mutates st — callers clone first when they
   need to. Returns how many enemy dice were destroyed (BOUNTY banks a
   permanent +1 per destroyed die; everyone else may ignore it). */
export function applyMove(st: GameState, who: Player, col: number, die: number, mode: Mode = CLASSIC): number {
  st[who][col].push(die);
  const o = 1 - who, oc = st[o][col];
  const victims = victimsOf(oc, die, mode);
  if (!victims.length) return 0;
  const doomed = new Set(victims);
  st[o][col] = oc.filter((_, i) => !doomed.has(i));
  return victims.length;
}
