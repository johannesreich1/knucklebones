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
import {
  AI, ME, emptyBoard, legalCols, applyMove, totalOf, isOver,
  CLASSIC, COLSHIELD, BOUNTY, LIMITED,
  type Mode, type GameState, type Player,
} from '../src/core/rules.ts';
import { searchRoot } from '../src/core/ai.ts';
import { makeBag } from '../src/core/dice.ts';
import { GROUPS, botShapeAt, type BotShape } from '../src/core/ladder.ts';
import { botMove } from '../src/core/bot.ts';
import {
  ALL_RANKED_CAPABILITIES, rankedOutcomePool, type RankedPoolTier,
} from '../src/core/ranked-outcomes.ts';

const problems: string[] = [];
const errs: string[] = [];

/* mulberry32, NOT a bare LCG: MINSTD's lattice swung near-deterministic
   policy duels by ±7pp run to run (the colshield decomposition, 2026-08-21
   — 60.6% one stream, 46.0% the next, far beyond sampling error). These
   thresholds may not depend on which stream position a duel starts at. */
const seeded = (a: number) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Math.random = seeded(20260820);

interface Policy extends Partial<BotShape> { random?: boolean; mode?: Mode; botRating?: number }
const rnd = (n: number, random: () => number = Math.random) => Math.floor(random() * n);

function pick(p: Policy, st: ReturnType<typeof emptyBoard>[], who: 0 | 1, die: number,
              random: () => number = Math.random): number {
  if (p.botRating !== undefined) {
    return botMove(st as GameState, who, die, p.botRating, p.mode ?? CLASSIC, random);
  }
  const legal = legalCols(st[who]);
  if (p.random || (p.slip && random() < p.slip)) return legal[rnd(legal.length, random)];
  return searchRoot(st as never, who, die, p.depth ?? 1, {
    mode: p.mode ?? CLASSIC,
    random,
    riskWeight: p.risk ?? 0,
    opponentWeight: p.oppW ?? 1,
  }).c;
}

/* seatME moves first; returns the AI seat's score for one game. world is the
   mode the GAME obeys — a policy
   may search a different one (that mismatch is what §4 measures). */
function play(seatAI: Policy, seatME: Policy, world: Mode = CLASSIC): number {
  const st = [emptyBoard(), emptyBoard()];
  let turn: 0 | 1 = ME as 1, i = 0;
  for (;;) {
    const die = 1 + rnd(6);
    applyMove(st as never, turn, pick(turn === AI ? seatAI : seatME, st, turn, die), die, world);
    i++;
    if (isOver(st[turn], null)) break;
    turn = (1 - turn) as 0 | 1;
  }
  const a = totalOf(st[AI], 0, world), m = totalOf(st[ME], 0, world);
  return a > m ? 1 : a < m ? 0 : 0.5;
}

/* seats alternate so the first-move edge cancels; share for a */
const duel = (a: Policy, b: Policy, n: number, world: Mode = CLASSIC) => {
  let w = 0;
  for (let g = 0; g < n; g++) w += g % 2 ? 1 - play(b, a, world) : play(a, b, world);
  return w / n;
};

const RANDOM: Policy = { random: true };
const rankedBot = (index: number): Policy => ({ botRating: GROUPS[index].floor });

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

type WeightedMode = readonly [name: string, mode: Mode, weight: number];

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

