// Targeted COLUMN SHIELD WARD coordination sensitivity measurement.
//
// This is deliberately a separate, versioned treatment instrument. The frozen
// rune-matchups v1 simulator remains the baseline and still owns game/replay,
// supply, role, and terminal semantics. This module changes one policy seam:
// v2 follows the projected WARD root charm used by production placement
// search. The retired completion veto is deliberately absent; the instrument
// still records preview/final divergence while Normal independently searches
// for the actual placement.
//
// Run the final treatment cohort (four fixed replications, 3,000 games/cell):
//   mise exec -- node --experimental-strip-types tools/rune-ward-sensitivity.ts \
//     --baseline docs/evidence/rune-matchups/v1/raw-colshield.json \
//     --output ward-sensitivity.json
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AI, ME, COLSHIELD, type CharmSt, type GameState, type Mode, type Player,
} from '../src/core/rules.ts';
import { searchRoot } from '../src/core/ai.ts';
import { randStream } from '../src/core/dice.ts';
import {
  SPELLS, machineCastPlan, type CastCtx, type SpellSpec,
} from '../src/core/spells.ts';
import {
  SIMULATOR_VERSION, deriveCellSeed, deriveGameSeed, playMatchupGame,
  type CastRule, type CellPlan, type GameResult, type PlacementDecision,
  type TerminalReason,
} from './rune-matchups.ts';

export const WARD_SENSITIVITY_SCHEMA_VERSION = 1;
export const WARD_SENSITIVITY_VERSION = 2;
export const FROZEN_MATCHUP_SHA256 = 'a875c056c6f98071b679f184e0672e80438965148ae2bd76796b1acf42e90acf';
export const DEFAULT_SEEDS = [
  '20260824-a', '20260824-b', '20260824-c', '20260824-d',
] as const;

const DEPTH = 2;
const RISK_WEIGHT = 0.9;
const OPPONENT_WEIGHT = 1;
const DEFAULT_DEMAND = 16;
const WARD_ID = 'ward';
const FATE_ID = 'fate';

export interface WardSensitivityPlan extends CellPlan {
  modeId: 'colshield';
}

export interface CoordinationRoleCounts {
  hazardPreviews: number;
  vetoes: number;
  hazardousSuccessfulCasts: number;
  immediateRedundantPlacements: number;
  previewFinalComparisons: number;
  previewFinalDivergences: number;
}

export interface WardGameResult {
  sourceGameSeed: string;
  game: GameResult;
  coordination: [CoordinationRoleCounts, CoordinationRoleCounts];
}

export interface SensitivityRoleAggregate extends CoordinationRoleCounts {
  casts: number;
  gamesWithCast: number;
  legalCastOpportunities: number;
  unusedCharges: number;
  immediateSwingCount: number;
  immediateSwingSum: number;
  immediateSwingSquaredSum: number;
}

export interface SensitivityCellResult extends WardSensitivityPlan {
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
  terminalReasons: Record<TerminalReason, number>;
  roles: [SensitivityRoleAggregate, SensitivityRoleAggregate];
  internalOpener: {
    ai: { games: number; wins: number; draws: number; losses: number };
    me: { games: number; wins: number; draws: number; losses: number };
  };
}

export interface WardSensitivityOptions {
  games?: number;
  seeds?: string[];
  provenance?: Record<string, unknown>;
  onCell?: (cell: SensitivityCellResult, completed: number, total: number) => void;
}

export interface WardSensitivityReport {
  schemaVersion: number;
  instrumentVersion: number;
  sourceSimulatorVersion: number;
  provenance: Record<string, unknown>;
  request: {
    gamesPerCell: number;
    seeds: string[];
    modeId: 'colshield';
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
    cellRecords: number;
    replicationCount: number;
    totalGames: number;
  };
  cells: SensitivityCellResult[];
  baseline?: BaselineReference;
  comparisons?: CellComparison[];
  targetedSummary?: TargetedComparisonSummary;
}

