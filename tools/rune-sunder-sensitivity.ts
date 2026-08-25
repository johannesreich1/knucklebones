// Targeted SUNDER placement-coordination sensitivity measurement.
//
// Frozen rune-matchups v1 continues to own the game, role, supply, and seed
// semantics. This separately versioned treatment mirrors production Normal:
// machineCastPlan previews SUNDER with its registry-projected root charm,
// reuses that placement 95% of the time, and makes a plain independent search
// after the named 5% coordination slip.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AI, ME, BOUNTY, CLASSIC, COLSHIELD,
  applyMove, boardTotalMode, cloneCharm, cloneSt, legalCols, openStrikes,
  type CharmSt, type GameState, type Mode, type Player,
} from '../src/core/rules.ts';
import { searchRoot } from '../src/core/ai.ts';
import { randStream } from '../src/core/dice.ts';
import { MODES, type ModeSpec } from '../src/core/modes.ts';
import {
  SPELLS, machineCastPlan, type CastCtx, type SpellSpec,
} from '../src/core/spells.ts';
import { NORMAL_CHARM_COORDINATION_SLIP_RATE } from '../src/flow/spell-ai.ts';
import {
  SIMULATOR_VERSION, deriveCellSeed, deriveGameSeed, playMatchupGame,
  type CastRule, type CellPlan, type GameResult, type TerminalReason,
} from './rune-matchups.ts';

export const SUNDER_SENSITIVITY_SCHEMA_VERSION = 1;
export const SUNDER_SENSITIVITY_VERSION = 1;
export const FROZEN_MATCHUP_SHA256 = 'a875c056c6f98071b679f184e0672e80438965148ae2bd76796b1acf42e90acf';
export const PRODUCTION_POLICY_SHA256: Record<string, string> = {
  'src/core/spell-policy.ts': '821879f3566ea6b86aa79fe7fc6b3c76f6491d4c1a1a7d9339035a234d8de427',
  'src/core/spells.ts': '3588a479471954b3a0c918dca3dd029195ff2f8c2d744d7e2bb875128ef057ea',
  'src/core/spell-types.ts': 'b56906dd5fc6c9ad56aaa7b8329a0365cc23c80f6d44814d04ebce9165ab35d6',
  'src/core/ai.ts': '2de44498b9acfb6fadf14dc12accc56f423df074271c7d97708ed755685a5c26',
  'src/core/rules.ts': 'af9ae96cbbede7e5bc6c8f7e766f6738ea430280a1cadd43c88273647e7bba59',
  'src/flow/spell-ai.ts': 'de01f52854a54677d29d7ea710b7e2aafaa7a1e12f213c886cc518e56183b1be',
  'src/flow/game-ai.ts': '102b4bdad6eca6457c864cf6314d8deb249a8c0485d9d78cd5942bc5529f1cdf',
  'src/flow/game.ts': '082a3ac1c83c3d4fb9ebbda1b02b90e1c6a515d1af20ea5d317a2cdce41c16bc',
};
export const DEFAULT_SEEDS = [
  '20260824-a', '20260824-b', '20260824-c', '20260824-d',
] as const;

const DEPTH = 2;
const RISK_WEIGHT = 0.9;
const OPPONENT_WEIGHT = 1;
const DEFAULT_DEMAND = 16;
const SUNDER_ID = 'sunder';
const FATE_ID = 'fate';
const WARD_ID = 'ward';
type ScopeModeId = 'classic' | 'bounty' | 'colshield';

export interface SunderSensitivityPlan extends CellPlan {
  modeId: ScopeModeId;
}

export interface SunderCoordinationCounts {
  coordinatedPreviews: number;
  slipChecks: number;
  slips: number;
  coordinatedPlacementsReused: number;
  coordinatedVsBlindComparisons: number;
  coordinatedVsBlindDifferences: number;
  slippedFinalVsPreviewDifferences: number;
  castAttributableComparisons: number;
  incrementalKillsSum: number;
  incrementalKillsSquaredSum: number;
  incrementalBountySum: number;
  incrementalOpponentScoreRemovedSum: number;
  zeroIncrementalKillCasts: number;
  zeroMarginalCasts: number;
  liveEnemyWardCasts: number;
  liveEnemyWardsSum: number;
  liveWardValuationComparisons: number;
  liveWardValuationPlacementDifferences: number;
  plannedWardAbsorbedStrikes: number;
  plannedWardAbsorbedDice: number;
  actualWardAbsorbedStrikes: number;
  actualWardAbsorbedDice: number;
  placementTransitionHistogram: Record<string, number>;
  incrementalKillsHistogram: Record<string, number>;
}

export interface SunderGameResult {
  sourceGameSeed: string;
  game: GameResult;
  coordination: [SunderCoordinationCounts, SunderCoordinationCounts];
}

export interface SunderRoleAggregate extends SunderCoordinationCounts {
  casts: number;
  gamesWithCast: number;
  legalCastOpportunities: number;
  unusedCharges: number;
  immediateSwingCount: number;
  immediateSwingSum: number;
  immediateSwingSquaredSum: number;
}

export interface SunderCellResult extends SunderSensitivityPlan {
  sourceCellSeed: string;
  treatmentCellId: string;
  games: number;
  openerWins: number;
  draws: number;
  replyWins: number;
  outcomePoints2: number;
  openerScoreSum: number;
  openerScoreSquaredSum: number;
  replyScoreSum: number;
  replyScoreSquaredSum: number;
  marginSum: number;
  marginSquaredSum: number;
  placementsSum: number;
  placementsSquaredSum: number;
  placementsMin: number;
  placementsMax: number;
  kills: [number, number];
  bounty: [number, number];
  terminalReasons: Record<TerminalReason, number>;
  roles: [SunderRoleAggregate, SunderRoleAggregate];
  internalOpener: {
    ai: { games: number; wins: number; draws: number; losses: number };
    me: { games: number; wins: number; draws: number; losses: number };
  };
}

export interface SunderSensitivityOptions {
  games?: number;
  seeds?: string[];
  provenance?: Record<string, unknown>;
  onCell?: (cell: SunderCellResult, completed: number, total: number) => void;
}

export interface SunderSensitivityReport {
  schemaVersion: number;
  instrumentVersion: number;
  sourceSimulatorVersion: number;
  provenance: Record<string, unknown>;
  request: {
    gamesPerCell: number;
    seeds: string[];
    modeIds: ScopeModeId[];
    castRules: CastRule[];
  };
  policy: Record<string, unknown>;
  sourceRelationship: Record<string, unknown>;
  seedDerivation: string;
  fieldSemantics: Record<string, unknown>;
  roster: Array<{ id: string; uses: number }>;
  plan: {
    mechanicalConfigurations: number;
    oneCastConfigurations: number;
    chainConfigurations: number;
    classicConfigurations: number;
    bountyConfigurations: number;
    colshieldConfigurations: number;
    cellRecords: number;
    replicationCount: number;
    totalGames: number;
  };
  cells: SunderCellResult[];
  baselines?: BaselineReference[];
  comparisons?: CellComparison[];
  targetedSummary?: TargetedSummary;
}

