// The bot ladder, simulated. ladder.test.ts pins the per-group shape NUMBERS;
// this pins what they are FOR — a measured curve that keeps two promises
// (docs/LADDER.md §4): a newcomer who never looks across the table is
// favoured through GOLD and never drained above it; anyone who looks at the
// opponent's board is favoured everywhere; and from GOLD up every league is
// measurably harder than the one below. A future retune edits the registry
// and then has to get past this suite, which is the "measure, don't guess"
// rule in gate form.
//
// Deterministic: every draw is keyed (tests/support/policy-duel-bench.ts), so
// a cell is the same number on every machine. The bands sit under the tuned
// values, so they catch a broken retune, not simulation drift.
// Run: mise exec -- node --experimental-strip-types tests/botbench.test.ts
import { GROUPS } from '../src/core/ladder.ts';
import {
  LEAGUE_FLOORS, LEARNER_FLOOR, NEWCOMER, RANDOM, SEPARATION_MIN,
  UNFORCED_ERROR_CEILING, measureLeagueCells,
  productionPool, reweight, runeCell, type LeagueCells,
} from './support/bot-calibration.ts';
import { duel, rankedBotPool, type PoolCell, type Policy } from './support/policy-duel-bench.ts';
import { checkBotMoveContract } from './support/bot-move-contract.ts';

const problems: string[] = [];
const errs: string[] = [];
const pct = (share: number) => +(share * 100).toFixed(1);

/* A league IS its shape: the bench measures the registry object itself, so
   the apex row is always the NEON shape and never a points fallback. */
const rankedBot = (index: number): Policy => ({ shape: GROUPS[index].bot });
const STONE_POOL = productionPool('stone');
const BONE_POOL = productionPool('bone');
const IVORY_POOL = productionPool('ivory');

/* 1 · the onboarding promise. This bench used to make two mutually masking
   mistakes: it always put the bot in AI/p2, and search weights were evaluated
   from that fixed seat, so its supposed ME/p1 "pure builder" was actually
   minimizing the bot's score. A live 0–0 loss exposed the gap: the bot opened
   as ME/p1, where STONE's negative opponent weight reversed into aggression.
   Every league is therefore measured in BOTH legal seat orders below.

   2 · the first promotion must be felt: BONE stops actively sparing your
   board and beats kill-averse STONE clearly. */
const boneVsStone = duel(rankedBot(1), rankedBot(0), 600);
if (!(boneVsStone >= 0.55)) {
  problems.push(`BONE beats STONE only ${pct(boneVsStone)}% — the destroy-blind floor is not doing its job`);
}

/* 3 · what a bot KNOWS is league-independent and measured in
   tests/bot-knowledge.test.ts; here only how often it errs is calibrated. */

/* 4 · The user-facing league curve. Human outcome shares (a draw is half)
   over the real ranked wheel, in both legal seat orders, against the two
   reference players of tests/support/bot-calibration.ts. A bot opener gets the
   production safe-slip adjustment in core/bot.ts, which offsets the
   opening-seat edge without changing matchmaking. */
const GROUP_POOLS = GROUPS.map((_, index) =>
  index === 0 ? STONE_POOL : index === 1 ? BONE_POOL : IVORY_POOL);
const cells: LeagueCells[] = GROUPS.map((_, index) => measureLeagueCells(rankedBot(index), index));
const curve = cells.map((cell, index) => ({
  humanFirst: reweight(cell.newcomer.humanFirst, GROUP_POOLS[index]),
  botFirst: reweight(cell.newcomer.botFirst, GROUP_POOLS[index]),
  learnerFirst: reweight(cell.learner.humanFirst, GROUP_POOLS[index]),
  learnerSecond: reweight(cell.learner.botFirst, GROUP_POOLS[index]),
}));

/* Rune Trial adds spell decisions the mechanical cells cannot express; its
   substituted cell per league lives in bot-calibration (IVORY: a harsh
   never-casting novice; SILVER+: the measured production-path cell). */
const withRune = (index: number, cell: PoolCell, humanFirst: boolean): PoolCell => ({
  ...cell,
  modes: { ...cell.modes, rune_trial: runeCell(index, humanFirst) },
});

const targetBands = [ // human low/high, then bot-opener low/high
  [0.73, 0.85, 0.62, 0.72], [0.59, 0.65, 0.59, 0.67],
  [0.53, 0.59, 0.53, 0.60], [0.51, 0.58, 0.52, 0.59],
  [0.50, 0.54, 0.51, 0.55], [0.47, 0.51, 0.49, 0.53],
  [0.45, 0.49, 0.47, 0.51],
] as const;
/* Smaller deterministic gate cells allow target bands ±3pp; the floors stay
   strict, and ladder.test.ts pins every shipping shape number. */
