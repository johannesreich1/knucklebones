// PvP match state, rebuilt from the authoritative move log. Pure: the
// pvp-move Edge Function (Deno) and the client (browser) both derive board
// state from the same log + seed through exactly this code.
//
// Match conventions (enforced server-side, honoured by clients):
//   p1 = core index 1 (ME) and ALWAYS makes the first move; vs a bot the
//   human is always p1. Each move consumes exactly one roll from the seed's
//   dice stream. The game ends the instant a mover fills their board.
import { type GameState, type Player, ME, emptyBoard, legalCols, isFull, applyMove } from './rules.ts';
import { diceStream } from './dice.ts';

export interface MoveRow { idx: number; who: number; col: number; }
export interface MatchState {
  st: GameState;
  turn: Player;       // whose move comes next (meaningless when over)
  over: boolean;
  nextDie: number;    // the die the next mover must place (meaningless when over)
  moveCount: number;
}

/* The log is server-written and therefore trusted; null here means the log is
   corrupt, which is a bug worth failing loudly over — never repair silently. */
export function rebuild(seed: string, rows: MoveRow[]): MatchState | null {
  const moves = [...rows].sort((a, b) => a.idx - b.idx);
  const st: GameState = [emptyBoard(), emptyBoard()];
  const roll = diceStream(seed);
  let turn: Player = ME;
  let over = false;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.idx !== i || m.who !== turn || over) return null;
    const die = roll();
    if (!legalCols(st[turn]).includes(m.col)) return null;
    applyMove(st, turn, m.col, die);
    over = isFull(st[turn]);
    turn = (1 - turn) as Player;
  }
  return { st, turn, over, nextDie: roll(), moveCount: moves.length };
}
