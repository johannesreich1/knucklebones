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
import {
  ME, applyMove, boardTotalMode, cloneCharm, cloneSt, legalCols,
  type CharmSt, type GameState, type Mode, type Player,
} from './rules.ts';
import { searchRoot } from './ai.ts';
import { botShapeAt, type BotShape } from './ladder.ts';

/** The same league shape has a separately calibrated slip rate when it opens. */
export function botSlip(shape: BotShape, botIdx: Player): number {
  return botIdx === ME ? shape.openerSlip : shape.slip;
}

/* The column this bot plays, and nothing else — no board mutation, no logging.
   `rating` is the BOT's own points: a bot plays the shape of the group its own
   rating sits in (docs/LADDER.md §4), never a shape derived from its opponent.

   Search configuration is per call. The same injected random stream drives
   slips and tie-break jitter, so a caller can replay the whole decision. */
export function botMove(st: GameState, botIdx: Player, die: number, rating: number,
                        mode: Mode, rand: () => number, rootCharm?: CharmSt): number {
  const shape = botShapeAt(rating);
  const slip = botSlip(shape, botIdx);
  const legal = legalCols(st[botIdx]);
  if (!legal.length) return -1;                 // nothing to play: the caller is asking too late

  /* The statement order below is deliberately the inline original's, down to
     the short-circuit: `slip > 0 &&` means a zero-slip bot draws NOTHING,
     so the stream advances differently for zero- and non-zero-slip shapes. Rewrite
     this as a tidier expression and you change which numbers later draws get —
     which is a replay difference, not a style difference. */
  let col: number;
  if (slip > 0 && rand() < slip) {
    let choices = legal;
    /* A negative opponent weight is an onboarding promise, not merely a
       search hint: STONE actively spares the player's board. Its old random
       slip ignored that promise and could accidentally string together the
       strongest possible counters (including a live first-match double-six
       wipe).

       ME is also the opening seat. A bot may legitimately occupy it, but the
       league curve must not flip from human-favoured to bot-
       favoured just because the bot received that handicap. Its slipped moves
       therefore become safe random builds too. A promoted bot seated second
       retains the ordinary any-column slip. In either case, choose among the
       columns that cost the opponent the least visible score. */
    if (shape.oppW < 0 || botIdx === ME) {
      const opponent = (1 - botIdx) as Player;
      const before = boardTotalMode(st[opponent], mode, rootCharm?.wards[opponent]);
      let leastLoss = Infinity;
      const losses = legal.map((candidate) => {
        const scratch = cloneSt(st);
        const scratchCharm = rootCharm && cloneCharm(rootCharm);
        applyMove(scratch, botIdx, candidate, die, mode, scratchCharm);
        const after = boardTotalMode(
          scratch[opponent], mode, scratchCharm?.wards[opponent],
        );
        const loss = before - after;
        leastLoss = Math.min(leastLoss, loss);
        return loss;
      });
      choices = legal.filter((_, index) => losses[index] === leastLoss);
    }
    col = choices[Math.floor(rand() * choices.length)];
  } else {
    col = searchRoot(st, botIdx, die, shape.depth, {
      mode,
      random: rand,
      riskWeight: shape.risk,
      opponentWeight: shape.oppW,
      rootCharm,
    }).c;
  }
  return col;
}
