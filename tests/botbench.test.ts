// The bot ladder, simulated. ladder.test.ts pins the per-group shape NUMBERS;
// this pins what they are FOR — a measured human-favoured curve that becomes
// steadily less gentle but never makes the bot the calibrated favourite. A
// future retune edits the registry and then has to get past this suite, which
// is the "measure, don't guess" rule in gate form.
//
// Deterministic: Math.random is replaced by a seeded stream and passed into
// core/ai.ts for tie-break jitter — the gate may not depend on the machine's
// mood. The margins below sit well under the tuned values (the current seeded
// cells are printed below), so they catch a broken retune, not simulation
// drift.
import { COLSHIELD } from '../src/core/rules.ts';
import { GROUPS } from '../src/core/ladder.ts';
import {
  ALL_RANKED_CAPABILITIES, rankedOutcomePool, type RankedPoolTier,
} from '../src/core/ranked-outcomes.ts';
import {
  duel, rankedBotPool, seeded, type Policy, type WeightedMode,
} from './support/policy-duel-bench.ts';
import { checkBotMoveContract } from './support/bot-move-contract.ts';

const problems: string[] = [];
const errs: string[] = [];

Math.random = seeded(20260820);

const RANDOM: Policy = { random: true };
/* A league IS its shape: the bench measures the registry object itself, so
   the apex row is always the NEON shape and never a points fallback. */
const rankedBot = (index: number): Policy => ({ shape: GROUPS[index].bot });

/* 1 · the onboarding promise. This bench used to make two mutually masking
   mistakes: it always put the bot in AI/p2, and search weights were evaluated
   from that fixed seat, so its supposed ME/p1 "pure builder" was actually
   minimizing the bot's score. A live 0–0 loss exposed the gap: the bot opened
   as ME/p1, where STONE's negative opponent weight reversed into aggression.

   searchRoot is now root-player-relative, actual bot policies go through the
   production botMove seam, and the four-mode STONE pool below measures BOTH
   legal seat orders. The existing equality tiebreak may put a 0–0 STONE bot
   in the opening seat, so that seat must be gentle in its own right. */
const NEWCOMER: Policy = { depth: 1, oppW: 0, risk: 0, slip: 0 };

/* Read the real wheel instead of copying its 40/60 weights here. Rune Trial
   remains a distinct reported outcome, while its underlying board correctly
   uses Classic; dedicated rune benches own the spell decisions. */
function productionPool(tier: RankedPoolTier): readonly WeightedMode[] {
  const entries = rankedOutcomePool([{
    tier,
    capabilities: ALL_RANKED_CAPABILITIES,
  }]);
  const total = entries.reduce((sum, { weight }) => sum + weight, 0);
  return entries.map(({ outcome, weight }) => [outcome.id, outcome.mode, weight / total] as const);
}

const STONE_POOL = productionPool('stone');
const BONE_POOL = productionPool('bone');
const IVORY_POOL = productionPool('ivory');

/* 2 · the first promotion must be felt: BONE stops actively sparing your
   board and beats kill-averse STONE clearly. This is the seam the whole
   rework exists for. */
const boneVsStone = duel(rankedBot(1), rankedBot(0), 600);
if (!(boneVsStone >= 0.55)) {
  problems.push(`BONE beats STONE only ${(boneVsStone * 100).toFixed(1)}% — the destroy-blind floor is not doing its job`);
}

/* 3 · COLSHIELD awareness must not COST anything. The risk model once skipped
   shielded columns — true, and a measured 44.5% vs a mode-blind twin: closing
   a column deleted its risk from the eval, so the searcher slammed columns
   shut on junk (see riskOf in core/ai.ts for the full finding). With the skip
   cut, aware-vs-blind is parity (~50%). This duel refuses the skip's return:
   it sat ~44.5% and cannot clear the bar. */
const csAware: Policy = { depth: 2, risk: 0.9, mode: COLSHIELD };
const csBlind: Policy = { depth: 2, risk: 0.9 };
const csAwareVsBlind = duel(csAware, csBlind, 800, COLSHIELD);
if (!(csAwareVsBlind >= 0.47)) {
  problems.push(`COLSHIELD-aware search wins only ${(csAwareVsBlind * 100).toFixed(1)}% of colshield games `
    + `vs a mode-blind twin — a losing mode heuristic is back in the eval (the risk-model shield skip `
    + `measured 44.5% here; awareness may be neutral, never a handicap)`);
}

