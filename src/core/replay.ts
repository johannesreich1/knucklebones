// Ranked-game replay validation — the anti-cheat core. Pure: runs identically
// in the browser, in Node (tests/replay.test.ts) and in the ranked-submit
// Edge Function (Deno), which is the whole point: ONE rules implementation,
// and a submitted score is never trusted, only recomputed.
import { AI, ME, type GameState, type Player, emptyBoard, legalCols, boardTotal, isFull, applyMove } from './rules.ts';
import { diceStream } from './dice.ts';

export type Move = [Player, number];   // [who, column]
export interface ReplayResult { score: number; opponent_score: number; won: boolean; }

/* Well beyond any real game (destruction can prolong games, but boards trend
   full); purely a denial-of-service bound on submitted payloads. */
const MAX_MOVES = 200;

/* Contract for ranked games, enforced here and honoured by the client:
   - the human (ME) always makes the first move
   - turns strictly alternate
   - each move consumes exactly one roll from the seed's dice stream
   - the game ends exactly when a mover fills their board — no play past it
   Returns null for ANY deviation: an invalid game stores nothing. */
export function replayGame(seed: string, moves: unknown): ReplayResult | null {
  if (!Array.isArray(moves) || moves.length === 0 || moves.length > MAX_MOVES) return null;
  const st: GameState = [emptyBoard(), emptyBoard()];
  const roll = diceStream(seed);
  let turn: Player = ME;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!Array.isArray(m) || m.length !== 2) return null;
    const [who, col] = m as [unknown, unknown];
    if (who !== turn || !Number.isInteger(col)) return null;
    const die = roll();
    if (!legalCols(st[turn]).includes(col as number)) return null;
    applyMove(st, turn, col as number, die);
    if (isFull(st[turn]) && i !== moves.length - 1) return null;  // play past the end
    turn = (1 - turn) as Player;
  }
  if (!isFull(st[AI]) && !isFull(st[ME])) return null;            // unfinished game
  const score = boardTotal(st[ME]), opponent_score = boardTotal(st[AI]);
  return { score, opponent_score, won: score > opponent_score };
}