export interface SunderPlacementDecision {
  (
    st: GameState,
    who: Player,
    die: number,
    mode: Mode,
    random: () => number,
    rootCharm?: CharmSt,
  ): number;
}

export interface SunderGameOverrides {
  openerPlayer?: Player;
  initialState?: GameState;
  endlessDraw?: () => number;
  maxPlacements?: number;
  searchRandom?: [() => number, () => number];
  placementDecision?: SunderPlacementDecision;
}

const emptyCoordination = (): SunderCoordinationCounts => ({
  coordinatedPreviews: 0,
  slipChecks: 0,
  slips: 0,
  coordinatedPlacementsReused: 0,
  coordinatedVsBlindComparisons: 0,
  coordinatedVsBlindDifferences: 0,
  slippedFinalVsPreviewDifferences: 0,
  castAttributableComparisons: 0,
  incrementalKillsSum: 0,
  incrementalKillsSquaredSum: 0,
  incrementalBountySum: 0,
  incrementalOpponentScoreRemovedSum: 0,
  zeroIncrementalKillCasts: 0,
  zeroMarginalCasts: 0,
  liveEnemyWardCasts: 0,
  liveEnemyWardsSum: 0,
  liveWardValuationComparisons: 0,
  liveWardValuationPlacementDifferences: 0,
  plannedWardAbsorbedStrikes: 0,
  plannedWardAbsorbedDice: 0,
  actualWardAbsorbedStrikes: 0,
  actualWardAbsorbedDice: 0,
  placementTransitionHistogram: {},
  incrementalKillsHistogram: {},
});

const emptyRole = (): SunderRoleAggregate => ({
  ...emptyCoordination(),
  casts: 0,
  gamesWithCast: 0,
  legalCastOpportunities: 0,
  unusedCharges: 0,
  immediateSwingCount: 0,
  immediateSwingSum: 0,
  immediateSwingSquaredSum: 0,
});

const emptyTerminalReasons = (): Record<TerminalReason, number> => ({
  'board-full': 0,
  'supply-empty': 0,
  'board-full-and-supply-empty': 0,
  'cast-full': 0,
  'cast-full-and-supply-empty': 0,
});

const rune = (id: string): SpellSpec => {
  const found = SPELLS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Sensitivity plan references unknown rune: ${id}`);
  return found;
};

const modeSpec = (id: ScopeModeId): ModeSpec => {
  const found = MODES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Sensitivity plan references unknown mode: ${id}`);
  return found;
};

const roleIndex = (who: Player, opener: Player): 0 | 1 => who === opener ? 0 : 1;

function uniqueSeeds(seeds: string[]): void {
  if (!seeds.length) throw new Error('At least one seed is required.');
  if (seeds.some((seed) => !seed.length)) throw new Error('Seeds must not be empty.');
  if (new Set(seeds).size !== seeds.length) {
    throw new Error('Duplicate seeds are not independent replications.');
  }
}

function mechanicalPlan(): Array<Pick<SunderSensitivityPlan,
  'castRule' | 'modeId' | 'openerRune' | 'replyRune'>> {
  const out: Array<Pick<SunderSensitivityPlan,
    'castRule' | 'modeId' | 'openerRune' | 'replyRune'>> = [];
  for (const modeId of ['classic', 'bounty'] as const) {
    for (const opener of SPELLS) {
      for (const reply of SPELLS) {
        if (opener.id === SUNDER_ID || reply.id === SUNDER_ID) {
          out.push({ castRule: 'one', modeId, openerRune: opener.id, replyRune: reply.id });
        }
      }
    }
    out.push(
      { castRule: 'chain', modeId, openerRune: FATE_ID, replyRune: SUNDER_ID },
      { castRule: 'chain', modeId, openerRune: SUNDER_ID, replyRune: FATE_ID },
    );
  }
  out.push(
    { castRule: 'one', modeId: 'colshield', openerRune: SUNDER_ID, replyRune: WARD_ID },
    { castRule: 'one', modeId: 'colshield', openerRune: WARD_ID, replyRune: SUNDER_ID },
  );
  return out;
}

const TARGET_MECHANICAL = mechanicalPlan();
const TARGET_KEYS = new Set(TARGET_MECHANICAL.map((cell) =>
  `${cell.castRule}:${cell.modeId}:${cell.openerRune}:${cell.replyRune}`));

/* Per replication: Classic 11 one + 2 FATE-chain, Bounty the same, and the
   two directed SUNDER/WARD one-cast cells in COLUMN SHIELD. */
export function planSunderSensitivity(
  seeds: string[] = [...DEFAULT_SEEDS],
): SunderSensitivityPlan[] {
  uniqueSeeds(seeds);
  const out: SunderSensitivityPlan[] = [];
  for (let replication = 0; replication < seeds.length; replication++) {
    for (const config of TARGET_MECHANICAL) {
      out.push({ baseSeed: seeds[replication], replication, ...config });
    }
  }
  return out;
}

function normalPlacement(
  st: GameState,
  who: Player,
  die: number,
  mode: Mode,
  random: () => number,
  rootCharm?: CharmSt,
): number {
  return searchRoot(st, who, die, DEPTH, {
    mode, random, riskWeight: RISK_WEIGHT, opponentWeight: OPPONENT_WEIGHT, rootCharm,
  }).c;
}

function replaySamples(samples: readonly number[], where: string): {
  random: () => number;
} {
  let cursor = 0;
  const suffix = randStream(`${where}#diagnostic-suffix`);
  return {
    /* Search trees can differ because SUNDER changes how many opponent dice
       survive into deeper plies. Share the exact captured production prefix;
       if a counterfactual tree is longer, extend it from a named diagnostic
       domain without perturbing the live treatment stream. */
    random: () => cursor < samples.length ? samples[cursor++] : suffix(),
  };
}

function diagnosticPlacement(
  placement: SunderPlacementDecision,
  samples: readonly number[],
  where: string,
  st: GameState,
  who: Player,
  die: number,
  mode: Mode,
  rootCharm?: CharmSt,
): number {
  const replay = replaySamples(samples, where);
  const column = placement(st, who, die, mode, replay.random, rootCharm);
  return column;
}

function increment(histogram: Record<string, number>, key: string): void {
  histogram[key] = (histogram[key] ?? 0) + 1;
}

function wardCount(charm: CharmSt, who: Player): number {
  const foe = (1 - who) as Player;
  return charm.wards[foe].reduce((sum, count) => sum + count, 0);
}

