// The game's single mutable state object plus the vocabulary of legal values.
// Everything that renders, saves or decides reads from here; identity vs
// screen-half is the invariant to keep straight (see S.bottom).
import { AI, ME, emptyBoard, type Board, type Player } from './core/rules.ts';

export const DIFFS = ['easy', 'medium', 'hard'] as const;
export const MODES = ['cpu', 'duo'] as const;
export const TIMERS = [0, 10, 20] as const;
export const SEATS = ['pass', 'face'] as const;
export const DIFF_LABEL: Record<string, string> = { easy: 'EASY', medium: 'NORMAL', hard: 'HARD' };

export type Diff = typeof DIFFS[number];
export type Mode = typeof MODES[number];
export type Seat = typeof SEATS[number];
export type Phase = 'menu' | 'roll' | 'choose' | 'pass' | 'anim' | 'over';

export interface TutState {
  turnNo: number;
  prolls: number[];   // scripted player rolls
  crolls: number[];   // scripted CPU rolls
  cmoves: number[];   // scripted CPU column choices
  firstCol: number | null;
  restrict: number | null;
}

/* accept a stored value only if it is one we recognise, else keep the current one */
export function oneOf<T>(list: readonly T[], val: unknown, fallback: T): T {
  return list.indexOf(val as T) >= 0 ? (val as T) : fallback;
}

/* Player indices are fixed identities: 1 = cyan (you / Player 1), 0 = magenta
   (CPU / Player 2). Which HALF OF THE SCREEN each one occupies is S.bottom,
   which swaps on hand-off so the active player is always nearest their thumbs. */
export const S = {
  boards: [emptyBoard(), emptyBoard()] as [Board, Board],
  turn: ME as Player,
  die: 0,
  phase: 'menu' as Phase,
  mode: 'cpu' as Mode,
  bottom: ME as Player,  // which player is rendered in the lower half
  diff: 'hard' as Diff,
  wins: 0, losses: 0, draws: 0,
  p1: 0, p2: 0, ties: 0, // duo-mode session record
  best: 0,               // highest single-game score, persisted
  numerals: false,       // show numbers on dice instead of pips
  timer: 10,             // two-player turn clock in seconds; 0 = off
  seat: 'pass' as Seat,  // duo seating: pass the phone, or sit facing each other
  tut: null as TutState | null, // tutorial script state while the guided game runs
  tutDone: false,        // persisted: has the tutorial ever been finished
  starter: ME as Player,
  sound: true,
  busy: false,
  gen: 0                 // bumped whenever a game is abandoned/restarted; async work checks it
};

// re-export the identities for modules that get S anyway
export { AI, ME };