function policyGame(bot: Policy, human: Policy, humanFirst: boolean, mode: Mode,
                    gameSeed: number): number {
  const st: GameState = [emptyBoard(), emptyBoard()];
  const bounty: [number, number] = [0, 0];
  const humanIdx: Player = humanFirst ? ME : AI;
  const botIdx = (1 - humanIdx) as Player;
  const humanPolicy = { ...human, mode };
  const botPolicy: Policy = { ...bot, mode };
  /* Production dice are seeded match truth; bot slips/tie breaks are ambient
     decision randomness. Keep dice and both policies on independent keyed
     streams so changing a shape cannot quietly change the rolls it receives.
     The same gameSeed in the reverse seat uses the same dice. */
  const diceRandom = seeded(gameSeed ^ 0x243F6A88);
  const humanRandom = seeded(gameSeed ^ 0x85A308D3);
  const botRandom = seeded(gameSeed ^ 0x13198A2E);
  const bag = mode === LIMITED ? makeBag(diceRandom) : null;
  let turn: Player = ME;
  for (;;) {
    const die = bag ? bag.shift()! : 1 + rnd(6, diceRandom);
    const policy = turn === humanIdx ? humanPolicy : botPolicy;
    const decisionRandom = turn === humanIdx ? humanRandom : botRandom;
    const destroyed = applyMove(st, turn, pick(policy, st, turn, die, decisionRandom), die, mode);
    if (mode === BOUNTY) bounty[turn] += destroyed;
    if (isOver(st[turn], bag ? bag.length : null)) break;
    turn = (1 - turn) as Player;
  }
  const mine = totalOf(st[humanIdx], bounty[humanIdx], mode);
  const theirs = totalOf(st[botIdx], bounty[botIdx], mode);
  return mine > theirs ? 1 : mine < theirs ? 0 : 0.5;
}

function rankedBotGame(botRating: number, human: Policy, humanFirst: boolean, mode: Mode,
                       gameSeed: number): number {
  return policyGame({ botRating }, human, humanFirst, mode, gameSeed);
}

function rankedBotPool(botRating: number, pool: readonly WeightedMode[],
                       human: Policy, humanFirst: boolean, gamesPerMode: number,
                       baseSeed: number) {
  const modes: Record<string, number> = {};
  let weighted = 0;
  for (let outcomeIndex = 0; outcomeIndex < pool.length; outcomeIndex++) {
    const [name, mode, weight] = pool[outcomeIndex];
    let outcome = 0;
    for (let game = 0; game < gamesPerMode; game++) {
      const gameSeed = (baseSeed
        + Math.imul(outcomeIndex + 1, 0x9E3779B1)
        + Math.imul(game + 1, 0x6D2B79F5)) | 0;
      outcome += rankedBotGame(botRating, human, humanFirst, mode, gameSeed);
    }
    const rate = outcome / gamesPerMode;
    modes[name] = rate;
    weighted += rate * weight;
  }
  return { modes, weighted };
}

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
    humanFirst: rankedBotPool(group.floor, IVORY_POOL, NEWCOMER, true, games, 7200),
    botFirst: rankedBotPool(group.floor, IVORY_POOL, NEWCOMER, false, games, 7200),
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

const stonePoolRandomFirst = rankedBotPool(GROUPS[0].floor, STONE_POOL, RANDOM, true, 600, 7900);
const stonePoolRandomSecond = rankedBotPool(GROUPS[0].floor, STONE_POOL, RANDOM, false, 600, 7900);
if (stonePoolRandomFirst.weighted < 0.60 || stonePoolRandomSecond.weighted < 0.50) {
  problems.push(`STONE punishes learning by play: random-human outcome share `
    + `${(stonePoolRandomFirst.weighted * 100).toFixed(1)}% / `
    + `${(stonePoolRandomSecond.weighted * 100).toFixed(1)}% by seat`);
}