export interface BaselineReference {
  input: string;
  reportSha256: string;
  emitterSha256: string;
  expectedEmitterSha256: string;
  sourceSimulatorVersion: number;
  policyValidated: true;
  pairedGameSeeds: true;
  comparedCellRecords: number;
}

interface OutcomeSnapshot {
  games: number;
  openerWins: number;
  draws: number;
  replyWins: number;
  outcomePoints2: number;
  openerScoreSum: number;
  replyScoreSum: number;
  roleCasts: [number, number];
}

export interface CellComparison extends WardSensitivityPlan {
  sourceCellSeed: string;
  baseline: OutcomeSnapshot;
  coordinated: OutcomeSnapshot & {
    roles: [CoordinationRoleCounts, CoordinationRoleCounts];
  };
  delta: {
    openerWins: number;
    draws: number;
    replyWins: number;
    outcomePoints2: number;
    openerOutcomeRate: number;
    openerScoreSum: number;
    replyScoreSum: number;
    roleCasts: [number, number];
  };
}

export interface TargetedComparisonSummary {
  scope: string;
  oneCastWardSeatNeutral: Array<{
    opponentRune: string;
    baselineWardScore: number;
    coordinatedWardScore: number;
    delta: number;
  }>;
  oneCastWardUniformPopulationStrength: {
    baseline: number;
    coordinated: number;
    delta: number;
  };
  chainFateWardSeatNeutral: {
    baselineWardScore: number;
    coordinatedWardScore: number;
    delta: number;
  };
  limitation: string;
}

export interface WardGameOverrides {
  openerPlayer?: Player;
  initialState?: GameState;
  endlessDraw?: () => number;
  maxPlacements?: number;
  searchRandom?: [() => number, () => number];
  placementDecision?: WardPlacementDecision;
}

type WardPlacementDecision = (
  st: GameState,
  who: Player,
  die: number,
  mode: Mode,
  random: () => number,
  rootCharm?: CharmSt,
) => number;

const emptyCoordination = (): CoordinationRoleCounts => ({
  hazardPreviews: 0,
  vetoes: 0,
  hazardousSuccessfulCasts: 0,
  immediateRedundantPlacements: 0,
  previewFinalComparisons: 0,
  previewFinalDivergences: 0,
});