/* 4 · The user-facing league curve. These are HUMAN outcome shares (a draw is
   half), measured against a simple seat-neutral builder over the real ranked
   wheel. A bot may open (including through the existing equality tiebreak),
   so every group is measured in both legal seat orders.

   A bot opener gets the production safe-slip adjustment in core/bot.ts. That
   offsets the opening-seat edge without changing matchmaking or pretending
   the human always opens. The hard contract is simple: the bot's calibrated
   aggregate share may approach 50%, never exceed it. */
const GROUP_POOLS = GROUPS.map((_, index) =>
  index === 0 ? STONE_POOL : index === 1 ? BONE_POOL : IVORY_POOL);
const curveGames = (index: number, depth: number) => index < 3 ? 600
  : depth >= 4 ? 400 : depth >= 3 ? 400 : depth >= 2 ? 600 : 800;
const reweight = (cell: ReturnType<typeof rankedBotPool>, pool: readonly WeightedMode[]) => ({
  modes: cell.modes,
  weighted: pool.reduce((sum, [name, , weight]) => sum + cell.modes[name] * weight, 0),
});
/* Rune Trial adds spell decisions that the mechanical cells above cannot
   express. With the bot's shipping cast-slip handicap, a production-path
   simulation measured 54.3–61.0% human share for a simple active caster in
   every league/seat, while a human who never casts measured 45.0–48.9% in the
   Rune outcome itself. Replacing Rune's Classic proxy with a deliberately
   harsher 38%/40% floor (human/bot opens) keeps even the weighted no-cast
   aggregate promise honest. Dedicated Rune suites own the spell mechanics;
   changing those mechanics requires rerunning this calibration rather than
   assuming Classic parity. */
const NOVICE_RUNE_FLOOR = { humanFirst: 0.38, botFirst: 0.40 } as const;
const withRuneFloor = (cell: ReturnType<typeof rankedBotPool>, humanFirst: boolean) => ({
  ...cell,
  modes: {
    ...cell.modes,
    rune_trial: humanFirst ? NOVICE_RUNE_FLOOR.humanFirst : NOVICE_RUNE_FLOOR.botFirst,
  },
});
const fullOutcomeCells = GROUPS.map((group, index) => {
  const games = curveGames(index, group.bot.depth);
  return {
    humanFirst: rankedBotPool(rankedBot(index), IVORY_POOL, NEWCOMER, true, games, 7200),
    botFirst: rankedBotPool(rankedBot(index), IVORY_POOL, NEWCOMER, false, games, 7200),
  };
});
const leagueCurve = fullOutcomeCells.map((cell, index) => ({
  humanFirst: reweight(cell.humanFirst, GROUP_POOLS[index]),
  botFirst: reweight(cell.botFirst, GROUP_POOLS[index]),
}));

const targetBands = [ // human low/high, then bot-opener low/high
  [0.73, 0.85, 0.62, 0.72], [0.59, 0.65, 0.59, 0.67],
  [0.53, 0.59, 0.53, 0.60], [0.51, 0.58, 0.52, 0.59],
  [0.50, 0.56, 0.52, 0.58], [0.50, 0.55, 0.51, 0.57],
  [0.50, 0.54, 0.50, 0.56],
] as const;
/* Smaller deterministic gate cells allow target bands ±3pp; the 50% floor
   stays strict, and ladder.test.ts pins every shipping shape number. */
