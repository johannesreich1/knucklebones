// PvP match state, rebuilt from the authoritative move log. Pure: the
// pvp-move Edge Function (Deno) and the client (browser) both derive board
// state from the same log + seed through exactly this code.
//
// Match conventions (enforced server-side, honoured by clients):
//   p1 = core index 1 (ME) and ALWAYS makes the first move. Ranked seating
//   gives p1 to the lower-rated participant, including a bot; the ranked bot
//   tiebreak also leaves an equal-rated bot in p1. Each move consumes exactly
//   one roll from the seed's dice stream. The game ends the instant a mover
//   fills their board.
import { type GameState, type Player, type Mode, CLASSIC, BOUNTY, LIMITED, ME, emptyBoard, legalCols, isOver, applyMove, totalOf } from './rules.ts';
import { diceStream, poolSequence } from './dice.ts';

export interface MoveRow { idx: number; who: number; col: number; }
export interface MatchState {
  st: GameState;
  turn: Player;       // whose move comes next (meaningless when over)
  over: boolean;
  nextDie: number;    // the die the next mover must place (meaningless when over)
  moveCount: number;
  bounty: [number, number];   // BOUNTY mode: permanent +1 per destroyed die, by Player
}

/* The log is server-written and therefore trusted; null here means the log is
   corrupt, which is a bug worth failing loudly over — never repair silently. */
export function rebuild(seed: string, rows: MoveRow[], mode: Mode = CLASSIC): MatchState | null {
  const moves = [...rows].sort((a, b) => a.idx - b.idx);
  const st: GameState = [emptyBoard(), emptyBoard()];
  // LIMITED draws from the finite bag in shuffled order; everyone else rolls
  // the endless stream. Call counts are identical, so classic stays bit-exact.
  const bag = mode === LIMITED ? poolSequence(seed) : null;
  const stream = bag ? null : diceStream(seed);
  const roll = (i: number): number => bag ? (bag[i] ?? 0) : stream!();
  const bounty: [number, number] = [0, 0];
  let turn: Player = ME;
  let over = false;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.idx !== i || m.who !== turn || over) return null;
    const die = roll(i);
    if (!die) return null;                       // a move past the empty bag: corrupt
    if (!legalCols(st[turn]).includes(m.col)) return null;
    const destroyed = applyMove(st, turn, m.col, die, mode);
    if (mode === BOUNTY) bounty[turn] += destroyed;
    // LIMITED: placing the LAST die from the bag ends the game, full or not
    over = isOver(st[turn], bag ? bag.length - (i + 1) : null);
    turn = (1 - turn) as Player;
  }
  return { st, turn, over, nextDie: roll(moves.length), moveCount: moves.length, bounty };
}

/* the one true final score for a MATCH — the shared totalOf() applied to this
   match's board and bank. Server finishes and client displays both land here. */
export function matchTotal(s: MatchState, who: Player, mode: Mode): number {
  return totalOf(s.st[who], s.bounty[who], mode);
}
