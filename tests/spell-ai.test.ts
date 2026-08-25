// Focused gate for local CPU rune/placement coordination. Pure core decides
// which follow-up columns make a cast self-defeating; this flow seam decides
// how much each difficulty is allowed to coordinate.
// Run: node --experimental-strip-types tests/spell-ai.test.ts
import {
  AI,
  BOUNTY,
  CLASSIC,
  applyMove,
  cloneCharm,
  cloneSt,
  freshCharm,
  type GameState,
  type Player,
} from '../src/core/rules.ts';
import { searchRoot } from '../src/core/ai.ts';
import {
  immediatePlacementGain,
  machineCastPlan,
  machineCast,
  placeGain,
  spellById,
  type CastCtx,
  type SpellSpec,
} from '../src/core/spells.ts';
import { aiChoose } from '../src/flow/game-ai.ts';
import {
  NORMAL_CHARM_COORDINATION_SLIP_RATE,
  runAiSpellTurn,
} from '../src/flow/spell-ai.ts';
import { S, type Diff } from '../src/state.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown): void => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const original = {
  boards: S.boards,
  diff: S.diff,
  die: S.die,
  scoring: S.scoring,
  spellCharges: S.spellCharges,
  charm: S.charm,
  tut: S.tut,
  random: Math.random,
};

interface RunResult {
  castTargets: number[];
  placement: number | null;
  previewCalls: number;
  charges: number;
}

interface SunderRunResult extends RunResult {
  previewHadSunder: boolean;
  finalPlacement: number;
}

async function runSunder(
  diff: Diff,
  board: GameState,
  die: number,
  coordinationSample: number,
): Promise<SunderRunResult> {
  S.boards = [
    board[0].map((column) => column.slice()),
    board[1].map((column) => column.slice()),
  ];
  S.diff = diff;
  S.die = die;
  S.scoring = CLASSIC;
  S.spellCharges = [{ sunder: 1 }, {}];
  S.charm = freshCharm();
  S.tut = null;
  let previewCalls = 0;
  let previewHadSunder = false;
  const castTargets: number[] = [];
  const context: CastCtx = {
    mode: CLASSIC,
    die,
    setDie: (value) => { S.die = value; },
    draw: () => 1,
    bagLeft: null,
    charm: S.charm,
  };
  const result = await runAiSpellTurn(AI, {
    chargesOf: (who, id) => S.spellCharges[who][id] ?? 0,
    castContext: () => context,
    previewPlacement: (rootCharm) => {
      previewCalls++;
      previewHadSunder ||= !!rootCharm?.sunder[AI];
      return aiChoose(rootCharm);
    },
    random: () => coordinationSample,
    castBy: async (who: Player, spell: SpellSpec, column: number, ctx: CastCtx) => {
      castTargets.push(column);
      S.spellCharges[who][spell.id]--;
      spell.apply(S.boards as GameState, who, column, ctx);
      return false;
    },
  }, false);
  return {
    castTargets,
    placement: result.placement,
    finalPlacement: result.placement ?? aiChoose(),
    previewCalls,
    previewHadSunder,
    charges: S.spellCharges[AI].sunder,
  };
}

const pureContext = (mode = CLASSIC, die = 6): CastCtx => ({
  mode,
  die,
  setDie: () => undefined,
  draw: () => 1,
  bagLeft: null,
  charm: freshCharm(),
});

