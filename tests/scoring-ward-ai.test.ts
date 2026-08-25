// Focused owner for scoring-WARD casting and placement policy at all strengths.
// Run: mise exec -- node --experimental-strip-types tests/scoring-ward-ai.test.ts
import {
  AI, CLASSIC, COLSHIELD, cloneCharm, cloneSt, freshCharm,
  type GameState, type Player,
} from '../src/core/rules.ts';
import { searchRoot } from '../src/core/ai.ts';
import {
  machineCast, machineCastPlan, spellById, type CastCtx, type SpellSpec,
} from '../src/core/spells.ts';
import { aiChoose } from '../src/flow/game-ai.ts';
import { runAiSpellTurn } from '../src/flow/spell-ai.ts';
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
  spellCastThisTurn: S.spellCastThisTurn,
  charm: S.charm,
  tut: S.tut,
  random: Math.random,
};

interface WardRunResult {
  castTargets: number[];
  placement: number | null;
  previewCalls: number;
  previewHadWard: boolean;
  finalPlacement: number;
  charges: number;
}

const pureContext = (mode = COLSHIELD, die = 6): CastCtx => ({
  mode,
  die,
  setDie: () => undefined,
  draw: () => 1,
  bagLeft: null,
  charm: freshCharm(),
});

async function runWard(
  diff: Diff,
  board: GameState,
  preview: number,
  coordinationSample = 0.5,
): Promise<WardRunResult> {
  S.boards = cloneSt(board);
  S.diff = diff;
  S.die = 6;
  S.scoring = COLSHIELD;
  S.spellCharges = [{ ward: 1 }, {}];
  S.spellCastThisTurn = null;
  S.charm = freshCharm();
  S.tut = null;
  let previewCalls = 0;
  let previewHadWard = false;
  const castTargets: number[] = [];
  const context: CastCtx = {
    mode: COLSHIELD,
    die: S.die,
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
      previewHadWard ||= !!rootCharm?.wards[AI].some(Boolean);
      return preview;
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
    previewHadWard,
    charges: S.spellCharges[AI].ward,
  };
}

