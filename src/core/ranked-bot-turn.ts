// One authoritative protocol-v2 bot turn. Ranked Edge Functions use this
// helper after a human placement and when a bot opens either Rune Trial or
// equipped ordinary ranked.
import { botMove, botSlip } from './bot.ts';
import {
  appendRankedAction,
  type RankedActionRow,
  type RankedActionState,
  type RankedRuneDeal,
} from './ranked-actions.ts';
import { poolSequence } from './dice.ts';
import { botShapeAt, type BotStanding, type LadderCurveVersion } from './ladder.ts';
import { LIMITED, legalCols, type Mode } from './rules.ts';
import { machineCastPlan, spellById } from './spells.ts';

export interface RankedBotTurnInput {
  seed: string;
  rows: readonly RankedActionRow[];
  state: RankedActionState;
  mode: Mode;
  dealt: RankedRuneDeal;
  /** The bot's own standing: points and whether the board ranks it in the apex. */
  bot: BotStanding;
  curveVersion: LadderCurveVersion;
  random: () => number;
}

export interface RankedBotTurnResult {
  actions: RankedActionRow[];
  state: RankedActionState;
}

/** Append the bot's optional cast and mandatory placement from replay truth. */
export function appendRankedBotTurn(
  input: RankedBotTurnInput,
): RankedBotTurnResult | null {
  let { state } = input;
  if (state.over || state.nextDie === null || state.actionCount !== input.rows.length) return null;
  const who = state.turn;
  const rows = [...input.rows];
  const actions: RankedActionRow[] = [];
  const spell = spellById(input.dealt[who]);
  let coordinatedPlacement: number | null = null;

  /* Rune spells are a second source of strength on top of the calibrated
     placement policy. Give them the same league/seat handicap: on a slip the
     bot passes this cast window, then still makes its mandatory placement.
     This keeps Rune Trial human-favoured in both seats without changing who
     opens. The placement makes its own independent slip decision below. */
  const canCast = spell !== null && (state.charges[who][spell.id] ?? 0) > 0;
  const skipsCast = canCast
    && input.random() < botSlip(botShapeAt(input.bot, input.curveVersion), who);
  if (spell && canCast && !skipsCast) {
    const bagLeft = input.mode === LIMITED
      ? poolSequence(input.seed).length - state.drawCount
      : null;
    const castContext = {
      mode: input.mode,
      die: state.nextDie,
      setDie: () => undefined,
      draw: () => state.nextDie!,
      bagLeft,
      charm: state.charm,
    };
    const plan = machineCastPlan(
      state.st,
      who,
      spell,
      castContext,
      16,
      (rootCharm) => botMove(
        state.st,
        who,
        state.nextDie!,
        input.bot,
        input.mode,
        input.curveVersion,
        input.random,
        rootCharm,
      ),
    );
    coordinatedPlacement = plan.placement;
    if (plan.target !== null) {
      if (spell.commitsOnAim) {
        const aimed = appendRankedAction(input.seed, rows, input.mode, input.dealt, {
          kind: 'aim',
          rune_id: spell.id,
        });
        if (!aimed) return null;
        actions.push(aimed.row);
        rows.push(aimed.row);
        state = aimed.state;
      }
      const cast = appendRankedAction(input.seed, rows, input.mode, input.dealt, {
        kind: 'cast',
        rune_id: spell.id,
        target_col: plan.target,
      });
      if (!cast) return null;
      actions.push(cast.row);
      rows.push(cast.row);
      state = cast.state;
    }
  }

  if (!state.over && state.nextDie !== null) {
    const legal = legalCols(state.st[who]);
    if (!legal.length) return null;
    const placedCol = coordinatedPlacement ?? botMove(
      state.st,
      who,
      state.nextDie,
      input.bot,
      input.mode,
      input.curveVersion,
      input.random,
    );
    if (!legal.includes(placedCol)) return null;
    const placed = appendRankedAction(input.seed, rows, input.mode, input.dealt, {
      kind: 'place',
      placed_col: placedCol,
    });
    if (!placed) return null;
    actions.push(placed.row);
    state = placed.state;
  }

  return actions.length ? { actions, state } : null;
}