try {
  /* Minimal SUNDER counterexample: the cast is worth 12 only if placement
     knows the wide strike is already global. A plain search spends it in
     column 0 for no marginal effect; the exact root charm chooses column 1. */
  const sunder = spellById('sunder')!;
  const minimal: GameState = [[[], [6], []], [[6, 6], [], []]];
  const sunderContext = pureContext(CLASSIC);
  const plainMove = searchRoot(minimal, AI, 6, 2, {
    mode: CLASSIC, random: () => 0.5, riskWeight: 0.9,
  });
  const projected = cloneCharm(sunderContext.charm);
  projected.sunder[AI] = true;
  const coordinatedMove = searchRoot(minimal, AI, 6, 2, {
    mode: CLASSIC, random: () => 0.5, riskWeight: 0.9, rootCharm: projected,
  });
  check(plainMove.c === 0 && coordinatedMove.c === 1,
    'root-charm search must reverse the minimal blind SUNDER placement',
    { plainMove, coordinatedMove });
  check(!sunderContext.charm.sunder[AI] && projected.sunder[AI],
    'root search must not consume the caller\'s projected charm',
    { live: sunderContext.charm, projected });

  const plan = machineCastPlan(minimal, AI, sunder, sunderContext, 16,
    (rootCharm) => searchRoot(minimal, AI, 6, 2, {
      mode: CLASSIC, random: () => 0.5, riskWeight: 0.9, rootCharm,
    }).c);
  check(plan.target === -1 && plan.placement === 1 && !!plan.rootCharm?.sunder[AI]
      && !plan.vetoedByPlacement,
    'SUNDER registry must hand the coordinator its exact armed root charm', plan);

  const ordinaryState = cloneSt(minimal), sunderedState = cloneSt(minimal);
  const ordinaryCharm = freshCharm(), sunderedCharm = freshCharm();
  sunderedCharm.sunder[AI] = true;
  applyMove(ordinaryState, AI, 0, 6, CLASSIC, ordinaryCharm);
  applyMove(sunderedState, AI, 0, 6, CLASSIC, sunderedCharm);
  check(JSON.stringify(ordinaryState) === JSON.stringify(sunderedState)
      && JSON.stringify(ordinaryCharm) === JSON.stringify(sunderedCharm),
    'the old column-0 SUNDER move must be proven strictly transition-equivalent',
    { ordinaryState, sunderedState, ordinaryCharm, sunderedCharm });

  /* Cast valuation must preserve a live enemy WARD. In this exact state the
     old fresh-charm estimate was 12 points; both live-charm plans are 18, so
     SUNDER has zero scored marginal value and both Normal and Hard hold. */
  const wardedContext = pureContext(CLASSIC);
  wardedContext.charm.wards[1][0] = 1;
  const freshWide = freshCharm();
  freshWide.sunder[AI] = true;
  const livePlain = cloneCharm(wardedContext.charm);
  const liveWide = cloneCharm(wardedContext.charm);
  liveWide.sunder[AI] = true;
  const wardValues = [
    placeGain(minimal, AI, 6, CLASSIC),
    placeGain(minimal, AI, 6, CLASSIC, freshWide),
    immediatePlacementGain(minimal, AI, 6, CLASSIC, { charm: livePlain }),
    immediatePlacementGain(minimal, AI, 6, CLASSIC, { charm: liveWide }),
  ];
  check(String(wardValues) === '30,42,18,18',
    'SUNDER valuation must preserve the exact fresh 12 vs live-WARD 0 marginal',
    wardValues);
  check(machineCast(minimal, AI, sunder, wardedContext, 16) === null
      && machineCast(minimal, AI, sunder, wardedContext, 10) === null,
    'SUNDER cast valuation must not count dice behind a live WARD as destroyed');

  /* BOUNTY banks one point per victim outside the board. In this 5/5/5
     threshold state the board-only SUNDER marginal is 10, but the two extra
     global victims make its real marginal 12: exactly Normal's cast floor. */
  const bountyState: GameState = [[[], [], []], [[5], [5], [5]]];
  const bountyPlain = freshCharm();
  const bountyWide = freshCharm();
  bountyWide.sunder[AI] = true;
  const boardOnly = [
    placeGain(bountyState, AI, 5, BOUNTY, bountyPlain),
    placeGain(bountyState, AI, 5, BOUNTY, bountyWide),
  ];
  const bountyAware = [
    immediatePlacementGain(bountyState, AI, 5, BOUNTY, {
      charm: bountyPlain, bankPerKill: 1,
    }),
    immediatePlacementGain(bountyState, AI, 5, BOUNTY, {
      charm: bountyWide, bankPerKill: 1,
    }),
  ];
  check(String(boardOnly) === '10,20' && String(bountyAware) === '11,23',
    'the immediate-placement seam must count BOUNTY victims only when explicitly requested',
    { boardOnly, bountyAware });
  check(machineCast(bountyState, AI, sunder, pureContext(CLASSIC, 5), 16) === null
      && machineCast(bountyState, AI, sunder, pureContext(BOUNTY, 5), 16) === -1,
    'Normal SUNDER must hold at board-only marginal 10 but cast at BOUNTY marginal 12');

  Math.random = () => 0.5;
  check(NORMAL_CHARM_COORDINATION_SLIP_RATE === 0.05,
    'Normal charm-coordination slip must remain the named 5% difficulty rule',
    NORMAL_CHARM_COORDINATION_SLIP_RATE);
  const normalSunder = await runSunder('medium', minimal, 6, 0.5);
  check(String(normalSunder.castTargets) === '-1' && normalSunder.previewCalls === 1
      && normalSunder.previewHadSunder && normalSunder.placement === 1
      && normalSunder.finalPlacement === 1,
    'Normal must keep the coordinated SUNDER placement outside its 5% slip', normalSunder);

  const normalSlip = await runSunder('medium', minimal, 6, 0);
  check(String(normalSlip.castTargets) === '-1' && normalSlip.previewHadSunder
      && normalSlip.placement === null && normalSlip.finalPlacement === 0,
    'Normal\'s explicit 5% slip must fall back to the ordinary blind placement', normalSlip);

  const hardSunder = await runSunder('hard', minimal, 6, 0);
  check(String(hardSunder.castTargets) === '-1' && hardSunder.previewCalls === 1
      && hardSunder.previewHadSunder && hardSunder.placement === 1
      && hardSunder.finalPlacement === 1,
    'Hard must reuse the exact coordinated SUNDER preview with zero slip', hardSunder);

  /* Easy can still reproduce the old no-op when its larger demand is cleared:
     it gets no root preview and makes the same blind post-cast choice. */
  Math.random = () => 0.75;
  const easyBlind: GameState = [[[6, 6], [], []], [[], [6, 6, 6], []]];
  const easySunder = await runSunder('easy', easyBlind, 6, 0.75);
  check(String(easySunder.castTargets) === '-1' && easySunder.previewCalls === 0
      && !easySunder.previewHadSunder && easySunder.placement === null
      && easySunder.finalPlacement === 1,
    'Easy must keep its existing blind SUNDER cast and placement behavior', easySunder);
} finally {
  S.boards = original.boards;
  S.diff = original.diff;
  S.die = original.die;
  S.scoring = original.scoring;
  S.spellCharges = original.spellCharges;
  S.charm = original.charm;
  S.tut = original.tut;
  Math.random = original.random;
}

console.log(JSON.stringify({ problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
