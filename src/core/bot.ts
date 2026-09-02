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
  ME, applyMove, boardTotalMode, bountyFor, cloneCharm, cloneSt, legalCols,
  type CharmSt, type GameState, type Mode, type Player,
} from './rules.ts';
import { searchRoot, type Bank } from './ai.ts';
import {
  FREE_UPGRADE_THRESHOLD, botShapeAt, type BotShape, type BotStanding, type LadderCurveVersion,
} from './ladder.ts';

/** The same league shape has a separately calibrated slip rate when it opens. */
export function botSlip(shape: BotShape, botIdx: Player): number {
  return botIdx === ME ? shape.openerSlip : shape.slip;
}

/** Everything a decision needs beyond the boards and the die: the exact charm
    at the root (a coordinated cast preview projects one) and, under BOUNTY,
    the points each player has already banked. */
export interface BotMoveContext {
  rootCharm?: CharmSt;
  bounty?: Bank;
}

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
    const killed = applyMove(scratch, botIdx, col, die, mode, scratchCharm);
    return {
      col,
      own: boardTotalMode(scratch[botIdx], mode, scratchCharm?.wards[botIdx]) - ownBefore
        + bountyFor(killed, mode),
      oppLoss: oppBefore - boardTotalMode(scratch[opponent], mode, scratchCharm?.wards[opponent]),
    };
  });
}

/* Whether playing `col` declines a free upgrade: some other column costs the
   opponent exactly as much and pays the bot at least `threshold` more. The
   threshold is the shape's attention (BotShape.freeUpgrade); the measured
   knee is the default. */
export function declinesFreeUpgrade(scored: readonly ColumnScore[], col: number,
                                    threshold = FREE_UPGRADE_THRESHOLD): boolean {
  const mine = scored.find((score) => score.col === col);
  return mine !== undefined && scored.some((other) => other.col !== col
    && other.oppLoss === mine.oppLoss && other.own >= mine.own + threshold);
}

/* The column this bot plays, and nothing else — no board mutation, no logging.
   `bot` is the BOT's own standing: its points (a bot plays the shape of the
   group its own points sit in, docs/LADDER.md §4) and whether the board ranks
   it in the apex — never anything derived from its opponent.

   Search configuration is per call. The same injected random stream drives
   slips and tie-break jitter, so a caller can replay the whole decision. */
export function botMove(st: GameState, botIdx: Player, die: number, bot: BotStanding,
                        mode: Mode, curveVersion: LadderCurveVersion,
                        rand: () => number, context: BotMoveContext = {}): number {
  return botMoveWithShape(st, botIdx, die, botShapeAt(bot, curveVersion), mode, rand, context);
}

/* Where a slip may land. Two terms, one filter, and it draws nothing.

   What a column costs YOU: a negative opponent weight is an onboarding
   promise, not merely a search hint — STONE actively spares the player's
   board, and its old any-column slip could string together the strongest
   possible counters (including a live first-match double-six wipe). ME is
   also the opening seat: a bot may occupy it, but the league curve must not
   flip to bot-favoured just because the bot received that handicap, so a bot
   opener's slipped moves are safe builds too. In either case the pool is the
   columns that cost the opponent the least visible score.

   What a column costs the BOT: a slip may never decline a free upgrade —
   another column with the identical effect on the opponent that pays at
   least the shape's freeUpgrade threshold more is a move no rule-knowing
   player makes, so it leaves the pool (docs/LADDER.md §4). Everything else
   a slip could do it still can: build badly, walk into a destroy, miss a
   kill, spare you. The pool cannot empty: the best-own column of every
   opponent-loss class is never a free upgrade declined, and a sparing pool
   shares one class. STONE alone keeps the any-column slip (Infinity): its
   onboarding promise is unconditional, and measured with the rule its slips
   build well enough that a random opener loses to it. */
export function slipCandidates(st: GameState, botIdx: Player, die: number, shape: BotShape,
                               mode: Mode, rootCharm?: CharmSt): number[] {
  const scored = scoreColumns(st, botIdx, die, mode, rootCharm);
  let pool = scored;
  if (shape.oppW < 0 || botIdx === ME) {
    let leastLoss = Infinity;
    for (const score of scored) leastLoss = Math.min(leastLoss, score.oppLoss);
    pool = scored.filter((score) => score.oppLoss === leastLoss);
  }
  return pool.filter((score) => !declinesFreeUpgrade(scored, score.col, shape.freeUpgrade))
    .map((score) => score.col);
}

/* The slip, when it fires: draw one rolls it, draw two picks among the
   candidates. Null means the shape searches this turn. The statement order
   is deliberately the inline original's, down to the short-circuit: `slip > 0
   &&` means a zero-slip bot draws NOTHING, so the stream advances differently
   for zero- and non-zero-slip shapes. Rewrite this as a tidier expression and
   you change which numbers later draws get — a replay difference, not a
   style difference. */
export function botSlipPick(st: GameState, botIdx: Player, die: number, shape: BotShape,
                            mode: Mode, rand: () => number, context: BotMoveContext = {}): number | null {
  const slip = botSlip(shape, botIdx);
  if (!(slip > 0 && rand() < slip)) return null;
  const choices = slipCandidates(st, botIdx, die, shape, mode, context.rootCharm);
  return choices[Math.floor(rand() * choices.length)];
}

/** The shape's search, exactly as the un-slipped branch has always run it. */
export function botSearch(st: GameState, botIdx: Player, die: number, shape: BotShape,
                          mode: Mode, rand: () => number, context: BotMoveContext = {}): number {
  return searchRoot(st, botIdx, die, shape.depth, {
    mode,
    random: rand,
    riskWeight: shape.risk,
    opponentWeight: shape.oppW,
    rootCharm: context.rootCharm,
    bounty: context.bounty,
  }).c;
}

/* The same decision for a shape named directly. The bench measures a league
   by its shape, and a retune sweep tries shapes the registry does not hold
   yet; both must run the exact statements production runs. The ranked turn
   builder applies the two halves itself — the cast decided on the un-slipped
   search, the one slip on the placement — and must decide exactly as this
   composition would (tests/support/bot-move-contract.ts pins it). */
export function botMoveWithShape(st: GameState, botIdx: Player, die: number, shape: BotShape,
                                 mode: Mode, rand: () => number, context: BotMoveContext = {}): number {
  if (!legalCols(st[botIdx]).length) return -1;   // nothing to play: the caller is asking too late
  return botSlipPick(st, botIdx, die, shape, mode, rand, context)
    ?? botSearch(st, botIdx, die, shape, mode, rand, context);
}