const sampleTolerance = 0.03;
for (let index = 0; index < GROUPS.length; index++) {
  const group = GROUPS[index];
  const cell = leagueCurve[index];
  const [low, high, botFirstLow, botFirstHigh] = targetBands[index];
  if (!(cell.humanFirst.weighted >= low - sampleTolerance
    && cell.humanFirst.weighted <= high + sampleTolerance)) {
    problems.push(`${group.id} gives a human opener ${(cell.humanFirst.weighted * 100).toFixed(1)}% `
      + `outcome share — expected ${(low * 100).toFixed(0)}–${(high * 100).toFixed(0)}%`);
  }
  if (!(cell.botFirst.weighted >= botFirstLow - sampleTolerance
    && cell.botFirst.weighted <= botFirstHigh + sampleTolerance)) {
    problems.push(`${group.id} gives a human facing a bot opener ${(cell.botFirst.weighted * 100).toFixed(1)}% `
      + `outcome share — expected `
      + `${(botFirstLow * 100).toFixed(0)}–${(botFirstHigh * 100).toFixed(0)}%`);
  }
  if (cell.humanFirst.weighted < 0.50 || cell.botFirst.weighted < 0.50) {
    problems.push(`${group.id} makes the bot the calibrated favourite: human-first `
      + `${(cell.humanFirst.weighted * 100).toFixed(1)}%, bot-first `
      + `${(cell.botFirst.weighted * 100).toFixed(1)}% human outcome share`);
  }
  if (index > 0 && (cell.humanFirst.weighted
      > leagueCurve[index - 1].humanFirst.weighted + 0.01
    || cell.botFirst.weighted > leagueCurve[index - 1].botFirst.weighted + 0.01)) {
    problems.push(`${group.id} became gentler than ${GROUPS[index - 1].id} in a legal seat; `
      + `both human-favoured curves must still get harder by league`);
  }
  const reachablePools = index === 0 ? [STONE_POOL, BONE_POOL, IVORY_POOL]
    : index === 1 ? [BONE_POOL, IVORY_POOL]
      : [BONE_POOL, IVORY_POOL]; // IVORY clients without Trial capability reweight to BONE.
  for (const pool of reachablePools) {
    const humanFirstCell = withRuneFloor(fullOutcomeCells[index].humanFirst, true);
    const botFirstCell = withRuneFloor(fullOutcomeCells[index].botFirst, false);
    const humanFirst = reweight(humanFirstCell, pool).weighted;
    const botFirst = reweight(botFirstCell, pool).weighted;
    if (humanFirst < 0.50 || botFirst < 0.50) {
      problems.push(`${group.id} becomes bot-favoured under a reachable permanent outcome pool: `
        + `${(humanFirst * 100).toFixed(1)}% / ${(botFirst * 100).toFixed(1)}% human share`);
    }
  }
}
if (leagueCurve[1].humanFirst.weighted - leagueCurve[2].humanFirst.weighted < 0.03) {
  problems.push('BONE and IVORY are less than 3pp apart — the second promotion must be perceptible');
}

const stonePoolRandomFirst = rankedBotPool(rankedBot(0), STONE_POOL, RANDOM, true, 600, 7900);
const stonePoolRandomSecond = rankedBotPool(rankedBot(0), STONE_POOL, RANDOM, false, 600, 7900);
if (stonePoolRandomFirst.weighted < 0.60 || stonePoolRandomSecond.weighted < 0.50) {
  problems.push(`STONE punishes learning by play: random-human outcome share `
    + `${(stonePoolRandomFirst.weighted * 100).toFixed(1)}% / `
    + `${(stonePoolRandomSecond.weighted * 100).toFixed(1)}% by seat`);
}

checkBotMoveContract((c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); });

console.log(JSON.stringify({
  stonePool: {
    builderHumanFirst: +(leagueCurve[0].humanFirst.weighted * 100).toFixed(1),
    builderBotFirst: +(leagueCurve[0].botFirst.weighted * 100).toFixed(1),
    randomFirst: +(stonePoolRandomFirst.weighted * 100).toFixed(1),
    randomSecond: +(stonePoolRandomSecond.weighted * 100).toFixed(1),
  },
  humanOutcomeShare: Object.fromEntries(GROUPS.map((group, index) => [group.id, {
    humanFirst: +(leagueCurve[index].humanFirst.weighted * 100).toFixed(1),
    botFirst: +(leagueCurve[index].botFirst.weighted * 100).toFixed(1),
    ...(index >= 2 ? {
      noviceRuneAggregateHumanFirst: +(reweight(
        withRuneFloor(fullOutcomeCells[index].humanFirst, true), IVORY_POOL,
      ).weighted * 100).toFixed(1),
      noviceRuneAggregateBotFirst: +(reweight(
        withRuneFloor(fullOutcomeCells[index].botFirst, false), IVORY_POOL,
      ).weighted * 100).toFixed(1),
    } : {}),
  }])),
  boneVsStone: +(boneVsStone * 100).toFixed(1),
  csAwareVsBlind: +(csAwareVsBlind * 100).toFixed(1),
  problems, errs,
}, null, 2));