const sampleTolerance = 0.03;
/* A mode may sit under its league's floor, but not by more than this: the
   aggregate hides a collapse of a 10%-weight mode behind a tenth of it. The
   widest measured spread is NEON/BOUNTY at 39.5% (2026-09-02): the apex
   search kills for a bounty it cannot see, against a newcomer who never
   kills at all. Stage 6 makes the search bounty-aware; a mode falling past
   this allowance is the collapse the check exists for. */
const MODE_DRIFT = 0.08;

/* Known-red calibration cells. The assertion runs every time; an entry names
   the release that clears it and the value measured when it was listed; a
   listed cell that CLEARS its bar fails ("remove the entry"), so the list can
   only shrink — the CORE_DEBT / SIZE_ALLOWLIST pattern. */
const CALIBRATION_DEBT = new Map<string, { measured: string; clearedBy: string }>([
]);
const knownRed: Array<{ key: string; message: string; measured: string; clearedBy: string }> = [];
const gate = (key: string, failed: boolean, message: string) => {
  const debt = CALIBRATION_DEBT.get(key);
  if (failed && !debt) problems.push(message);
  else if (!failed && debt) {
    problems.push(`${key} now clears its bar — remove its CALIBRATION_DEBT entry (${debt.clearedBy})`);
  } else if (failed && debt) knownRed.push({ key, message, ...debt });
};

for (let index = 0; index < GROUPS.length; index++) {
  const group = GROUPS[index];
  const cell = curve[index];
  const floor = LEAGUE_FLOORS[index];
  const [low, high, botFirstLow, botFirstHigh] = targetBands[index];
  const seats = `${pct(cell.humanFirst.weighted)}% / ${pct(cell.botFirst.weighted)}%`;
  if (!(cell.humanFirst.weighted >= low - sampleTolerance
    && cell.humanFirst.weighted <= high + sampleTolerance)) {
    problems.push(`${group.id} gives a human opener ${pct(cell.humanFirst.weighted)}% `
      + `outcome share — expected ${(low * 100).toFixed(0)}–${(high * 100).toFixed(0)}%`);
  }
  if (!(cell.botFirst.weighted >= botFirstLow - sampleTolerance
    && cell.botFirst.weighted <= botFirstHigh + sampleTolerance)) {
    problems.push(`${group.id} gives a human facing a bot opener ${pct(cell.botFirst.weighted)}% `
      + `outcome share — expected `
      + `${(botFirstLow * 100).toFixed(0)}–${(botFirstHigh * 100).toFixed(0)}%`);
  }
  if (cell.humanFirst.weighted < floor || cell.botFirst.weighted < floor) {
    problems.push(`${group.id} is below its ${(floor * 100).toFixed(0)}% newcomer floor: `
      + `${seats} human outcome share (human opens / bot opens)`);
  }
  for (const [name] of IVORY_POOL) {
    const humanFirst = cell.humanFirst.modes[name];
    const botFirst = cell.botFirst.modes[name];
    if (humanFirst < floor - MODE_DRIFT || botFirst < floor - MODE_DRIFT) {
      problems.push(`${group.id}/${name} drifted more than ${MODE_DRIFT * 100}pp under the league floor: `
        + `${pct(humanFirst)}% / ${pct(botFirst)}%`);
    }
  }
  if (index >= 5) {
    const previous = curve[index - 1];
    gate(`separation:${group.id}`,
      previous.humanFirst.weighted - cell.humanFirst.weighted < SEPARATION_MIN
        || previous.botFirst.weighted - cell.botFirst.weighted < SEPARATION_MIN,
      `${group.id} is not ${SEPARATION_MIN * 100}pp harder than ${GROUPS[index - 1].id} in both seats: `
        + `${seats} after ${pct(previous.humanFirst.weighted)}% / ${pct(previous.botFirst.weighted)}%`);
  } else if (index > 0 && (cell.humanFirst.weighted
      > curve[index - 1].humanFirst.weighted + 0.01
    || cell.botFirst.weighted > curve[index - 1].botFirst.weighted + 0.01)) {
    problems.push(`${group.id} became gentler than ${GROUPS[index - 1].id} in a legal seat; `
      + `both human-favoured curves must still get harder by league`);
  }
  const ceiling = UNFORCED_ERROR_CEILING;
  const unforced = `${pct(cell.humanFirst.unforced.weighted)}% / ${pct(cell.botFirst.unforced.weighted)}%`;
  gate(`unforced:${group.id}`,
    cell.humanFirst.unforced.weighted > ceiling || cell.botFirst.unforced.weighted > ceiling,
    `${group.id} declines a free upgrade on more than ${(ceiling * 100).toFixed(0)}% of placements: `
      + `${unforced} (human opens / bot opens)`);
  if (cell.learnerFirst.weighted < LEARNER_FLOOR || cell.learnerSecond.weighted < LEARNER_FLOOR) {
    problems.push(`${group.id} beats a player who merely looks at the board: `
      + `${pct(cell.learnerFirst.weighted)}% / ${pct(cell.learnerSecond.weighted)}% learner share`);
  }
  const reachablePools = index === 0 ? [STONE_POOL, BONE_POOL, IVORY_POOL]
    : [BONE_POOL, IVORY_POOL]; // IVORY clients without Trial capability reweight to BONE.
  for (const pool of reachablePools) {
    const humanFirst = reweight(withRune(index, cells[index].newcomer.humanFirst, true), pool).weighted;
    const botFirst = reweight(withRune(index, cells[index].newcomer.botFirst, false), pool).weighted;
    if (humanFirst < floor || botFirst < floor) {
      problems.push(`${group.id} falls under its floor in a reachable permanent outcome pool: `
        + `${pct(humanFirst)}% / ${pct(botFirst)}% human share`);
    }
  }
}
if (curve[1].humanFirst.weighted - curve[2].humanFirst.weighted < 0.03) {
  problems.push('BONE and IVORY are less than 3pp apart — the second promotion must be perceptible');
}