function sameNumbers(first: readonly number[], second: readonly number[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function sameState(first: GameState, second: GameState): boolean {
  for (let player = 0; player < 2; player++) {
    for (let column = 0; column < first[player].length; column++) {
      if (!sameNumbers(first[player][column], second[player][column])) return false;
    }
  }
  return true;
}

function sameCharm(first: CharmSt, second: CharmSt): boolean {
  return sameNumbers(first.wards[AI], second.wards[AI])
    && sameNumbers(first.wards[ME], second.wards[ME])
    && first.sunder[AI] === second.sunder[AI]
    && first.sunder[ME] === second.sunder[ME];
}

function absorbedByPlannedStrike(
  st: GameState,
  who: Player,
  column: number,
  die: number,
  mode: Mode,
  charm: CharmSt,
): { strikes: number; dice: number } {
  const outcomes = openStrikes(cloneSt(st), who, column, die, mode, cloneCharm(charm));
  const warded = outcomes.filter((outcome) => outcome.warded);
  return {
    strikes: warded.length,
    dice: warded.reduce((sum, outcome) => sum + outcome.victims.length, 0),
  };
}

interface PendingSunder {
  preview: number;
  blind: number;
  slip: boolean;
  die: number;
  charm: CharmSt;
}

/* One production-Normal treatment game. Search jitter, then the 5% slip
   sample, then any slipped final search all consume the same role stream in
   production order. Supply/game seeds remain exactly frozen v1. */
export function playSunderSensitivityGame(
  cell: SunderSensitivityPlan,
  gameIndex: number,
  overrides: SunderGameOverrides = {},
): SunderGameResult {
  if (!Number.isInteger(gameIndex) || gameIndex < 0) throw new Error('Game index must be a non-negative integer.');
  const allowed = TARGET_KEYS.has(`${cell.castRule}:${cell.modeId}:${cell.openerRune}:${cell.replyRune}`);
  if (!allowed) throw new Error('Cell is outside the targeted SUNDER sensitivity scope.');
  const openerPlayer = overrides.openerPlayer ?? (gameIndex % 2 ? ME : AI) as Player;
  const sourceGameSeed = deriveGameSeed(cell, gameIndex);
  const baseStreams = overrides.searchRandom ?? [
    randStream(sourceGameSeed + '#search-opener'),
    randStream(sourceGameSeed + '#search-reply'),
  ];
  const captures: [number[] | null, number[] | null] = [null, null];
  const searchRandom: [() => number, () => number] = [0, 1].map((index) => () => {
    const sample = baseStreams[index as 0 | 1]();
    captures[index as 0 | 1]?.push(sample);
    return sample;
  }) as [() => number, () => number];
  const placement = overrides.placementDecision ?? normalPlacement;
  const coordination: [SunderCoordinationCounts, SunderCoordinationCounts] = [
    emptyCoordination(), emptyCoordination(),
  ];
  const pending: [PendingSunder | null, PendingSunder | null] = [null, null];

  const decideCast = (
    st: GameState, who: Player, spell: SpellSpec, ctx: CastCtx, demand: number,
  ): number | null => {
    const index = roleIndex(who, openerPlayer);
    if (captures[index]) throw new Error(`Nested placement capture: ${sourceGameSeed}`);
    const samples: number[] = [];
    captures[index] = samples;
    const plan = (() => {
      try {
        return machineCastPlan(st, who, spell, ctx, demand, (rootCharm) =>
          placement(st, who, ctx.die, ctx.mode, searchRandom[index], rootCharm));
      } finally {
        captures[index] = null;
      }
    })();
    if (spell.id !== SUNDER_ID || plan.target === null || !plan.rootCharm || plan.placement === null) {
      return plan.target;
    }
    if (!plan.rootCharm.sunder[who]) throw new Error(`SUNDER root charm is not armed: ${sourceGameSeed}`);
    for (let player = 0 as 0 | 1; player < 2; player = (player + 1) as 0 | 1) {
      if (!sameNumbers(plan.rootCharm.wards[player], ctx.charm.wards[player])) {
        throw new Error(`SUNDER root charm dropped a live WARD: ${sourceGameSeed}`);
      }
    }
    const counts = coordination[index];
    counts.coordinatedPreviews++;
    counts.coordinatedVsBlindComparisons++;
    const blind = diagnosticPlacement(
      placement, samples, `${sourceGameSeed}:blind`, st, who, ctx.die, ctx.mode,
    );
    if (blind !== plan.placement) counts.coordinatedVsBlindDifferences++;
    increment(counts.placementTransitionHistogram, `${blind}->${plan.placement}`);

    const enemyWards = wardCount(plan.rootCharm, who);
    if (enemyWards) {
      counts.liveEnemyWardCasts++;
      counts.liveEnemyWardsSum += enemyWards;
      counts.liveWardValuationComparisons++;
      const noWardCharm = cloneCharm(plan.rootCharm);
      noWardCharm.wards[(1 - who) as Player].fill(0);
      const noWardPlacement = diagnosticPlacement(
        placement, samples, `${sourceGameSeed}:no-live-ward`,
        st, who, ctx.die, ctx.mode, noWardCharm,
      );
      if (noWardPlacement !== plan.placement) counts.liveWardValuationPlacementDifferences++;
    }
    const plannedAbsorption = absorbedByPlannedStrike(
      st, who, plan.placement, ctx.die, ctx.mode, plan.rootCharm,
    );
    counts.plannedWardAbsorbedStrikes += plannedAbsorption.strikes;
    counts.plannedWardAbsorbedDice += plannedAbsorption.dice;

    counts.slipChecks++;
    const slip = searchRandom[index]() < NORMAL_CHARM_COORDINATION_SLIP_RATE;
    if (slip) counts.slips++;
    else counts.coordinatedPlacementsReused++;
    if (pending[who]) throw new Error(`Unconsumed SUNDER plan before placement: ${sourceGameSeed}`);
    pending[who] = {
      preview: plan.placement,
      blind,
      slip,
      die: ctx.die,
      charm: ctx.charm,
    };
    return plan.target;
  };

  const choosePlacement = (
    st: GameState, who: Player, die: number, mode: Mode, random: () => number,
  ): number => {
    const held = pending[who];
    if (!held) return placement(st, who, die, mode, random);
    const index = roleIndex(who, openerPlayer);
    const counts = coordination[index];
    const column = held.slip ? placement(st, who, die, mode, random) : held.preview;
    if (held.slip && column !== held.preview) counts.slippedFinalVsPreviewDifferences++;
    if (die !== held.die) throw new Error(`SUNDER hand changed between cast and placement: ${sourceGameSeed}`);

    const wardAbsorption = absorbedByPlannedStrike(st, who, column, die, mode, held.charm);
    counts.actualWardAbsorbedStrikes += wardAbsorption.strikes;
    counts.actualWardAbsorbedDice += wardAbsorption.dice;

    const wideState = cloneSt(st);
    const wideCharm = cloneCharm(held.charm);
    const wideKills = applyMove(wideState, who, column, die, mode, wideCharm);
    const plainState = cloneSt(st);
    const plainCharm = cloneCharm(held.charm);
    plainCharm.sunder[who] = false;
    const plainKills = applyMove(plainState, who, column, die, mode, plainCharm);
    const foe = (1 - who) as Player;
    const incrementalKills = wideKills - plainKills;
    const incrementalScoreRemoved = boardTotalMode(plainState[foe], mode)
      - boardTotalMode(wideState[foe], mode);
    counts.castAttributableComparisons++;
    if (incrementalKills < 0 || incrementalScoreRemoved < 0) {
      throw new Error(`SUNDER counterfactual regressed versus the same plain move: ${sourceGameSeed}`);
    }
    counts.incrementalKillsSum += incrementalKills;
    counts.incrementalKillsSquaredSum += incrementalKills ** 2;
    counts.incrementalBountySum += mode === BOUNTY ? incrementalKills : 0;
    counts.incrementalOpponentScoreRemovedSum += incrementalScoreRemoved;
    increment(counts.incrementalKillsHistogram, String(incrementalKills));
    if (incrementalKills === 0) counts.zeroIncrementalKillCasts++;
    if (sameState(wideState, plainState) && sameCharm(wideCharm, plainCharm)
      && wideKills === plainKills) counts.zeroMarginalCasts++;
    pending[who] = null;
    return column;
  };

  const spec = modeSpec(cell.modeId);
  const game = playMatchupGame({
    gameSeed: sourceGameSeed,
    mode: spec.mode,
    openerRune: rune(cell.openerRune),
    replyRune: rune(cell.replyRune),
    castRule: cell.castRule,
    openerPlayer,
    depth: DEPTH,
    riskWeight: RISK_WEIGHT,
    opponentWeight: OPPONENT_WEIGHT,
    searchRandom,
    decideCast,
    choosePlacement,
    initialState: overrides.initialState,
    endlessDraw: overrides.endlessDraw,
    maxPlacements: overrides.maxPlacements,
  });
  if (pending[AI] || pending[ME] || captures[0] || captures[1]) {
    throw new Error(`Terminal game left an unfinished coordination decision: ${sourceGameSeed}`);
  }
  return { sourceGameSeed, game, coordination };
}

function addHistogram(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, count] of Object.entries(source)) target[key] = (target[key] ?? 0) + count;
}

