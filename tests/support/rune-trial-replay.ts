// One Rune Trial game, played through the authoritative action log by two
// ranked bots of the SAME league shape. The only thing a seat may differ in is
// whether it casts, which is what makes a cast-vs-hold duel a measurement of
// the cast and nothing else: same dice (the seed owns them), same placement
// policy, same board.
//
// Both seats run production code. A casting seat is exactly the shipped
// appendRankedBotTurn; a holding seat appends the same mandatory placement
// that turn would make — its own slip roll, or its search with the live WARD
// marks in sight — and simply never opens the cast window.
import { botSearch, botSlipPick } from '../../src/core/bot.ts';
import { botShapeAt, type BotStanding, type LadderCurveVersion } from '../../src/core/ladder.ts';
import {
  appendRankedAction,
  rankedActionTotal,
  rebuildRankedActions,
  type RankedActionRow,
  type RankedActionState,
  type RankedRuneDeal,
} from '../../src/core/ranked-actions.ts';
import { appendRankedBotTurn } from '../../src/core/ranked-bot-turn.ts';
import { AI, ME, legalCols, type Mode, type Player } from '../../src/core/rules.ts';
import { placementCharm } from '../../src/core/spells.ts';

export interface RuneSeat {
  /** The standing whose league shape this seat plays. */
  bot: BotStanding;
  /** False for the holder: it is dealt the rune and never spends it. */
  casts: boolean;
}

function appendHoldingTurn(seed: string, rows: RankedActionRow[], state: RankedActionState,
                           mode: Mode, dealt: RankedRuneDeal, seat: RuneSeat,
                           curveVersion: LadderCurveVersion,
                           random: () => number): RankedActionState | null {
  const who = state.turn;
  if (state.nextDie === null) return null;
  const shape = botShapeAt(seat.bot, curveVersion);
  const context = { bounty: state.bounty, rootCharm: placementCharm(state.charm) };
  const placedCol = botSlipPick(state.st, who, state.nextDie, shape, mode, random, context)
    ?? botSearch(state.st, who, state.nextDie, shape, mode, random, context);
  if (!legalCols(state.st[who]).includes(placedCol)) return null;
  const placed = appendRankedAction(seed, rows, mode, dealt, {
    kind: 'place', placed_col: placedCol,
  });
  if (!placed) return null;
  rows.push(placed.row);
  return placed.state;
}

/** The outcome from the AI seat's side: win 1, draw ½, loss 0. */
export function playRuneTrialGame(seed: string, mode: Mode, dealt: RankedRuneDeal,
                                  seats: readonly [RuneSeat, RuneSeat],
                                  curveVersion: LadderCurveVersion,
                                  random: () => number): number {
  const rows: RankedActionRow[] = [];
  let state = rebuildRankedActions(seed, rows, mode, dealt);
  if (!state) throw new Error('rune trial replay did not initialize');
  for (let turns = 0; !state.over; turns++) {
    if (turns > 100) throw new Error('rune trial replay exceeded its turn cap');
    const seat = seats[state.turn];
    if (seat.casts) {
      const turn = appendRankedBotTurn({
        seed, rows, state, mode, dealt, bot: seat.bot, curveVersion, random,
      });
      if (!turn) throw new Error('a casting seat could not append its turn');
      rows.push(...turn.actions);
      state = turn.state;
    } else {
      const next = appendHoldingTurn(seed, rows, state, mode, dealt, seat, curveVersion, random);
      if (!next) throw new Error('a holding seat could not append its placement');
      state = next;
    }
  }
  const mine = rankedActionTotal(state, AI, mode);
  const theirs = rankedActionTotal(state, ME, mode);
  return mine > theirs ? 1 : mine < theirs ? 0 : 0.5;
}

/** Caster's outcome share over `games`, seats alternating so the opening edge
    cancels. Both seats are dealt `rune`; only one is allowed to spend it. */
export function castVsHold(rune: string, mode: Mode, bot: BotStanding,
                           curveVersion: LadderCurveVersion, games: number,
                           seedPrefix: string, stream: (seed: string) => () => number): number {
  let share = 0;
  for (let game = 0; game < games; game++) {
    const casterIsAI = game % 2 === 0;
    const seats: readonly [RuneSeat, RuneSeat] = [
      { bot, casts: casterIsAI },
      { bot, casts: !casterIsAI },
    ];
    const seed = `${seedPrefix}#${rune}#${game}`;
    const outcome = playRuneTrialGame(seed, mode, [rune, rune], seats, curveVersion,
      stream(`${seed}#policy`));
    share += casterIsAI ? outcome : 1 - outcome;
  }
  return share / games;
}

export { AI, ME };
export type { Player };