try {
  /* WARD projects the persistent scoring mark into coordinated placement.
     Completing the target may cancel its bonus, but is not vetoed. */
  const ward = spellById('ward')!;
  const pureBoard: GameState = [[[6, 6], [], []], [[], [], []]];
  let purePreviews = 0;
  const completed = machineCastPlan(pureBoard, AI, ward, pureContext(), 16,
    () => { purePreviews++; return 0; });
  check(completed.target === 0 && completed.placement === 0
      && completed.rootCharm?.wards[AI][0] === 1
      && !completed.vetoedByPlacement && purePreviews === 1,
    'WARD must project its scoring mark without vetoing target completion',
    { completed, purePreviews });
  const safe = machineCastPlan(pureBoard, AI, ward, pureContext(), 16, () => 1);
  check(safe.target === 0 && safe.placement === 1 && safe.rootCharm?.wards[AI][0] === 1
      && !safe.vetoedByPlacement,
    'the projected WARD remains available to an alternative placement preview', safe);
  let classicPreviews = 0;
  const classic = machineCastPlan(pureBoard, AI, ward, pureContext(CLASSIC), 16,
    () => { classicPreviews++; return 0; });
  check(classic.target === 0 && classic.placement === 0 && classicPreviews === 1
      && classic.rootCharm?.wards[AI][0] === 1,
    'WARD placement search must see the projected mark in every mode',
    { classic, classicPreviews });
  const uncoordinated = machineCastPlan(pureBoard, AI, ward, pureContext(), 16);
  check(uncoordinated.target === 0 && uncoordinated.placement === null,
    'a caller without a placement preview must keep the original cast answer', uncoordinated);

  /* Easy retains demand 30. Normal and Hard share demand 16 / valuation 24;
     both receive the projected mark, and Hard reuses its preview exactly. */
  Math.random = () => 0.5;
  const easy = await runWard('easy', pureBoard, 1, 0.75);
  check(easy.castTargets.length === 0 && easy.previewCalls === 0 && easy.charges === 1
      && easy.placement === null,
    'Easy must retain its higher WARD cast demand and skip placement preview', easy);
  const normal = await runWard('medium', pureBoard, 1, 0.5);
  check(String(normal.castTargets) === '0' && normal.previewCalls === 1
      && normal.previewHadWard && normal.charges === 0
      && normal.placement === 1 && normal.finalPlacement === 1,
    'Normal must coordinate its WARD-aware placement outside the named rare slip', normal);
  const hard = await runWard('hard', pureBoard, 0, 0);
  check(String(hard.castTargets) === '0' && hard.previewCalls === 1
      && hard.previewHadWard && hard.charges === 0
      && hard.placement === 0 && hard.finalPlacement === 0,
    'Hard must reuse the exact WARD-aware preview even when it completes the target', hard);

  /* Search builds and preserves its own scoring mark, attacks the opponent's,
     and carries the persistent state into deeper opponent plies. */
  const extend: GameState = [[[], [4, 5], []], [[], [], []]];
  const extendCharm = freshCharm();
  extendCharm.wards[AI][1] = 1;
  const plainExtend = searchRoot(extend, AI, 6, 1, {
    mode: CLASSIC, random: () => 0.5, riskWeight: 0,
  });
  const wardExtend = searchRoot(extend, AI, 6, 1, {
    mode: CLASSIC, random: () => 0.5, riskWeight: 0, rootCharm: extendCharm,
  });
  check(plainExtend.c === 0 && wardExtend.c === 1 && wardExtend.v === 30,
    'placement search must extend its own scoring WARD', { plainExtend, wardExtend });

  const preserve: GameState = [[[4, 5], [], []], [[], [], []]];
  const preserveCharm = freshCharm();
  preserveCharm.wards[AI][0] = 1;
  const plainDuplicate = searchRoot(preserve, AI, 4, 1, {
    mode: CLASSIC, random: () => 0.5, riskWeight: 0,
  });
  const wardPreserve = searchRoot(preserve, AI, 4, 1, {
    mode: CLASSIC, random: () => 0.5, riskWeight: 0, rootCharm: preserveCharm,
  });
  const wardDeeper = searchRoot(preserve, AI, 4, 2, {
    mode: CLASSIC, random: () => 0.5, riskWeight: 0, rootCharm: preserveCharm,
  });
  check(plainDuplicate.c === 0 && wardPreserve.c === 1,
    'WARD-aware root search must avoid an owner duplicate when preserving scores more',
    { plainDuplicate, wardPreserve });
  check(wardDeeper.c === 0 && wardDeeper.v === 17.5,
    'persistent WARD state must survive into opponent plies and change expected defense', wardDeeper);

  const attack: GameState = [[[], [], []], [[4], [4, 5], []]];
  const attackCharm = freshCharm();
  attackCharm.wards[1][1] = 1;
  const plainAttack = searchRoot(attack, AI, 4, 1, {
    mode: CLASSIC, random: () => 0.5, riskWeight: 0,
  });
  const wardAttack = searchRoot(attack, AI, 4, 1, {
    mode: CLASSIC, random: () => 0.5, riskWeight: 0, rootCharm: attackCharm,
  });
  check(plainAttack.c === 0 && wardAttack.c === 1,
    'placement search must redirect a matching die to remove the enemy WARD bonus',
    { plainAttack, wardAttack });

  const shieldAttack: GameState = [[[], [], []], [[4, 5, 6], [4], []]];
  const shieldCharm = freshCharm();
  shieldCharm.wards[1][0] = 1;
  const plainShield = searchRoot(shieldAttack, AI, 4, 1, {
    mode: COLSHIELD, random: () => 0.5, riskWeight: 0,
  });
  const wardShield = searchRoot(shieldAttack, AI, 4, 1, {
    mode: COLSHIELD, random: () => 0.5, riskWeight: 0, rootCharm: shieldCharm,
  });
  check(plainShield.c === 1 && wardShield.c === 0,
    'search must value the zero-victim matching action that dispels a full shielded WARD',
    { plainShield, wardShield });

  /* The ordinary production chooser receives live WARDs at every strength. */
  S.boards = cloneSt(shieldAttack);
  S.die = 4;
  S.scoring = COLSHIELD;
  S.tut = null;
  S.charm = freshCharm();
  for (const diff of ['easy', 'medium', 'hard'] as Diff[]) {
    S.diff = diff;
    check(aiChoose() === 1, `${diff} control should attack the removable singleton`);
  }
  S.charm.wards[1][0] = 1;
  for (const diff of ['easy', 'medium', 'hard'] as Diff[]) {
    S.diff = diff;
    check(aiChoose() === 0, `${diff} must attack the persistent full-shield WARD`);
  }

  /* Die-transform spells compare options against live WARD state. */
  const fate = spellById('fate')!;
  const fateState: GameState = [[[], [], []], [[2, 3], [], []]];
  const plainFate = pureContext(CLASSIC, 1);
  const wardFate = pureContext(CLASSIC, 1);
  wardFate.charm.wards[1][0] = 1;
  check(machineCast(fateState, AI, fate, plainFate, 16) === null
      && machineCast(fateState, AI, fate, wardFate, 16) === -1,
    'FATE cast valuation must react to an enemy scoring WARD');
  const nudge = spellById('nudge')!;
  const nudgeState: GameState = [[[], [], []], [[1, 4], [], []]];
  const plainNudge = pureContext(CLASSIC, 3);
  const wardNudge = pureContext(CLASSIC, 3);
  wardNudge.charm.wards[1][0] = 1;
  check(machineCast(nudgeState, AI, nudge, plainNudge, 16) === null
      && machineCast(nudgeState, AI, nudge, wardNudge, 16) === -1,
    'NUDGE cast valuation must react to an enemy scoring WARD');

  /* Normal fallback keeps persistent WARD awareness but must not leak the
     pending one-shot SUNDER into its independent placement. */
  const minimal: GameState = [[[], [6], []], [[6, 6], [], []]];
  S.boards = cloneSt(minimal);
  S.diff = 'medium';
  S.die = 6;
  S.scoring = CLASSIC;
  S.charm = freshCharm();
  S.charm.wards[AI][2] = 1;
  S.charm.sunder[AI] = true;
  const explicitWide = aiChoose(cloneCharm(S.charm));
  const ordinaryWithWard = aiChoose();
  check(explicitWide === 1 && ordinaryWithWard === 0,
    'Normal fallback must preserve persistent WARD awareness while remaining blind to SUNDER',
    { explicitWide, ordinaryWithWard });
} finally {
  S.boards = original.boards;
  S.diff = original.diff;
  S.die = original.die;
  S.scoring = original.scoring;
  S.spellCharges = original.spellCharges;
  S.spellCastThisTurn = original.spellCastThisTurn;
  S.charm = original.charm;
  S.tut = original.tut;
  Math.random = original.random;
}

console.log(JSON.stringify({ problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