/* ---- core/bot botMove(): the ONE implementation both Edge Functions ask ----
   Extracted from pvp-move 2026-08-22 so pvp-join can play a bot's OPENING move
   (a bot can be seated first now that the seat handicap applies to bots too).
   Equivalence to the block it replaced was proven off-gate at 113,400 calls
   across all 7 modes and all 7 groups, 0 differences; what is pinned HERE is
   the contract that keeps it safe to call from two places. */
{
  const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
  const seeded = (a: number) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const st0: GameState = [emptyBoard(), emptyBoard()];
  // an OPENING move on an empty board is the case pvp-join newly depends on
  for (const g of GROUPS) {
    const c = botMove(st0, ME, 4, g.floor + 10, CLASSIC, seeded(7));
    check(c >= 0 && c < 3, 'botMove must open with a legal column: ' + g.id, c);
  }
  // deterministic given the SAME stream — replay and the gate both need this.
  const mid: GameState = [[[5, 5], [2], []], [[4], [6, 6], [1]]];
  for (const mode of [CLASSIC, COLSHIELD] as Mode[]) {
    const a = botMove(mid, AI, 4, 2020, mode, seeded(99));
    const b = botMove(mid, AI, 4, 2020, mode, seeded(99));
    check(a === b, 'botMove must be deterministic on one seeded stream', { mode, a, b });
  }
  // STONE's negative opponent weight is a promise across BOTH branches and
  // BOTH seats. A random slip may build badly; it may not become a perfect
  // attack when a score-preserving column exists. The same safe-slip rule is
  // the explicit handicap for any bot that opens as ME/p1.
  const draws = (...values: number[]) => {
    let index = 0;
    return () => values[index++] ?? 0;
  };
  const botAsAI: GameState = [[[], [], []], [[6, 6], [], []]];
  const botAsME: GameState = [[[6, 6], [], []], [[], [], []]];
  const sparedFromAI = botMove(botAsAI, AI, 6, 0, CLASSIC, draws(0, 0));
  const sparedFromME = botMove(botAsME, ME, 6, 0, CLASSIC, draws(0, 0));
  check(sparedFromAI !== 0 && sparedFromME !== 0 && sparedFromAI === sparedFromME,
    'STONE random slip attacked a double six or changed meaning with its seat',
    { sparedFromAI, sparedFromME });
  const searchedFromAI = botMove(botAsAI, AI, 6, 0, CLASSIC, draws(0.99, 0.5, 0.5, 0.5));
  const searchedFromME = botMove(botAsME, ME, 6, 0, CLASSIC, draws(0.99, 0.5, 0.5, 0.5));
  check(searchedFromAI === 1 && searchedFromME === 1,
    'STONE search reversed its negative opponent weight when the bot became p1/ME',
    { searchedFromAI, searchedFromME });
  const boneAttack = botMove(botAsAI, AI, 6, GROUPS[1].floor, CLASSIC, draws(0, 0));
  check(boneAttack === 0,
    'the bot-opener handicap leaked into a promoted bot seated second', boneAttack);
  const boneOpenerSpared = botMove(botAsME, ME, 6, GROUPS[1].floor, CLASSIC, draws(0, 0));
  check(boneOpenerSpared !== 0,
    'a promoted bot opener turned its handicap slip into a double-six attack', boneOpenerSpared);
  // it must never answer with a column it cannot play
  const nearlyFull: GameState = [[[1, 2, 3], [1, 2, 3], [4]], [[], [], []]];
  for (let i = 0; i < 60; i++) {
    const c = botMove(nearlyFull, AI, 1 + (i % 6), GROUPS[i % GROUPS.length].floor + 10, CLASSIC, seeded(i));
    check(legalCols(nearlyFull[AI]).includes(c), 'botMove returned an illegal column', { i, c });
  }
  // a full board has nothing to answer with, and says so rather than guessing
  const full: GameState = [[[1, 2, 3], [1, 2, 3], [1, 2, 3]], [[], [], []]];
  check(botMove(full, AI, 4, 0, CLASSIC, seeded(1)) === -1, 'a bot with no legal column must return -1');
  // Search options are per call: a ranked bot cannot change how the next
  // offline search in the same process plays.
  const independent = () => searchRoot(mid, AI, 4, 2, {
    mode: CLASSIC, random: seeded(515), riskWeight: 0.9, opponentWeight: 1,
  }).c;
  const before = independent();
  botMove(mid, AI, 4, 0, CLASSIC, seeded(3));          // STONE: risk 0, oppW -0.5
  const after = independent();
  check(before === after, 'botMove leaked configuration into an independent search', { before, after });
  check(botShapeAt(0).oppW === -0.5, 'STONE is still the kill-averse shape botMove borrows', botShapeAt(0));
}

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