function addCoordination(target: SunderCoordinationCounts, source: SunderCoordinationCounts): void {
  target.coordinatedPreviews += source.coordinatedPreviews;
  target.slipChecks += source.slipChecks;
  target.slips += source.slips;
  target.coordinatedPlacementsReused += source.coordinatedPlacementsReused;
  target.coordinatedVsBlindComparisons += source.coordinatedVsBlindComparisons;
  target.coordinatedVsBlindDifferences += source.coordinatedVsBlindDifferences;
  target.slippedFinalVsPreviewDifferences += source.slippedFinalVsPreviewDifferences;
  target.castAttributableComparisons += source.castAttributableComparisons;
  target.incrementalKillsSum += source.incrementalKillsSum;
  target.incrementalKillsSquaredSum += source.incrementalKillsSquaredSum;
  target.incrementalBountySum += source.incrementalBountySum;
  target.incrementalOpponentScoreRemovedSum += source.incrementalOpponentScoreRemovedSum;
  target.zeroIncrementalKillCasts += source.zeroIncrementalKillCasts;
  target.zeroMarginalCasts += source.zeroMarginalCasts;
  target.liveEnemyWardCasts += source.liveEnemyWardCasts;
  target.liveEnemyWardsSum += source.liveEnemyWardsSum;
  target.liveWardValuationComparisons += source.liveWardValuationComparisons;
  target.liveWardValuationPlacementDifferences += source.liveWardValuationPlacementDifferences;
  target.plannedWardAbsorbedStrikes += source.plannedWardAbsorbedStrikes;
  target.plannedWardAbsorbedDice += source.plannedWardAbsorbedDice;
  target.actualWardAbsorbedStrikes += source.actualWardAbsorbedStrikes;
  target.actualWardAbsorbedDice += source.actualWardAbsorbedDice;
  addHistogram(target.placementTransitionHistogram, source.placementTransitionHistogram);
  addHistogram(target.incrementalKillsHistogram, source.incrementalKillsHistogram);
}

export function runSunderSensitivityCell(
  cell: SunderSensitivityPlan,
  games: number,
): SunderCellResult {
  if (!Number.isInteger(games) || games < 1) throw new Error('Games per cell must be a positive integer.');
  const roles: [SunderRoleAggregate, SunderRoleAggregate] = [emptyRole(), emptyRole()];
  const internalOpener = {
    ai: { games: 0, wins: 0, draws: 0, losses: 0 },
    me: { games: 0, wins: 0, draws: 0, losses: 0 },
  };
  const result: SunderCellResult = {
    ...cell,
    sourceCellSeed: deriveCellSeed(cell),
    treatmentCellId: `rune-sunder-sensitivity-v${SUNDER_SENSITIVITY_VERSION}#${deriveCellSeed(cell)}`,
    games,
    openerWins: 0,
    draws: 0,
    replyWins: 0,
    outcomePoints2: 0,
    openerScoreSum: 0,
    openerScoreSquaredSum: 0,
    replyScoreSum: 0,
    replyScoreSquaredSum: 0,
    marginSum: 0,
    marginSquaredSum: 0,
    placementsSum: 0,
    placementsSquaredSum: 0,
    placementsMin: Infinity,
    placementsMax: 0,
    kills: [0, 0],
    bounty: [0, 0],
    terminalReasons: emptyTerminalReasons(),
    roles,
    internalOpener,
  };
  for (let gameIndex = 0; gameIndex < games; gameIndex++) {
    const played = playSunderSensitivityGame(cell, gameIndex);
    const game = played.game;
    const seat = game.openerPlayer === AI ? internalOpener.ai : internalOpener.me;
    seat.games++;
    if (game.openerScore > game.replyScore) {
      result.openerWins++; result.outcomePoints2 += 2; seat.wins++;
    } else if (game.openerScore < game.replyScore) {
      result.replyWins++; seat.losses++;
    } else {
      result.draws++; result.outcomePoints2++; seat.draws++;
    }
    result.openerScoreSum += game.openerScore;
    result.openerScoreSquaredSum += game.openerScore ** 2;
    result.replyScoreSum += game.replyScore;
    result.replyScoreSquaredSum += game.replyScore ** 2;
    const margin = game.openerScore - game.replyScore;
    result.marginSum += margin;
    result.marginSquaredSum += margin ** 2;
    result.placementsSum += game.placements;
    result.placementsSquaredSum += game.placements ** 2;
    result.placementsMin = Math.min(result.placementsMin, game.placements);
    result.placementsMax = Math.max(result.placementsMax, game.placements);
    result.kills[0] += game.kills[0]; result.kills[1] += game.kills[1];
    result.bounty[0] += game.bounty[0]; result.bounty[1] += game.bounty[1];
    result.terminalReasons[game.terminalReason]++;
    for (let index = 0 as 0 | 1; index < 2; index = (index + 1) as 0 | 1) {
      const role = roles[index];
      const casts = game.casts[index];
      role.casts += casts.length;
      if (casts.length) role.gamesWithCast++;
      role.legalCastOpportunities += game.legalCastOpportunities[index];
      role.unusedCharges += game.chargesLeft[index];
      role.immediateSwingCount += casts.length;
      for (const cast of casts) {
        role.immediateSwingSum += cast.swing;
        role.immediateSwingSquaredSum += cast.swing ** 2;
      }
      addCoordination(role, played.coordination[index]);
    }
  }
  return result;
}