const stonePoolRandomFirst = rankedBotPool(rankedBot(0), STONE_POOL, RANDOM, true, 600, 7900);
const stonePoolRandomSecond = rankedBotPool(rankedBot(0), STONE_POOL, RANDOM, false, 600, 7900);
if (stonePoolRandomFirst.weighted < 0.60 || stonePoolRandomSecond.weighted < 0.50) {
  problems.push(`STONE punishes learning by play: random-human outcome share `
    + `${pct(stonePoolRandomFirst.weighted)}% / ${pct(stonePoolRandomSecond.weighted)}% by seat`);
}

checkBotMoveContract((c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); });

/* docs/LADDER.md §4 rows, ready to paste; ladder.test.ts holds the doc to
   the pinned baseline. */
const sight = (oppW: number) => oppW < 0 ? `**spares it** (\`oppW ${oppW}\`)`
  : oppW === 0 ? 'builds blind (`oppW 0`)'
    : oppW < 1 ? `glances (\`oppW ${oppW}\`)` : 'yes';
const ladderSection4 = GROUPS.map((group, index) => `| ${group.id.toUpperCase()} | ${group.bot.depth} `
  + `| ${group.bot.risk} | ${sight(group.bot.oppW)} `
  + `| ${+(group.bot.slip * 100).toFixed(1)} / ${+(group.bot.openerSlip * 100).toFixed(1)}% `
  + `| ${group.bot.castDemand} `
  + `| ${Number.isFinite(group.bot.freeUpgrade) ? `never declines ${group.bot.freeUpgrade}` : 'any column'} `
  + `| **${pct(curve[index].humanFirst.weighted)}%** | **${pct(curve[index].botFirst.weighted)}%** |`);

console.log(JSON.stringify({
  stonePool: {
    builderHumanFirst: pct(curve[0].humanFirst.weighted),
    builderBotFirst: pct(curve[0].botFirst.weighted),
    randomFirst: pct(stonePoolRandomFirst.weighted),
    randomSecond: pct(stonePoolRandomSecond.weighted),
  },
  humanOutcomeShare: Object.fromEntries(GROUPS.map((group, index) => [group.id, {
    humanFirst: pct(curve[index].humanFirst.weighted),
    botFirst: pct(curve[index].botFirst.weighted),
    learnerFirst: pct(curve[index].learnerFirst.weighted),
    learnerSecond: pct(curve[index].learnerSecond.weighted),
    unforcedHumanFirst: pct(curve[index].humanFirst.unforced.weighted),
    unforcedBotFirst: pct(curve[index].botFirst.unforced.weighted),
    modesHumanFirst: Object.fromEntries(Object.entries(cells[index].newcomer.humanFirst.modes)
      .map(([name, share]) => [name, pct(share)])),
    ...(index >= 2 ? {
      runeAggregateHumanFirst: pct(reweight(
        withRune(index, cells[index].newcomer.humanFirst, true), IVORY_POOL,
      ).weighted),
      runeAggregateBotFirst: pct(reweight(
        withRune(index, cells[index].newcomer.botFirst, false), IVORY_POOL,
      ).weighted),
    } : {}),
  }])),
  boneVsStone: pct(boneVsStone),
  knownRed,
  ladderSection4,
  problems, errs,
}, null, 2));
