// One authoritative protocol-v2 bot turn. Ranked Edge Functions use this
// helper after a human placement and when a bot opens either Rune Trial or
// equipped ordinary ranked.
import { botSearch, botSlipPick } from './bot.ts';
import {
  appendRankedAction,
  type RankedActionRow,
  type RankedActionState,
  type RankedRuneDeal,
} from './ranked-actions.ts';
import { poolSequence } from './dice.ts';
import { botShapeAt, type BotStanding, type LadderCurveVersion } from './ladder.ts';
import { LIMITED, legalCols, type Mode } from './rules.ts';
import { machineCastPlan, spellById, type MachineCastPlan } from './spells.ts';

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
  const shape = botShapeAt(input.bot, input.curveVersion);
  const rows = [...input.rows];
  const actions: RankedActionRow[] = [];
  const spell = spellById(input.dealt[who]);
  const canCast = spell !== null && (state.charges[who][spell.id] ?? 0) > 0;
  let plan: MachineCastPlan | null = null;

  /* The cast is decided on merit at the shape's own demand (a conservative
     league holds a rune it knows would pay — an error of omission), and its
     placement preview is the UN-slipped shape: a coordinated follow-up column
     (WARD, SUNDER) or a registry veto judges a real plan, never a coin-flip
     column. The league/seat slip is applied exactly once per turn, to the
     placement below, never to the cast. Draws here are search jitter only,
     and only for a rune that projects a root charm. */
  if (spell && canCast) {
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
    plan = machineCastPlan(
      state.st,
      who,
      spell,
      castContext,
      shape.castDemand,
      (rootCharm) => botSearch(
        state.st, who, state.nextDie!, shape, input.mode, input.random, rootCharm,
      ),
    );
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
    /* The one handicap: a slip replaces the placement (one roll, one pick).
       Otherwise the un-slipped preview is the answer when a cast just made
       one — WARD and SUNDER leave the boards and the die untouched, so it is
       still exact — else an ordinary search. The follow-up to a cast sees the
       charm it projected. A plan whose cast was vetoed is never reused. */
    const cast = plan !== null && plan.target !== null;
    const charm = cast ? plan!.rootCharm ?? undefined : undefined;
    const placedCol = botSlipPick(state.st, who, state.nextDie, shape, input.mode, input.random, charm)
      ?? (cast && plan!.placement !== null
        ? plan!.placement
        : botSearch(state.st, who, state.nextDie, shape, input.mode, input.random, charm));
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