export function runSunderSensitivity(options: SunderSensitivityOptions = {}): SunderSensitivityReport {
  const games = options.games ?? 3000;
  if (!Number.isInteger(games) || games < 1) throw new Error('Games per cell must be a positive integer.');
  const seeds = options.seeds ? [...options.seeds] : [...DEFAULT_SEEDS];
  const planned = planSunderSensitivity(seeds);
  const cells: SunderCellResult[] = [];
  for (let index = 0; index < planned.length; index++) {
    const cell = runSunderSensitivityCell(planned[index], games);
    cells.push(cell);
    options.onCell?.(cell, index + 1, planned.length);
  }
  const unique = (selected: SunderSensitivityPlan[]) => new Set(selected.map((cell) =>
    `${cell.castRule}:${cell.modeId}:${cell.openerRune}:${cell.replyRune}`)).size;
  return {
    schemaVersion: SUNDER_SENSITIVITY_SCHEMA_VERSION,
    instrumentVersion: SUNDER_SENSITIVITY_VERSION,
    sourceSimulatorVersion: SIMULATOR_VERSION,
    provenance: options.provenance ?? {},
    request: {
      gamesPerCell: games,
      seeds,
      modeIds: ['classic', 'bounty', 'colshield'],
      castRules: ['one', 'chain'],
    },
    policy: {
      difficulty: 'normal',
      placement: 'searchRoot',
      depth: DEPTH,
      riskWeight: RISK_WEIGHT,
      opponentWeight: OPPONENT_WEIGHT,
      cast: 'machineCastPlan',
      defaultDemand: DEFAULT_DEMAND,
      rootCharm: 'SpellSpec.cpuRootCharm',
      normalCoordinationSlipRate: NORMAL_CHARM_COORDINATION_SLIP_RATE,
      sunderCastValuation: 'immediatePlacementGain',
      bountyBankPerKillInSunderCastValuation: 1,
      slipRule: 'sample after coordinated preview; reuse preview unless sample < rate',
      slipRandomness: 'same role search stream in production call order',
      opponentRuneAware: false,
      deeperPliesCharmAware: false,
      bountyBankAwareSearch: false,
    },
    sourceRelationship: {
      frozenGameEngine: 'tools/rune-matchups.ts simulatorVersion 1',
      frozenEmitterSha256: FROZEN_MATCHUP_SHA256,
      treatmentSeam: 'machineCastPlan rootCharm preview plus production Normal 5% slip',
      productionPolicySha256: PRODUCTION_POLICY_SHA256,
      commonGameSeeds: true,
      commonSupplyStreams: true,
      pairedBaselineCells: true,
    },
    seedDerivation: 'deriveGameSeed from frozen rune-matchups v1; domains #supply, #search-opener, #search-reply',
    fieldSemantics: {
      roleArrayOrder: ['opener', 'reply'],
      coordinatedVsBlind: 'same board/hand and captured production tie-jitter prefix; longer counterfactual trees use a named diagnostic suffix; coordinated search receives projected SUNDER charm and blind search receives no root charm',
      castAttributableIncrement: 'wide SUNDER result minus a plain result using the same actual final column, board, hand, and live WARD state',
      incrementalBounty: 'incremental kills in BOUNTY (one banked point per additional destroyed die), zero in other modes',
      zeroIncrementalKillCast: 'wide placement destroyed no more dice than the same planned plain placement',
      zeroMarginalCast: 'wide and plain results have identical boards, charm, and killed count after the same planned move',
      liveWardValuation: 'coordinated root placement compared with the same projected SUNDER charm after clearing only enemy WARD marks, using identical captured jitter',
      wardAbsorption: 'number of warded wide strike outcomes and matching dice those WARDs protected',
    },
    roster: SPELLS.map(({ id, uses }) => ({ id, uses })),
    plan: {
      mechanicalConfigurations: unique(planned),
      oneCastConfigurations: unique(planned.filter((cell) => cell.castRule === 'one')),
      chainConfigurations: unique(planned.filter((cell) => cell.castRule === 'chain')),
      classicConfigurations: unique(planned.filter((cell) => cell.modeId === 'classic')),
      bountyConfigurations: unique(planned.filter((cell) => cell.modeId === 'bounty')),
      colshieldConfigurations: unique(planned.filter((cell) => cell.modeId === 'colshield')),
      cellRecords: planned.length,
      replicationCount: seeds.length,
      totalGames: planned.length * games,
    },
    cells,
  };
}

interface OutcomeSnapshot {
  games: number;
  openerWins: number;
  draws: number;
  replyWins: number;
  outcomePoints2: number;
  openerScoreSum: number;
  replyScoreSum: number;
  kills: [number, number];
  bounty: [number, number];
  roleCasts: [number, number];
}

export interface BaselineReference {
  modeId: ScopeModeId;
  input: string;
  reportSha256: string;
  emitterSha256: string;
  expectedEmitterSha256: string;
  sourceSimulatorVersion: number;
  sourceFileSha256: Record<string, string>;
  policyValidated: true;
  pairedGameSeeds: true;
  comparedCellRecords: number;
}

export interface CellComparison extends SunderSensitivityPlan {
  sourceCellSeed: string;
  baseline: OutcomeSnapshot;
  coordinated: OutcomeSnapshot & { sunder: [SunderCoordinationSnapshot, SunderCoordinationSnapshot] };
  delta: {
    openerWins: number;
    draws: number;
    replyWins: number;
    outcomePoints2: number;
    openerOutcomeRate: number;
    openerScoreSum: number;
    replyScoreSum: number;
    kills: [number, number];
    bounty: [number, number];
    roleCasts: [number, number];
  };
}

export interface SunderCoordinationSnapshot {
  coordinatedPreviews: number;
  slipChecks: number;
  slips: number;
  coordinatedPlacementsReused: number;
  coordinatedVsBlindComparisons: number;
  coordinatedVsBlindDifferences: number;
  castAttributableComparisons: number;
  incrementalKillsSum: number;
  incrementalBountySum: number;
  zeroIncrementalKillCasts: number;
  zeroMarginalCasts: number;
  liveEnemyWardCasts: number;
  liveWardValuationPlacementDifferences: number;
  actualWardAbsorbedDice: number;
}

export interface TargetedSummary {
  scope: string;
  oneCastSunderSeatNeutral: Array<{
    modeId: ScopeModeId;
    opponentRune: string;
    baselineSunderScore: number;
    coordinatedSunderScore: number;
    delta: number;
  }>;
  fateChainSunderSeatNeutral: Array<{
    modeId: 'classic' | 'bounty';
    baselineSunderScore: number;
    coordinatedSunderScore: number;
    delta: number;
  }>;
  limitation: string;
}

