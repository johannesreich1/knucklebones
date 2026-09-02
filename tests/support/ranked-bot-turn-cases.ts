// The shared authoritative bot turn: src/core/ranked-bot-turn.ts. One module
// for every ranked bot commit — the immediate lower-rated opener, the reply
// after a human placement, the league slip that gates the Rune cast window,
// and FATE meeting an exhausted LIMITED bag.
//
// check/eq arrive as closures from the entry suite: they push into the entry's
// `problems` array, which is what its exit code reads. A support module with
// its own array would report failures to nobody.
import {
  appendRankedAction,
  rebuildRankedActions,
  type RankedActionRow,
  type RankedActionState,
  type RankedRuneDeal,
} from '../../src/core/ranked-actions.ts';
import { appendRankedBotTurn } from '../../src/core/ranked-bot-turn.ts';
import { LADDER_CURVE_V1, LADDER_CURVE_V2 } from '../../src/core/ladder.ts';
import { AI, CLASSIC, LIMITED, ME, legalCols, type Player } from '../../src/core/rules.ts';

type Check = (condition: boolean, message: string, detail?: unknown) => void;
type Eq = (got: unknown, want: unknown, message: string) => void;

export interface RankedBotTurnCaseHarness {
  check: Check;
  eq: Eq;
  /** The entry's CLASSIC fixture: its seed, its deal, and the opening state
      already rebuilt from an empty log, so the opener is compared against the
      same authoritative replay the protocol cases assert on. */
  seed: string;
  dealt: RankedRuneDeal;
  opening: RankedActionState;
}

/* A ranked bot's league slip also passes its Rune cast window. The low draw
   proves the handicap; the high draw proves it did not disable spells. Both
   cases are HAND-FOUND seeded replays whose whole purpose is to land on one
   specific seat's FATE turn holding nextDie === 1 — re-deriving their columns
   more cleanly lands on a different replay, and the suite silently stops
   testing the cast window while still passing. Only the fixture, the seat and
   the sentences differ; the two-draw drive is one implementation. */
interface CastSlipCase {
  /** Names this fixture inside its own build/arrival failures. */
  fixture: string;
  seed: string;
  dealt: RankedRuneDeal;
  /** The seat whose FATE turn the built replay must arrive on. */
  seat: Player;
  steps: number;
  placedCol: (state: RankedActionState, step: number) => number;
  slipped: string;
  kept: string;
}

/** Fixed columns; this replay never consults the board it is building. */
const REPLY_COLUMNS = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1];
/** Indexes into whatever is legal at each step, so a full column cannot stall it. */
const OPENER_PATTERN = [1, 1, 0];

const CAST_SLIP_CASES: readonly CastSlipCase[] = [
  {
    fixture: 'cast-slip',
    seed: 'cast-fixture-0',
    dealt: ['fate', 'ward'],
    seat: AI,
    steps: REPLY_COLUMNS.length,
    placedCol: (_state, step) => REPLY_COLUMNS[step],
    slipped: 'a bot cast through its league slip instead of passing the Rune window',
    kept: 'the Rune handicap disabled casting instead of making it probabilistic',
  },
  {
    fixture: 'opener cast-slip',
    seed: 'cast-slip-fixture-1-fate-0',
    dealt: ['nudge', 'fate'],
    seat: ME,
    steps: 10,
    placedCol: (state, step) => {
      const legal = legalCols(state.st[state.turn]);
      return legal[OPENER_PATTERN[step % OPENER_PATTERN.length] % legal.length];
    },
    slipped: 'a bot opener cast through its league slip instead of passing the Rune window',
    kept: 'the opener Rune handicap disabled casting instead of making it probabilistic',
  },
];

