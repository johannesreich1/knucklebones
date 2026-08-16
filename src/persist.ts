// Persistence: stats/preferences and the in-progress game save.
// Storage is unavailable in some embeds (sandboxed iframes, private modes).
// Every access is guarded: the game simply forgets between sessions there.
import { DICE_FACES } from './config';
import { SPEC, isFull, type Board, type Player } from './core/rules';
import { S, DIFFS, MODES, TIMERS, SEATS, oneOf, type Mode, type Diff, type Seat } from './state';

const Store = {
  KEY: 'knucklebones.v1',
  read(): Record<string, unknown> {
    try { return JSON.parse(localStorage.getItem(Store.KEY)!) || {}; } catch { return {}; }
  },
  write(o: object): void {
    try { localStorage.setItem(Store.KEY, JSON.stringify(o)); } catch { /* forgetful host */ }
  }
};

export function saveStats(): void {
  Store.write({ wins: S.wins, losses: S.losses, draws: S.draws,
                p1: S.p1, p2: S.p2, ties: S.ties,
                best: S.best, diff: S.diff, mode: S.mode, sound: S.sound,
                numerals: S.numerals, timer: S.timer, seat: S.seat, tutDone: S.tutDone });
}

export function loadStats(): void {
  const d = Store.read() as Record<string, any>;
  S.wins = d.wins | 0; S.losses = d.losses | 0; S.draws = d.draws | 0;
  S.p1 = d.p1 | 0; S.p2 = d.p2 | 0; S.ties = d.ties | 0; S.best = d.best | 0;
  S.diff = oneOf(DIFFS, d.diff, S.diff);
  S.mode = oneOf(MODES, d.mode, S.mode);
  S.timer = oneOf(TIMERS, d.timer, S.timer);
  S.seat = oneOf(SEATS, d.seat, S.seat);
  if (typeof d.sound === 'boolean') S.sound = d.sound;
  if (typeof d.numerals === 'boolean') S.numerals = d.numerals;
  if (typeof d.tutDone === 'boolean') S.tutDone = d.tutDone;
}

/* ---- in-progress game, so closing the app doesn't lose it ----
   The rolled die is saved too: quitting after seeing a bad roll gives you the
   same one back rather than a free reroll. */
const GKEY = 'knucklebones.game.v1';

export interface GameSave {
  boards: [Board, Board];
  turn: Player;
  die: number;
  mode: Mode;
  diff: Diff;
  bottom: Player;
  starter?: Player;
  seat?: Seat;
}

export function saveGame(): void {
  if (S.tut) return;                 // tutorials are throwaway; leave any real save alone
  if (S.phase === 'over' || S.phase === 'menu') { clearGame(); return; }
  const placed = S.boards[0].flat().length + S.boards[1].flat().length;
  if (!placed) { clearGame(); return; }   // nothing on the board = nothing to resume
  try {
    localStorage.setItem(GKEY, JSON.stringify({
      boards: S.boards, turn: S.turn, die: S.die, mode: S.mode, diff: S.diff,
      bottom: S.bottom, starter: S.starter, seat: S.seat
    }));
  } catch { /* forgetful host */ }
}

export function clearGame(): void {
  try { localStorage.removeItem(GKEY); } catch { /* forgetful host */ }
}

export function loadGame(): GameSave | null {
  let g: any;
  try { g = JSON.parse(localStorage.getItem(GKEY)!); } catch { return null; }
  if (!g) return null;
  // validate hard: a corrupt or hand-edited blob must not boot the game
  const okBoard = (b: unknown): b is Board => Array.isArray(b) && b.length === SPEC.cols && b.every(c =>
    Array.isArray(c) && c.length <= SPEC.rows && c.every(v => Number.isInteger(v) && v >= 1 && v <= DICE_FACES));
  if (!Array.isArray(g.boards) || g.boards.length !== 2 || !g.boards.every(okBoard)) return null;
  if (g.turn !== 0 && g.turn !== 1) return null;
  if (g.bottom !== 0 && g.bottom !== 1) return null;
  if (g.mode !== 'cpu' && g.mode !== 'duo') return null;
  if (isFull(g.boards[0]) || isFull(g.boards[1])) return null;   // that game was over
  const placed = g.boards[0].flat().length + g.boards[1].flat().length;
  if (placed === 0) return null;                                 // nothing worth resuming
  if (!(Number.isInteger(g.die) && g.die >= 0 && g.die <= DICE_FACES)) g.die = 0;
  return g as GameSave;
}
