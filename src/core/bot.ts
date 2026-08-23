// WHAT A BOT PLAYS — one implementation, asked by every caller that needs it.
//
// This used to live inline inside pvp-move, which was fine while pvp-move was
// the only place a bot ever moved. It stopped being fine the moment a bot could
// be seated FIRST: pvp-join must then play the bot's opening move at match
// creation, and a second copy of "how does a bot choose a column" is exactly
// the duplication this repo has already paid for once (docs/STATUS.md, the two
// in-game drivers). One home, two callers.
//
// Pure, like the rest of core/: the randomness a slip needs is handed IN, never
// reached for, so a caller can seed it and replay the same choice. Callers in
// production pass Math.random; the gate passes a seeded stream to prove the
// extraction changed nothing.
import { legalCols, type GameState, type Mode, type Player } from './rules.ts';
import { searchRoot } from './ai.ts';
import { botShapeAt } from './ladder.ts';

/* The column this bot plays, and nothing else — no board mutation, no logging.
   `rating` is the BOT's own points: a bot plays the shape of the group its own
   rating sits in (docs/LADDER.md §4), never a shape derived from its opponent.

   Search configuration is per call. The same injected random stream drives
   slips and tie-break jitter, so a caller can replay the whole decision. */
export function botMove(st: GameState, botIdx: Player, die: number, rating: number,
                        mode: Mode, rand: () => number): number {
  const shape = botShapeAt(rating);
  const legal = legalCols(st[botIdx]);
  if (!legal.length) return -1;                 // nothing to play: the caller is asking too late

  /* The statement order below is deliberately the inline original's, down to
     the short-circuit: `shape.slip > 0 &&` means a zero-slip bot draws NOTHING,
     so the stream advances differently for a STONE bot and a GOLD one. Rewrite
     this as a tidier expression and you change which numbers later draws get —
     which is a replay difference, not a style difference. */
  let col: number;
  if (shape.slip > 0 && rand() < shape.slip) col = legal[Math.floor(rand() * legal.length)];
  else col = searchRoot(st, botIdx, die, shape.depth, {
    mode,
    random: rand,
    riskWeight: shape.risk,
    opponentWeight: shape.oppW,
  }).c;
  return col;
}