const emptyRole = (): SensitivityRoleAggregate => ({
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

const roleIndex = (who: Player, opener: Player): 0 | 1 => who === opener ? 0 : 1;

function uniqueSeeds(seeds: string[]): void {
  if (!seeds.length) throw new Error('At least one seed is required.');
  if (seeds.some((seed) => !seed.length)) throw new Error('Seeds must not be empty.');
  if (new Set(seeds).size !== seeds.length) {
    throw new Error('Duplicate seeds are not independent replications.');
  }
}

/* Exactly 11 directed one-cast cells containing WARD, plus the only two
   branch-sensitive directed FATE/WARD cells under chain. Registry order owns
   the one-cast ordering; adding a rune therefore adds its two WARD directions
   without teaching this instrument a second roster. */
export function planWardSensitivity(
  seeds: string[] = [...DEFAULT_SEEDS],
): WardSensitivityPlan[] {
  uniqueSeeds(seeds);
  const mechanical: Array<Pick<WardSensitivityPlan, 'castRule' | 'openerRune' | 'replyRune'>> = [];
  for (const opener of SPELLS) {
    for (const reply of SPELLS) {
      if (opener.id === WARD_ID || reply.id === WARD_ID) {
        mechanical.push({ castRule: 'one', openerRune: opener.id, replyRune: reply.id });
      }
    }
  }
  mechanical.push(
    { castRule: 'chain', openerRune: FATE_ID, replyRune: WARD_ID },
    { castRule: 'chain', openerRune: WARD_ID, replyRune: FATE_ID },
  );
  const cells: WardSensitivityPlan[] = [];
  for (let replication = 0; replication < seeds.length; replication++) {
    for (const config of mechanical) {
      cells.push({
        baseSeed: seeds[replication], replication, modeId: 'colshield', ...config,
      });
    }
  }
  return cells;
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

interface PendingPreview {
  preview: number;
}

/* One versioned Normal-policy sensitivity game. The same role-specific stream
   is handed to the projected-charm preview and to the final placement. This
   instrument deliberately discards the preview and records the independent
   rerun after the preview has consumed its tie-jitter samples. */
export function playWardSensitivityGame(
  cell: WardSensitivityPlan,
  gameIndex: number,
  overrides: WardGameOverrides = {},
): WardGameResult {
  if (!Number.isInteger(gameIndex) || gameIndex < 0) throw new Error('Game index must be a non-negative integer.');
  if (cell.modeId !== 'colshield') throw new Error('WARD sensitivity is scoped to COLUMN SHIELD.');
  if (cell.openerRune !== WARD_ID && cell.replyRune !== WARD_ID) {
    throw new Error('WARD sensitivity cells must contain WARD.');
  }
  if (cell.castRule === 'chain') {
    const pair = new Set([cell.openerRune, cell.replyRune]);
    if (pair.size !== 2 || !pair.has(FATE_ID) || !pair.has(WARD_ID)) {
      throw new Error('Only directed FATE/WARD cells are branch-sensitive here.');
    }
  }
  const openerPlayer = overrides.openerPlayer ?? (gameIndex % 2 ? ME : AI) as Player;
  const sourceGameSeed = deriveGameSeed(cell, gameIndex);
  const streams = overrides.searchRandom ?? [
    randStream(sourceGameSeed + '#search-opener'),
    randStream(sourceGameSeed + '#search-reply'),
  ];
  const placement = overrides.placementDecision ?? normalPlacement;
  const coordination: [CoordinationRoleCounts, CoordinationRoleCounts] = [
    emptyCoordination(), emptyCoordination(),
  ];
  const pending: [PendingPreview | null, PendingPreview | null] = [null, null];

  const decideCast = (
    st: GameState, who: Player, spell: SpellSpec, ctx: CastCtx, demand: number,
  ): number | null => {
    const index = roleIndex(who, openerPlayer);
    let previewCalled = false;
    let preview = -1;
    const plan = machineCastPlan(st, who, spell, ctx, demand, (rootCharm) => {
      previewCalled = true;
      preview = placement(st, who, ctx.die, ctx.mode, streams[index], rootCharm);
      return preview;
    });
    if (!previewCalled) return plan.target;
    if (pending[who]) throw new Error(`Unconsumed WARD preview before placement: ${sourceGameSeed}`);
    const counts = coordination[index];
    counts.hazardPreviews++;
    if (plan.vetoedByPlacement) counts.vetoes++;
    else if (plan.target !== null) counts.hazardousSuccessfulCasts++;
    else throw new Error(`Hazard preview produced neither a cast nor a veto: ${sourceGameSeed}`);
    pending[who] = { preview };
    return plan.target;
  };

  const choosePlacement: PlacementDecision = (st, who, die, mode, random) => {
    const column = placement(st, who, die, mode, random);
    const held = pending[who];
    if (held) {
      const counts = coordination[roleIndex(who, openerPlayer)];
      counts.previewFinalComparisons++;
      if (held.preview !== column) counts.previewFinalDivergences++;
      pending[who] = null;
    }
    return column;
  };

  const game = playMatchupGame({
    gameSeed: sourceGameSeed,
    mode: COLSHIELD,
    openerRune: rune(cell.openerRune),
    replyRune: rune(cell.replyRune),
    castRule: cell.castRule,
    openerPlayer,
    depth: DEPTH,
    riskWeight: RISK_WEIGHT,
    opponentWeight: OPPONENT_WEIGHT,
    searchRandom: streams,
    decideCast,
    choosePlacement,
    initialState: overrides.initialState,
    endlessDraw: overrides.endlessDraw,
    maxPlacements: overrides.maxPlacements,
  });
  if (pending[AI] || pending[ME]) {
    throw new Error(`Terminal game left an unobserved WARD placement preview: ${sourceGameSeed}`);
  }
  return { sourceGameSeed, game, coordination };
}

function addCoordination(target: CoordinationRoleCounts, source: CoordinationRoleCounts): void {
  target.hazardPreviews += source.hazardPreviews;
  target.vetoes += source.vetoes;
  target.hazardousSuccessfulCasts += source.hazardousSuccessfulCasts;
  target.immediateRedundantPlacements += source.immediateRedundantPlacements;
  target.previewFinalComparisons += source.previewFinalComparisons;
  target.previewFinalDivergences += source.previewFinalDivergences;
}

export function runWardSensitivityCell(
  cell: WardSensitivityPlan,
  games: number,
): SensitivityCellResult {
  if (!Number.isInteger(games) || games < 1) throw new Error('Games per cell must be a positive integer.');
  const roles: [SensitivityRoleAggregate, SensitivityRoleAggregate] = [emptyRole(), emptyRole()];
  const internalOpener = {
    ai: { games: 0, wins: 0, draws: 0, losses: 0 },
    me: { games: 0, wins: 0, draws: 0, losses: 0 },
  };
  const result: SensitivityCellResult = {
    ...cell,
    sourceCellSeed: deriveCellSeed(cell),
    treatmentCellId: `rune-ward-sensitivity-v${WARD_SENSITIVITY_VERSION}#${deriveCellSeed(cell)}`,
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
    terminalReasons: emptyTerminalReasons(),
    roles,
    internalOpener,
  };
  for (let gameIndex = 0; gameIndex < games; gameIndex++) {
    const played = playWardSensitivityGame(cell, gameIndex);
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

export function runWardSensitivity(options: WardSensitivityOptions = {}): WardSensitivityReport {
  const games = options.games ?? 3000;
  if (!Number.isInteger(games) || games < 1) throw new Error('Games per cell must be a positive integer.');
  const seeds = options.seeds ? [...options.seeds] : [...DEFAULT_SEEDS];
  const planned = planWardSensitivity(seeds);
  const cells: SensitivityCellResult[] = [];
  for (let index = 0; index < planned.length; index++) {
    const cell = runWardSensitivityCell(planned[index], games);
    cells.push(cell);
    options.onCell?.(cell, index + 1, planned.length);
  }
  const mechanical = new Set(planned.map((cell) =>
    `${cell.castRule}:${cell.modeId}:${cell.openerRune}:${cell.replyRune}`));
  const one = new Set(planned.filter((cell) => cell.castRule === 'one').map((cell) =>
    `${cell.openerRune}:${cell.replyRune}`));
  const chain = new Set(planned.filter((cell) => cell.castRule === 'chain').map((cell) =>
    `${cell.openerRune}:${cell.replyRune}`));
  return {
    schemaVersion: WARD_SENSITIVITY_SCHEMA_VERSION,
    instrumentVersion: WARD_SENSITIVITY_VERSION,
    sourceSimulatorVersion: SIMULATOR_VERSION,
    provenance: options.provenance ?? {},
    request: {
      gamesPerCell: games,
      seeds,
      modeId: 'colshield',
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
      previewDeclaration: 'SpellSpec.cpuRootCharm',
      completionVeto: false,
      previewReuse: false,
      finalPlacement: 'independent rerun on the same advanced role search stream',
      opponentRuneAware: false,
      charmAwarePlacementSearch: 'projected preview only',
    },
    sourceRelationship: {
      frozenGameEngine: 'tools/rune-matchups.ts simulatorVersion 1',
      frozenEmitterSha256: FROZEN_MATCHUP_SHA256,
      treatmentSeam: 'machineCast -> projected-root-charm preview plus Normal preview-discard-final-rerun',
      commonGameSeeds: true,
      commonSupplyStreams: true,
      searchStreamDivergence: 'only after a projected-root-charm preview consumes tie-jitter samples',
    },
    seedDerivation: 'deriveGameSeed from frozen rune-matchups v1; domains #supply, #search-opener, #search-reply',
    fieldSemantics: {
      roleArrayOrder: ['opener', 'reply'],
      hazardPreviews: 'legacy schema field: machineCastPlan called a projected-root-charm placement preview',
      vetoes: 'legacy schema field retained at zero: v2 removed WARD completion vetoes',
      hazardousSuccessfulCasts: 'legacy schema field: a projected-root-charm preview ran and the cast target remained legal',
      immediateRedundantPlacements: 'legacy schema field retained at zero: target completion is no longer defined as redundant',
      previewFinalDivergences: 'projected-charm preview column differed from Normal final placement column',
      immediateSwing: 'score swing recorded by frozen v1 game instrumentation at cast application',
    },
    roster: SPELLS.map(({ id, uses }) => ({ id, uses })),
    plan: {
      mechanicalConfigurations: mechanical.size,
      oneCastConfigurations: one.size,
      chainConfigurations: chain.size,
      cellRecords: planned.length,
      replicationCount: seeds.length,
      totalGames: planned.length * games,
    },
    cells,
  };
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

function baselineKey(cell: Pick<CellPlan, 'baseSeed' | 'castRule' | 'modeId' | 'openerRune' | 'replyRune'>): string {
  return `${cell.baseSeed}:${cell.castRule}:${cell.modeId}:${cell.openerRune}:${cell.replyRune}`;
}

interface ValidBaselineCell extends OutcomeSnapshot {
  baseSeed: string;
  castRule: CastRule;
  modeId: string;
  openerRune: string;
  replyRune: string;
  sourceCellSeed: string;
}

function validateBaseline(
  report: WardSensitivityReport,
  input: unknown,
): { cells: Map<string, ValidBaselineCell>; emitterSha256: string } {
  const root = record(input, 'baseline');
  if (numberField(root, 'schemaVersion', 'baseline') !== 1
    || numberField(root, 'simulatorVersion', 'baseline') !== SIMULATOR_VERSION) {
    throw new Error('Baseline must be a rune-matchups schema/simulator v1 report.');
  }
  const request = record(root.request, 'baseline.request');
  if (numberField(request, 'gamesPerCell', 'baseline.request') !== report.request.gamesPerCell) {
    throw new Error('Baseline and coordinated treatment must use the same games per cell.');
  }
  const seedList = request.seeds;
  if (!Array.isArray(seedList) || !report.request.seeds.every((seed) => seedList.includes(seed))) {
    throw new Error('Baseline does not contain every requested replication seed.');
  }
  const modes = request.modeIds;
  if (!Array.isArray(modes) || modes.length !== 1 || modes[0] !== 'colshield') {
    throw new Error('Baseline must be the focused raw COLSHIELD report.');
  }
  const policy = record(root.policy, 'baseline.policy');
  if (policy.placement !== 'searchRoot' || policy.cast !== 'machineCast'
    || policy.depth !== DEPTH || policy.riskWeight !== RISK_WEIGHT
    || policy.opponentWeight !== OPPONENT_WEIGHT || policy.defaultDemand !== DEFAULT_DEMAND) {
    throw new Error('Baseline policy does not match the frozen Normal policy.');
  }
  const demandOverrides = record(policy.demandOverrides, 'baseline.policy.demandOverrides');
  const uses = record(policy.uses, 'baseline.policy.uses');
  if (Object.keys(demandOverrides).length
    || SPELLS.some((spell) => uses[spell.id] !== spell.uses)) {
    throw new Error('Baseline must use the untuned registry demand/charge policy.');
  }
  const provenance = record(root.provenance, 'baseline.provenance');
  const hashes = record(provenance.fileSha256, 'baseline.provenance.fileSha256');
  const emitterSha256 = stringField(hashes, 'tools/rune-matchups.ts', 'baseline.provenance.fileSha256');
  if (emitterSha256 !== FROZEN_MATCHUP_SHA256) {
    throw new Error(`Baseline emitter hash is not frozen v1: ${emitterSha256}`);
  }
  if (!Array.isArray(root.cells)) throw new Error('baseline.cells must be an array.');
  const cells = new Map<string, ValidBaselineCell>();
  for (let index = 0; index < root.cells.length; index++) {
    const raw = record(root.cells[index], `baseline.cells[${index}]`);
    const castRule = stringField(raw, 'castRule', `baseline.cells[${index}]`);
    if (castRule !== 'one' && castRule !== 'chain') throw new Error(`Invalid baseline cast rule: ${castRule}`);
    const roles = raw.roles;
    if (!Array.isArray(roles) || roles.length !== 2) throw new Error(`baseline.cells[${index}].roles must have two entries.`);
    const parsed: ValidBaselineCell = {
      baseSeed: stringField(raw, 'baseSeed', `baseline.cells[${index}]`),
      castRule,
      modeId: stringField(raw, 'modeId', `baseline.cells[${index}]`),
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
      roleCasts: [
        numberField(record(roles[0], `baseline.cells[${index}].roles[0]`), 'casts', `baseline.cells[${index}].roles[0]`),
        numberField(record(roles[1], `baseline.cells[${index}].roles[1]`), 'casts', `baseline.cells[${index}].roles[1]`),
      ],
    };
    if (parsed.games !== report.request.gamesPerCell
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
  return { cells, emitterSha256 };
}

function snapshot(cell: SensitivityCellResult): OutcomeSnapshot {
  return {
    games: cell.games,
    openerWins: cell.openerWins,
    draws: cell.draws,
    replyWins: cell.replyWins,
    outcomePoints2: cell.outcomePoints2,
    openerScoreSum: cell.openerScoreSum,
    replyScoreSum: cell.replyScoreSum,
    roleCasts: [cell.roles[0].casts, cell.roles[1].casts],
  };
}

function coordinationSnapshot(role: SensitivityRoleAggregate): CoordinationRoleCounts {
  return {
    hazardPreviews: role.hazardPreviews,
    vetoes: role.vetoes,
    hazardousSuccessfulCasts: role.hazardousSuccessfulCasts,
    immediateRedundantPlacements: role.immediateRedundantPlacements,
    previewFinalComparisons: role.previewFinalComparisons,
    previewFinalDivergences: role.previewFinalDivergences,
  };
}

function clean(value: number): number {
  return +value.toFixed(12);
}

function pooledRate(
  comparisons: CellComparison[],
  castRule: CastRule,
  opener: string,
  reply: string,
  treatment: 'baseline' | 'coordinated',
): number {
  const selected = comparisons.filter((cell) => cell.castRule === castRule
    && cell.openerRune === opener && cell.replyRune === reply);
  if (!selected.length) throw new Error(`Missing pooled comparison: ${castRule} ${opener}->${reply}`);
  const points2 = selected.reduce((sum, cell) => sum + cell[treatment].outcomePoints2, 0);
  const games = selected.reduce((sum, cell) => sum + cell[treatment].games, 0);
  return points2 / (2 * games);
}

function targetedSummary(comparisons: CellComparison[]): TargetedComparisonSummary {
  const seatNeutral = (castRule: CastRule, opponent: string, treatment: 'baseline' | 'coordinated') => {
    if (opponent === WARD_ID) return 0.5;
    const wardOpens = pooledRate(comparisons, castRule, WARD_ID, opponent, treatment);
    const opponentOpens = pooledRate(comparisons, castRule, opponent, WARD_ID, treatment);
    return (wardOpens + (1 - opponentOpens)) / 2;
  };
  const rows = SPELLS.map((opponent) => {
    const baselineWardScore = seatNeutral('one', opponent.id, 'baseline');
    const coordinatedWardScore = seatNeutral('one', opponent.id, 'coordinated');
    return {
      opponentRune: opponent.id,
      baselineWardScore: clean(baselineWardScore),
      coordinatedWardScore: clean(coordinatedWardScore),
      delta: clean(coordinatedWardScore - baselineWardScore),
    };
  });
  const baselineUniform = rows.reduce((sum, row) => sum + row.baselineWardScore, 0) / rows.length;
  const coordinatedUniform = rows.reduce((sum, row) => sum + row.coordinatedWardScore, 0) / rows.length;
  const baselineChain = seatNeutral('chain', FATE_ID, 'baseline');
  const coordinatedChain = seatNeutral('chain', FATE_ID, 'coordinated');
  return {
    scope: 'COLSHIELD only; seat-neutral WARD outcomes pooled across requested replications',
    oneCastWardSeatNeutral: rows,
    oneCastWardUniformPopulationStrength: {
      baseline: clean(baselineUniform),
      coordinated: clean(coordinatedUniform),
      delta: clean(coordinatedUniform - baselineUniform),
    },
    chainFateWardSeatNeutral: {
      baselineWardScore: clean(baselineChain),
      coordinatedWardScore: clean(coordinatedChain),
      delta: clean(coordinatedChain - baselineChain),
    },
    limitation: 'This targeted substitution cannot recompute the seven-mode weighted wheel or global dominance relations; unchanged cells remain only in the baseline files.',
  };
}

/* Attach exact per-seed baseline deltas. Matching games/cell plus frozen v1
   deriveGameSeed makes every comparison a common-game-seed treatment. */
export function attachBaseline(
  report: WardSensitivityReport,
  baselineInput: unknown,
  reference: { input: string; reportSha256: string },
): WardSensitivityReport {
  const baseline = validateBaseline(report, baselineInput);
  const comparisons: CellComparison[] = report.cells.map((cell) => {
    const raw = baseline.cells.get(baselineKey(cell));
    if (!raw) throw new Error(`Baseline is missing targeted cell: ${baselineKey(cell)}`);
    const base: OutcomeSnapshot = {
      games: raw.games,
      openerWins: raw.openerWins,
      draws: raw.draws,
      replyWins: raw.replyWins,
      outcomePoints2: raw.outcomePoints2,
      openerScoreSum: raw.openerScoreSum,
      replyScoreSum: raw.replyScoreSum,
      roleCasts: raw.roleCasts,
    };
    const coordinated = snapshot(cell);
    return {
      baseSeed: cell.baseSeed,
      replication: cell.replication,
      castRule: cell.castRule,
      modeId: cell.modeId,
      openerRune: cell.openerRune,
      replyRune: cell.replyRune,
      sourceCellSeed: cell.sourceCellSeed,
      baseline: base,
      coordinated: {
        ...coordinated,
        roles: [
          coordinationSnapshot(cell.roles[0]),
          coordinationSnapshot(cell.roles[1]),
        ],
      },
      delta: {
        openerWins: coordinated.openerWins - base.openerWins,
        draws: coordinated.draws - base.draws,
        replyWins: coordinated.replyWins - base.replyWins,
        outcomePoints2: coordinated.outcomePoints2 - base.outcomePoints2,
        openerOutcomeRate: clean(
          coordinated.outcomePoints2 / (2 * coordinated.games)
          - base.outcomePoints2 / (2 * base.games),
        ),
        openerScoreSum: coordinated.openerScoreSum - base.openerScoreSum,
        replyScoreSum: coordinated.replyScoreSum - base.replyScoreSum,
        roleCasts: [
          coordinated.roleCasts[0] - base.roleCasts[0],
          coordinated.roleCasts[1] - base.roleCasts[1],
        ],
      },
    };
  });
  return {
    ...report,
    baseline: {
      input: reference.input,
      reportSha256: reference.reportSha256,
      emitterSha256: baseline.emitterSha256,
      expectedEmitterSha256: FROZEN_MATCHUP_SHA256,
      sourceSimulatorVersion: SIMULATOR_VERSION,
      policyValidated: true,
      pairedGameSeeds: true,
      comparedCellRecords: comparisons.length,
    },
    comparisons,
    targetedSummary: targetedSummary(comparisons),
  };
}

export interface CliOptions {
  games: number;
  seeds: string[];
  baseline?: string;
  output?: string;
  quiet: boolean;
  help: boolean;
}

const VALUE_FLAGS = new Set(['--games', '--seed', '--baseline', '--output']);
const REPEATABLE_FLAGS = new Set(['--seed']);
const BOOLEAN_FLAGS = new Set(['--quiet', '--help']);

export function parseWardSensitivityCli(argv: string[]): CliOptions {
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
  const rawGames = found.get('--games')?.[0] ?? '3000';
  const games = +rawGames;
  if (!Number.isInteger(games) || games < 1) throw new Error('--games must be a positive integer.');
  const seeds = found.get('--seed') ?? [...DEFAULT_SEEDS];
  uniqueSeeds(seeds);
  return {
    games,
    seeds,
    baseline: found.get('--baseline')?.[0],
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
    'tools/rune-ward-sensitivity.ts',
    'tools/rune-matchups.ts',
    'src/core/rules.ts',
    'src/core/spells.ts',
    'src/core/spell-types.ts',
    'src/core/spell-policy.ts',
    'src/core/ai.ts',
    'src/core/dice.ts',
    'src/config.ts',
  ];
  const fileSha256 = Object.fromEntries(files.map((file) => [file, sha256Bytes(readFileSync(file))]));
  if (fileSha256['tools/rune-matchups.ts'] !== FROZEN_MATCHUP_SHA256) {
    throw new Error(`tools/rune-matchups.ts is not frozen v1 (${fileSha256['tools/rune-matchups.ts']}).`);
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
  return `Usage: mise exec -- node --experimental-strip-types tools/rune-ward-sensitivity.ts [options]

Fixed design:
  COLUMN SHIELD; 11 directed one-cast WARD cells; chain only for
  FATE->WARD and WARD->FATE; production Normal depth 2 / risk 0.9.

Options:
  --games N         games per cell, default 3000
  --seed ID         repeat for replications; default 20260824-a through -d
  --baseline PATH   frozen v1 raw-colshield.json for exact paired deltas
  --output PATH     write JSON here; otherwise stdout
  --quiet           suppress cell progress on stderr
  --help            show this help`;
}

async function main(): Promise<void> {
  const cli = parseWardSensitivityCli(process.argv.slice(2));
  if (cli.help) { console.log(help()); return; }
  let report = runWardSensitivity({
    games: cli.games,
    seeds: cli.seeds,
    provenance: collectProvenance(),
    onCell: (cell, completed, total) => {
      if (!cli.quiet) console.error(`· ${completed}/${total} ${cell.baseSeed} ${cell.castRule} ${cell.openerRune}->${cell.replyRune}`);
    },
  });
  if (cli.baseline) {
    const baselinePath = path.resolve(cli.baseline);
    const baselineBytes = readFileSync(baselinePath);
    let baseline: unknown;
    try { baseline = JSON.parse(baselineBytes.toString('utf8')); }
    catch { throw new Error(`Baseline is not valid JSON: ${cli.baseline}`); }
    report = attachBaseline(report, baseline, {
      input: path.basename(baselinePath),
      reportSha256: sha256Bytes(baselineBytes),
    });
  }
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
