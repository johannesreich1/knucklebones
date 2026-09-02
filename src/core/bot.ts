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
import {
  botShapeAt, type BotShape, type BotStanding, type LadderCurveVersion,
} from './ladder.ts';

/** The same league shape has a separately calibrated slip rate when it opens. */
export function botSlip(shape: BotShape, botIdx: Player): number {
  return botIdx === ME ? shape.openerSlip : shape.slip;
}

/* A free upgrade declined: another legal column with the IDENTICAL effect on
   the opponent's board and at least this many more points on the bot's own.
   The photographed move was exactly this gap (a third 4 stacked for 18 under
   ROWS when either side column paid 26 with the human's board untouched
   either way); the threshold has a measured knee — 12 misses that move, 4
   spends four more share points removing errors nobody would notice. */
export const FREE_UPGRADE_THRESHOLD = 8;

/** What one legal column is worth at depth 0 under the mode's own totals. */
export interface ColumnScore {
  col: number;
  /** Points added to the bot's own board. */
  own: number;
  /** Points taken from the opponent's board. */
  oppLoss: number;
}

/* Depth-0 worth of every legal column. Draws nothing. The slip's candidate
   filters, the bench's unforced-error counter and the retune sweep all read
   this one scorer, so no two of them can disagree about what a column is
   worth. */
export function scoreColumns(st: GameState, botIdx: Player, die: number, mode: Mode,
                             rootCharm?: CharmSt): ColumnScore[] {
  const opponent = (1 - botIdx) as Player;
  const ownBefore = boardTotalMode(st[botIdx], mode, rootCharm?.wards[botIdx]);
  const oppBefore = boardTotalMode(st[opponent], mode, rootCharm?.wards[opponent]);
  return legalCols(st[botIdx]).map((col) => {
    const scratch = cloneSt(st);
    const scratchCharm = rootCharm && cloneCharm(rootCharm);
    applyMove(scratch, botIdx, col, die, mode, scratchCharm);
    return {
      col,
      own: boardTotalMode(scratch[botIdx], mode, scratchCharm?.wards[botIdx]) - ownBefore,
      oppLoss: oppBefore - boardTotalMode(scratch[opponent], mode, scratchCharm?.wards[opponent]),
    };
  });
}

/* Whether playing `col` declines a free upgrade: some other column costs the
   opponent exactly as much and pays the bot at least the threshold more. */
export function declinesFreeUpgrade(scored: readonly ColumnScore[], col: number): boolean {
  const mine = scored.find((score) => score.col === col);
  return mine !== undefined && scored.some((other) => other.col !== col
    && other.oppLoss === mine.oppLoss && other.own >= mine.own + FREE_UPGRADE_THRESHOLD);
}

/* The column this bot plays, and nothing else — no board mutation, no logging.
   `bot` is the BOT's own standing: its points (a bot plays the shape of the
   group its own points sit in, docs/LADDER.md §4) and whether the board ranks
   it in the apex — never anything derived from its opponent.

   Search configuration is per call. The same injected random stream drives
   slips and tie-break jitter, so a caller can replay the whole decision. */
export function botMove(st: GameState, botIdx: Player, die: number, bot: BotStanding,
                        mode: Mode, curveVersion: LadderCurveVersion,
                        rand: () => number, rootCharm?: CharmSt): number {
  return botMoveWithShape(st, botIdx, die, botShapeAt(bot, curveVersion), mode, rand, rootCharm);
}

/* The same decision for a shape named directly. The bench measures a league
   by its shape, and a retune sweep tries shapes the registry does not hold
   yet; both must run the exact statements production runs. */
export function botMoveWithShape(st: GameState, botIdx: Player, die: number, shape: BotShape,
                                 mode: Mode, rand: () => number, rootCharm?: CharmSt): number {
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
      const scored = scoreColumns(st, botIdx, die, mode, rootCharm);
      let leastLoss = Infinity;
      for (const score of scored) leastLoss = Math.min(leastLoss, score.oppLoss);
      choices = scored.filter((score) => score.oppLoss === leastLoss).map((score) => score.col);
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