function runCastSlipCase(check: Check, testCase: CastSlipCase): void {
  const { fixture, seed, dealt, seat } = testCase;
  const rows: RankedActionRow[] = [];
  let state = rebuildRankedActions(seed, rows, CLASSIC, dealt);
  if (!state) throw new Error(`${fixture} fixture did not initialize`);
  for (let step = 0; step < testCase.steps; step++) {
    const appended = appendRankedAction(seed, rows, CLASSIC, dealt, {
      kind: 'place', placed_col: testCase.placedCol(state, step),
    });
    if (!appended) throw new Error(`${fixture} fixture placement did not append`);
    rows.push(appended.row);
    state = appended.state;
  }
  check(state.turn === seat && state.nextDie === 1,
    `${fixture} fixture did not reach the intended bot FATE turn`, state);
  const skippedCast = appendRankedBotTurn({
    seed, rows, state, mode: CLASSIC, dealt, bot: { points: 800, apex: false },
    curveVersion: LADDER_CURVE_V2, random: () => 0,
  });
  // A counter per case: a shared one would leak draw state between fixtures.
  let castDraw = 0;
  const keptCast = appendRankedBotTurn({
    seed, rows, state, mode: CLASSIC, dealt, bot: { points: 800, apex: false },
    curveVersion: LADDER_CURVE_V2, random: () => castDraw++ === 0 ? 0.99 : 0.5,
  });
  check(skippedCast?.actions.length === 1 && skippedCast.actions[0].kind === 'place'
    && skippedCast.state.charges[seat].fate === 2,
    testCase.slipped, skippedCast);
  check(keptCast !== null
    && keptCast.actions.some(({ kind, rune_id }) => kind === 'cast' && rune_id === 'fate')
    && keptCast.state.charges[seat].fate === 1,
    testCase.kept, keptCast);

  /* During the dormant v2 rollout the same rating belongs to different
     groups on the two curves. Keep the match-owned curve observable here:
     720 is IVORY on v1 (0.60 slip) and BONE on v2 (0.70 slip), so the same
     0.65 draw must preserve the cast on v1 and skip it on v2. This catches a
     caller or either half of this helper silently falling back to v2. */
  if (fixture === 'cast-slip') {
    const stagedTurn = (curveVersion: typeof LADDER_CURVE_V1 | typeof LADDER_CURVE_V2) => {
      let draw = 0;
      const values = [0.65, 0.99, 0.5];
      return appendRankedBotTurn({
        seed,
        rows,
        state,
        mode: CLASSIC,
        dealt,
        bot: { points: 720, apex: false },
        curveVersion,
        random: () => values[draw++] ?? 0.5,
      });
    };
    const v1Turn = stagedTurn(LADDER_CURVE_V1);
    const v2Turn = stagedTurn(LADDER_CURVE_V2);
    check(v1Turn !== null
      && v1Turn.actions.some(({ kind, rune_id }) => kind === 'cast' && rune_id === 'fate')
      && v1Turn.state.charges[seat].fate === 1
      && v2Turn?.actions.length === 1 && v2Turn.actions[0].kind === 'place'
      && v2Turn.state.charges[seat].fate === 2,
    'ranked bot turn ignored the match-owned ladder curve during staged rollout',
    { v1Turn, v2Turn });
  }
}

export function runRankedBotTurnCases(harness: RankedBotTurnCaseHarness): void {
  const { check, eq, seed, dealt, opening } = harness;

  // The same bot turn builder drives the immediate lower-rated bot opener and
  // replies after human placements. It must finish one complete opening turn
  // from replay truth, whether or not its rune policy elects to cast first.
  const botOpening = appendRankedBotTurn({
    seed,
    rows: [],
    state: opening,
    mode: CLASSIC,
    dealt,
    bot: { points: 800, apex: false },
    curveVersion: LADDER_CURVE_V2,
    random: () => 0,
  });
  check(botOpening !== null && botOpening.actions.at(-1)?.kind === 'place'
    && botOpening.state.moveCount === 1 && botOpening.state.turn === AI
    && botOpening.state.actionCount === botOpening.actions.length,
    'ranked bot opener did not commit one complete turn before handing input to p2', botOpening);
  if (botOpening) {
    eq(rebuildRankedActions(seed, botOpening.actions, CLASSIC, dealt), botOpening.state,
      'ranked bot opener diverged from the shared authoritative replay');
  }
  check(appendRankedBotTurn({
    seed,
    rows: [],
    state: { ...opening, actionCount: 1 },
    mode: CLASSIC,
    dealt,
    bot: { points: 800, apex: false },
    curveVersion: LADDER_CURVE_V2,
    random: () => 0,
  }) === null, 'ranked bot opener accepted a state/version mismatch');

  for (const testCase of CAST_SLIP_CASES) runCastSlipCase(check, testCase);

  // The die already in hand counts as drawn. On the final LIMITED turn FATE
  // must see an empty bag, decline its redraw, and let the bot place that die.
  const limitedBotSeed = 'audit-31';
  const limitedBotDeal: RankedRuneDeal = ['fate', 'ward'];
  const limitedBotRows: RankedActionRow[] = [];
  let limitedBotState = rebuildRankedActions(limitedBotSeed, limitedBotRows, LIMITED, limitedBotDeal);
  if (!limitedBotState) throw new Error('LIMITED bot fixture did not initialize');
  for (let step = 0; step < 23; step++) {
    const legal = legalCols(limitedBotState.st[limitedBotState.turn]);
    const appended = appendRankedAction(limitedBotSeed, limitedBotRows, LIMITED, limitedBotDeal, {
      kind: 'place', placed_col: legal[(31 + step * 7) % legal.length],
    });
    if (!appended) throw new Error(`LIMITED bot fixture stopped at placement ${step}`);
    limitedBotRows.push(appended.row);
    limitedBotState = appended.state;
  }
  check(limitedBotState.drawCount === 24 && limitedBotState.nextDie === 1
    && limitedBotState.turn === AI,
    'LIMITED bot fixture did not reach FATE holding the final live die', limitedBotState);
  const finalLimitedTurn = appendRankedBotTurn({
    seed: limitedBotSeed,
    rows: limitedBotRows,
    state: limitedBotState,
    mode: LIMITED,
    dealt: limitedBotDeal,
    bot: { points: 800, apex: false },
    curveVersion: LADDER_CURVE_V2,
    random: () => 0,
  });
  check(finalLimitedTurn !== null && finalLimitedTurn.actions.length === 1
    && finalLimitedTurn.actions[0].kind === 'place' && finalLimitedTurn.state.over,
    'ranked bot tried to cast FATE after the LIMITED bag was exhausted', finalLimitedTurn);
}