export interface BaselineInput {
  input: string;
  reportSha256: string;
  report: unknown;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, where: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be an object.`);
  return value as UnknownRecord;
}

function numberField(value: UnknownRecord, key: string, where: string): number {
  const found = value[key];
  if (typeof found !== 'number' || !Number.isFinite(found)) throw new Error(`${where}.${key} must be finite.`);
  return found;
}

function stringField(value: UnknownRecord, key: string, where: string): string {
  const found = value[key];
  if (typeof found !== 'string') throw new Error(`${where}.${key} must be a string.`);
  return found;
}

function tuple2(value: unknown, where: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2
    || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new Error(`${where} must contain two finite numbers.`);
  }
  return [value[0] as number, value[1] as number];
}

function baselineKey(cell: Pick<CellPlan,
  'baseSeed' | 'castRule' | 'modeId' | 'openerRune' | 'replyRune'>): string {
  return `${cell.baseSeed}:${cell.castRule}:${cell.modeId}:${cell.openerRune}:${cell.replyRune}`;
}

interface ValidBaselineCell extends OutcomeSnapshot {
  baseSeed: string;
  castRule: CastRule;
  modeId: ScopeModeId;
  openerRune: string;
  replyRune: string;
  sourceCellSeed: string;
}

interface ValidBaseline {
  modeId: ScopeModeId;
  cells: Map<string, ValidBaselineCell>;
  emitterSha256: string;
  fileSha256: Record<string, string>;
}

function validateBaseline(gamesPerCell: number, seedsRequired: string[], input: unknown): ValidBaseline {
  const root = record(input, 'baseline');
  if (numberField(root, 'schemaVersion', 'baseline') !== 1
    || numberField(root, 'simulatorVersion', 'baseline') !== SIMULATOR_VERSION) {
    throw new Error('Baseline must be a rune-matchups schema/simulator v1 report.');
  }
  const request = record(root.request, 'baseline.request');
  if (numberField(request, 'gamesPerCell', 'baseline.request') !== gamesPerCell) {
    throw new Error('Baseline and coordinated treatment must use the same games per cell.');
  }
  const seeds = request.seeds;
  if (!Array.isArray(seeds) || !seedsRequired.every((seed) => seeds.includes(seed))) {
    throw new Error('Baseline does not contain every requested replication seed.');
  }
  const modeIds = request.modeIds;
  if (!Array.isArray(modeIds) || modeIds.length !== 1
    || !['classic', 'bounty', 'colshield'].includes(String(modeIds[0]))) {
    throw new Error('Each baseline must be one focused Classic, Bounty, or COLUMN SHIELD report.');
  }
  const modeId = modeIds[0] as ScopeModeId;
  const policy = record(root.policy, 'baseline.policy');
  if (policy.placement !== 'searchRoot' || policy.cast !== 'machineCast'
    || policy.depth !== DEPTH || policy.riskWeight !== RISK_WEIGHT
    || policy.opponentWeight !== OPPONENT_WEIGHT || policy.defaultDemand !== DEFAULT_DEMAND) {
    throw new Error(`Baseline ${modeId} policy does not match frozen Normal.`);
  }
  const demandOverrides = record(policy.demandOverrides, 'baseline.policy.demandOverrides');
  const uses = record(policy.uses, 'baseline.policy.uses');
  if (Object.keys(demandOverrides).length || SPELLS.some((spell) => uses[spell.id] !== spell.uses)) {
    throw new Error(`Baseline ${modeId} must use untuned registry demand/charges.`);
  }
  const provenance = record(root.provenance, 'baseline.provenance');
  const rawHashes = record(provenance.fileSha256, 'baseline.provenance.fileSha256');
  const fileSha256: Record<string, string> = {};
  for (const [file, hash] of Object.entries(rawHashes)) {
    if (typeof hash !== 'string') throw new Error(`Baseline source hash is not a string: ${file}`);
    fileSha256[file] = hash;
  }
  const emitterSha256 = fileSha256['tools/rune-matchups.ts'];
  if (emitterSha256 !== FROZEN_MATCHUP_SHA256) {
    throw new Error(`Baseline emitter hash is not frozen v1: ${emitterSha256}`);
  }
  if (!Array.isArray(root.cells)) throw new Error('baseline.cells must be an array.');
  const cells = new Map<string, ValidBaselineCell>();
  for (let index = 0; index < root.cells.length; index++) {
    const raw = record(root.cells[index], `baseline.cells[${index}]`);
    const castRule = stringField(raw, 'castRule', `baseline.cells[${index}]`);
    if (castRule !== 'one' && castRule !== 'chain') throw new Error(`Invalid baseline cast rule: ${castRule}`);
    const rawMode = stringField(raw, 'modeId', `baseline.cells[${index}]`);
    if (rawMode !== modeId) throw new Error(`Baseline ${modeId} contains ${rawMode} cell.`);
    const roles = raw.roles;
    if (!Array.isArray(roles) || roles.length !== 2) throw new Error(`baseline.cells[${index}].roles must have two entries.`);
    const parsed: ValidBaselineCell = {
      baseSeed: stringField(raw, 'baseSeed', `baseline.cells[${index}]`),
      castRule,
      modeId,
      openerRune: stringField(raw, 'openerRune', `baseline.cells[${index}]`),
      replyRune: stringField(raw, 'replyRune', `baseline.cells[${index}]`),
      sourceCellSeed: stringField(raw, 'cellSeed', `baseline.cells[${index}]`),
      games: numberField(raw, 'games', `baseline.cells[${index}]`),
      openerWins: numberField(raw, 'openerWins', `baseline.cells[${index}]`),
      draws: numberField(raw, 'draws', `baseline.cells[${index}]`),
      replyWins: numberField(raw, 'replyWins', `baseline.cells[${index}]`),
      outcomePoints2: numberField(raw, 'outcomePoints2', `baseline.cells[${index}]`),
      openerScoreSum: numberField(raw, 'openerScoreSum', `baseline.cells[${index}]`),
      replyScoreSum: numberField(raw, 'replyScoreSum', `baseline.cells[${index}]`),
      kills: tuple2(raw.kills, `baseline.cells[${index}].kills`),
      bounty: tuple2(raw.bounty, `baseline.cells[${index}].bounty`),
      roleCasts: [
        numberField(record(roles[0], `baseline.cells[${index}].roles[0]`), 'casts', `baseline.cells[${index}].roles[0]`),
        numberField(record(roles[1], `baseline.cells[${index}].roles[1]`), 'casts', `baseline.cells[${index}].roles[1]`),
      ],
    };
    if (parsed.games !== gamesPerCell
      || parsed.openerWins + parsed.draws + parsed.replyWins !== parsed.games
      || parsed.outcomePoints2 !== 2 * parsed.openerWins + parsed.draws) {
      throw new Error(`Baseline W/D/L does not reconcile: ${baselineKey(parsed)}`);
    }
    if (parsed.sourceCellSeed !== deriveCellSeed({ ...parsed, replication: 0 })) {
      throw new Error(`Baseline cell seed does not reconcile: ${baselineKey(parsed)}`);
    }
    const key = baselineKey(parsed);
    if (cells.has(key)) throw new Error(`Duplicate baseline cell: ${key}`);
    cells.set(key, parsed);
  }
  return { modeId, cells, emitterSha256, fileSha256 };
}

function outcomeSnapshot(cell: SunderCellResult): OutcomeSnapshot {
  return {
    games: cell.games,
    openerWins: cell.openerWins,
    draws: cell.draws,
    replyWins: cell.replyWins,
    outcomePoints2: cell.outcomePoints2,
    openerScoreSum: cell.openerScoreSum,
    replyScoreSum: cell.replyScoreSum,
    kills: [...cell.kills],
    bounty: [...cell.bounty],
    roleCasts: [cell.roles[0].casts, cell.roles[1].casts],
  };
}

function coordinationSnapshot(role: SunderRoleAggregate): SunderCoordinationSnapshot {
  return {
    coordinatedPreviews: role.coordinatedPreviews,
    slipChecks: role.slipChecks,
    slips: role.slips,
    coordinatedPlacementsReused: role.coordinatedPlacementsReused,
    coordinatedVsBlindComparisons: role.coordinatedVsBlindComparisons,
    coordinatedVsBlindDifferences: role.coordinatedVsBlindDifferences,
    castAttributableComparisons: role.castAttributableComparisons,
    incrementalKillsSum: role.incrementalKillsSum,
    incrementalBountySum: role.incrementalBountySum,
    zeroIncrementalKillCasts: role.zeroIncrementalKillCasts,
    zeroMarginalCasts: role.zeroMarginalCasts,
    liveEnemyWardCasts: role.liveEnemyWardCasts,
    liveWardValuationPlacementDifferences: role.liveWardValuationPlacementDifferences,
    actualWardAbsorbedDice: role.actualWardAbsorbedDice,
  };
}

function clean(value: number): number {
  return +value.toFixed(12);
}

function pooledRate(
  comparisons: CellComparison[], modeId: ScopeModeId, castRule: CastRule,
  opener: string, reply: string, treatment: 'baseline' | 'coordinated',
): number {
  const selected = comparisons.filter((cell) => cell.modeId === modeId
    && cell.castRule === castRule && cell.openerRune === opener && cell.replyRune === reply);
  if (!selected.length) throw new Error(`Missing pooled comparison: ${modeId} ${castRule} ${opener}->${reply}`);
  const points = selected.reduce((sum, cell) => sum + cell[treatment].outcomePoints2, 0);
  const games = selected.reduce((sum, cell) => sum + cell[treatment].games, 0);
  return points / (2 * games);
}

function summarize(comparisons: CellComparison[]): TargetedSummary {
  const seatNeutral = (
    modeId: ScopeModeId, castRule: CastRule, opponent: string,
    treatment: 'baseline' | 'coordinated',
  ) => {
    if (opponent === SUNDER_ID) return 0.5;
    const opens = pooledRate(comparisons, modeId, castRule, SUNDER_ID, opponent, treatment);
    const replies = pooledRate(comparisons, modeId, castRule, opponent, SUNDER_ID, treatment);
    return (opens + 1 - replies) / 2;
  };
  const rows: TargetedSummary['oneCastSunderSeatNeutral'] = [];
  for (const modeId of ['classic', 'bounty'] as const) {
    for (const opponent of SPELLS) {
      const baseline = seatNeutral(modeId, 'one', opponent.id, 'baseline');
      const coordinated = seatNeutral(modeId, 'one', opponent.id, 'coordinated');
      rows.push({
        modeId,
        opponentRune: opponent.id,
        baselineSunderScore: clean(baseline),
        coordinatedSunderScore: clean(coordinated),
        delta: clean(coordinated - baseline),
      });
    }
  }
  for (const modeId of ['colshield'] as const) {
    const baseline = seatNeutral(modeId, 'one', WARD_ID, 'baseline');
    const coordinated = seatNeutral(modeId, 'one', WARD_ID, 'coordinated');
    rows.push({
      modeId,
      opponentRune: WARD_ID,
      baselineSunderScore: clean(baseline),
      coordinatedSunderScore: clean(coordinated),
      delta: clean(coordinated - baseline),
    });
  }
  const chain = (['classic', 'bounty'] as const).map((modeId) => {
    const baseline = seatNeutral(modeId, 'chain', FATE_ID, 'baseline');
    const coordinated = seatNeutral(modeId, 'chain', FATE_ID, 'coordinated');
    return {
      modeId,
      baselineSunderScore: clean(baseline),
      coordinatedSunderScore: clean(coordinated),
      delta: clean(coordinated - baseline),
    };
  });
  return {
    scope: 'Targeted seat-neutral SUNDER outcomes pooled across requested replications',
    oneCastSunderSeatNeutral: rows,
    fateChainSunderSeatNeutral: chain,
    limitation: 'This targeted substitution does not recompute the seven-mode ranked wheel or global dominance relations.',
  };
}

export function attachBaselines(
  report: SunderSensitivityReport,
  inputs: BaselineInput[],
): SunderSensitivityReport {
  if (!inputs.length) throw new Error('At least one baseline report is required.');
  const validated = inputs.map((input) => ({
    ...input,
    validated: validateBaseline(report.request.gamesPerCell, report.request.seeds, input.report),
  }));
  const byMode = new Map<ScopeModeId, typeof validated[number]>();
  for (const item of validated) {
    if (byMode.has(item.validated.modeId)) throw new Error(`Duplicate baseline mode: ${item.validated.modeId}`);
    byMode.set(item.validated.modeId, item);
  }
  for (const modeId of report.request.modeIds) {
    if (!byMode.has(modeId)) throw new Error(`Missing ${modeId} baseline report.`);
  }
  const comparisons: CellComparison[] = report.cells.map((cell) => {
    const raw = byMode.get(cell.modeId)!.validated.cells.get(baselineKey(cell));
    if (!raw) throw new Error(`Baseline is missing targeted cell: ${baselineKey(cell)}`);
    const baseline: OutcomeSnapshot = {
      games: raw.games,
      openerWins: raw.openerWins,
      draws: raw.draws,
      replyWins: raw.replyWins,
      outcomePoints2: raw.outcomePoints2,
      openerScoreSum: raw.openerScoreSum,
      replyScoreSum: raw.replyScoreSum,
      kills: raw.kills,
      bounty: raw.bounty,
      roleCasts: raw.roleCasts,
    };
    const coordinated = outcomeSnapshot(cell);
    return {
      baseSeed: cell.baseSeed,
      replication: cell.replication,
      castRule: cell.castRule,
      modeId: cell.modeId,
      openerRune: cell.openerRune,
      replyRune: cell.replyRune,
      sourceCellSeed: cell.sourceCellSeed,
      baseline,
      coordinated: {
        ...coordinated,
        sunder: [coordinationSnapshot(cell.roles[0]), coordinationSnapshot(cell.roles[1])],
      },
      delta: {
        openerWins: coordinated.openerWins - baseline.openerWins,
        draws: coordinated.draws - baseline.draws,
        replyWins: coordinated.replyWins - baseline.replyWins,
        outcomePoints2: coordinated.outcomePoints2 - baseline.outcomePoints2,
        openerOutcomeRate: clean(
          coordinated.outcomePoints2 / (2 * coordinated.games)
          - baseline.outcomePoints2 / (2 * baseline.games),
        ),
        openerScoreSum: coordinated.openerScoreSum - baseline.openerScoreSum,
        replyScoreSum: coordinated.replyScoreSum - baseline.replyScoreSum,
        kills: [coordinated.kills[0] - baseline.kills[0], coordinated.kills[1] - baseline.kills[1]],
        bounty: [coordinated.bounty[0] - baseline.bounty[0], coordinated.bounty[1] - baseline.bounty[1]],
        roleCasts: [
          coordinated.roleCasts[0] - baseline.roleCasts[0],
          coordinated.roleCasts[1] - baseline.roleCasts[1],
        ],
      },
    };
  });
  const references: BaselineReference[] = [...byMode.values()].map((item) => ({
    modeId: item.validated.modeId,
    input: item.input,
    reportSha256: item.reportSha256,
    emitterSha256: item.validated.emitterSha256,
    expectedEmitterSha256: FROZEN_MATCHUP_SHA256,
    sourceSimulatorVersion: SIMULATOR_VERSION,
    sourceFileSha256: item.validated.fileSha256,
    policyValidated: true,
    pairedGameSeeds: true,
    comparedCellRecords: comparisons.filter((cell) => cell.modeId === item.validated.modeId).length,
  }));
  return { ...report, baselines: references, comparisons, targetedSummary: summarize(comparisons) };
}

export interface CliOptions {
  games: number;
  seeds: string[];
  baselines: string[];
  output?: string;
  quiet: boolean;
  help: boolean;
}

const VALUE_FLAGS = new Set(['--games', '--seed', '--baseline', '--output']);
const REPEATABLE_FLAGS = new Set(['--seed', '--baseline']);
const BOOLEAN_FLAGS = new Set(['--quiet', '--help']);

export function parseSunderSensitivityCli(argv: string[]): CliOptions {
  const seen = new Set<string>();
  const found = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (BOOLEAN_FLAGS.has(flag)) {
      if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
      seen.add(flag);
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(flag.startsWith('-') ? `Unknown option: ${flag}` : `Unexpected argument: ${flag}`);
    }
    if (seen.has(flag) && !REPEATABLE_FLAGS.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    found.set(flag, [...(found.get(flag) ?? []), value]);
    index++;
  }
  const games = +(found.get('--games')?.[0] ?? '3000');
  if (!Number.isInteger(games) || games < 1) throw new Error('--games must be a positive integer.');
  const seeds = found.get('--seed') ?? [...DEFAULT_SEEDS];
  uniqueSeeds(seeds);
  const baselines = found.get('--baseline') ?? [];
  if (new Set(baselines).size !== baselines.length) throw new Error('Duplicate baseline paths are not separate sources.');
  if (baselines.length !== 0 && baselines.length !== 3) {
    throw new Error('Provide all three Classic, Bounty, and COLUMN SHIELD baselines, or none.');
  }
  return {
    games,
    seeds,
    baselines,
    output: found.get('--output')?.[0],
    quiet: seen.has('--quiet'),
    help: seen.has('--help'),
  };
}

function sha256Bytes(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function collectProvenance(): Record<string, unknown> {
  const files = [
    'tools/rune-sunder-sensitivity.ts',
    'tools/rune-matchups.ts',
    'src/core/rules.ts',
    'src/core/spells.ts',
    'src/core/spell-types.ts',
    'src/core/spell-policy.ts',
    'src/core/ai.ts',
    'src/core/dice.ts',
    'src/core/modes.ts',
    'src/flow/spell-ai.ts',
    'src/flow/game-ai.ts',
    'src/flow/game.ts',
    'src/config.ts',
  ];
  const fileSha256 = Object.fromEntries(files.map((file) => [file, sha256Bytes(readFileSync(file))]));
  if (fileSha256['tools/rune-matchups.ts'] !== FROZEN_MATCHUP_SHA256) {
    throw new Error(`tools/rune-matchups.ts is not frozen v1 (${fileSha256['tools/rune-matchups.ts']}).`);
  }
  for (const [file, expected] of Object.entries(PRODUCTION_POLICY_SHA256)) {
    if (fileSha256[file] !== expected) {
      throw new Error(`Production SUNDER policy source drifted: ${file} (${fileSha256[file]}).`);
    }
  }
  let gitHead = 'unavailable';
  let dirty = true;
  try {
    gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch { /* source hashes remain decisive */ }
  return { node: process.version, gitHead, dirty, fileSha256 };
}

function help(): string {
  return `Usage: mise exec -- node --experimental-strip-types tools/rune-sunder-sensitivity.ts [options]

Fixed design:
  Classic and Bounty: 11 directed one-cast SUNDER cells plus both directed
  FATE/SUNDER chain cells. COLUMN SHIELD: directed SUNDER/WARD one-cast only.
  Production Normal depth 2 / risk 0.9 / named 5% coordination slip.

Options:
  --games N         games per cell, default 3000
  --seed ID         repeat for replications; default 20260824-a through -d
  --baseline PATH   repeat for raw-classic, raw-bounty, raw-colshield reports
  --output PATH     write JSON here; otherwise stdout
  --quiet           suppress cell progress on stderr
  --help            show this help`;
}

async function main(): Promise<void> {
  const cli = parseSunderSensitivityCli(process.argv.slice(2));
  if (cli.help) { console.log(help()); return; }
  const inputs = cli.baselines.map((input) => {
    const resolved = path.resolve(input);
    const bytes = readFileSync(resolved);
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error(`Baseline is not valid JSON: ${input}`); }
    return {
      input: path.basename(resolved),
      reportSha256: sha256Bytes(bytes),
      report: parsed,
    };
  });
  if (inputs.length) {
    const modes = inputs.map((input) => validateBaseline(cli.games, cli.seeds, input.report).modeId);
    if (new Set(modes).size !== 3) throw new Error('Baseline preflight requires one report per target mode.');
  }
  let report = runSunderSensitivity({
    games: cli.games,
    seeds: cli.seeds,
    provenance: collectProvenance(),
    onCell: (cell, completed, total) => {
      if (!cli.quiet) console.error(`· ${completed}/${total} ${cell.baseSeed} ${cell.castRule} ${cell.modeId} ${cell.openerRune}->${cell.replyRune}`);
    },
  });
  if (inputs.length) report = attachBaselines(report, inputs);
  const json = JSON.stringify(report, null, 2) + '\n';
  if (cli.output) {
    const target = path.resolve(cli.output);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, json);
  } else {
    process.stdout.write(json);
  }
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
