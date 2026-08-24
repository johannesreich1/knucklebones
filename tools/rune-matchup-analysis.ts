// Deterministic analysis for v1 asymmetric rune-matchup reports.
//
// This tool never simulates games. It validates and pools independently seeded
// raw reports from tools/rune-matchups.ts, then derives the two views that must
// not be confused:
//
//   O(i,j) — opener i's measured score against reply j;
//   Q(i,j) — rune i's score against rune j after averaging who opens.
//
// Run:
//   node --experimental-strip-types tools/rune-matchup-analysis.ts \
//     report-a.json report-b.json --output analysis.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ANALYSIS_VERSION = 2;
const RAW_SCHEMA_VERSION = 1;
const DEFAULT_EQUILIBRIUM_ITERATIONS = 65_536;
const EPSILON = 1e-12;
const V1_RUNES = ['anvil', 'fate', 'nudge', 'pilfer', 'sunder', 'ward'];
const V1_MODES = ['bounty', 'classic', 'colshield', 'limited', 'rowmult', 'rowswitch', 'singlestrike'];

type JsonRecord = Record<string, unknown>;
type CastRule = 'one' | 'chain';

interface RawMode {
  id: string;
  mode: number;
  weight: number;
}

interface RawRune {
  id: string;
  uses: number;
}

interface RawCell {
  baseSeed: string;
  replication: number;
  castRule: CastRule;
  modeId: string;
  openerRune: string;
  replyRune: string;
  cellSeed: string;
  games: number;
  openerWins: number;
  draws: number;
  replyWins: number;
  outcomePoints2: number;
  terminalReasons?: Record<string, number>;
  internalOpener?: {
    ai: { games: number; wins: number; draws: number; losses: number };
    me: { games: number; wins: number; draws: number; losses: number };
  };
  roles?: Array<{
    casts: number;
    gamesWithCast: number;
    chargesSpentHistogram: Record<string, number>;
    castTimingBins: number[];
  }>;
  [key: string]: unknown;
}

interface RawReport {
  schemaVersion: number;
  simulatorVersion: number;
  provenance: JsonRecord;
  request: {
    gamesPerCell: number;
    seeds: string[];
    castRules: CastRule[];
    modeIds: string[];
    openerRuneIds: string[];
    replyRuneIds: string[];
    factorialDesign: string;
  };
  policy: JsonRecord;
  seedDerivation: string;
  roster: RawRune[];
  modes: RawMode[];
  plan: {
    mechanicalConfigurations: number;
    cellRecords: number;
    totalGames: number;
    replicationCount: number;
    branchSensitiveRunes: string[];
  };
  cells: RawCell[];
}

interface ReplicatePayoff {
  baseSeed: string;
  games: number;
  openerWins: number;
  draws: number;
  replyWins: number;
  openerScore: number;
}

interface PooledCell {
  castRule: CastRule;
  sourceCastRule: CastRule;
  inheritedAcrossCastRules: boolean;
  modeId: string;
  openerRune: string;
  replyRune: string;
  games: number;
  openerWins: number;
  draws: number;
  replyWins: number;
  openerScore: number;
  standardError: number;
  ci95: [number, number];
  replications: ReplicatePayoff[];
  replicationSummary: {
    count: number;
    mean: number;
    standardDeviation: number | null;
    minimum: number;
    maximum: number;
  };
}

interface MatrixReport {
  rows: string[];
  columns: string[];
  values: number[][];
}

export interface AnalysisOptions {
  equilibriumIterations?: number;
}

function fail(message: string): never {
  throw new Error(`Invalid rune-matchup report: ${message}`);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as JsonRecord;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.length) fail(`${label} must be a non-empty string`);
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  const n = finite(value, label);
  if (!Number.isInteger(n) || n < minimum) fail(`${label} must be an integer >= ${minimum}`);
  return n;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const out = value.map((item, index) => stringValue(item, `${label}[${index}]`));
  if (new Set(out).size !== out.length) fail(`${label} contains duplicates`);
  return out;
}

function castRules(value: unknown, label: string): CastRule[] {
  const out = strings(value, label);
  for (const rule of out) if (rule !== 'one' && rule !== 'chain') fail(`${label} contains ${rule}`);
  return out as CastRule[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as JsonRecord)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function stableString(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function clean(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Analysis produced a non-finite number.');
  const rounded = +value.toFixed(12);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function combinations<T>(values: T[], count: number): T[][] {
  const out: T[][] = [];
  const take = (start: number, chosen: T[]) => {
    if (chosen.length === count) { out.push(chosen.slice()); return; }
    for (let index = start; index <= values.length - (count - chosen.length); index++) {
      chosen.push(values[index]);
      take(index + 1, chosen);
      chosen.pop();
    }
  };
  take(0, []);
  return out;
}

function rawCellKey(rule: CastRule, mode: string, opener: string, reply: string): string {
  return `${rule}\u0000${mode}\u0000${opener}\u0000${reply}`;
}

function treatmentKey(mode: string, opener: string, reply: string): string {
  return `${mode}\u0000${opener}\u0000${reply}`;
}

function sourceCellKey(mode: string, opener: string, reply: string): string {
  return `${mode}:${opener}->${reply}`;
}

function parseReport(value: unknown, reportIndex: number): RawReport {
  const root = record(value, `report[${reportIndex}]`);
  if (integer(root.schemaVersion, `report[${reportIndex}].schemaVersion`) !== RAW_SCHEMA_VERSION) {
    fail(`report[${reportIndex}] schemaVersion must be ${RAW_SCHEMA_VERSION}`);
  }
  const simulatorVersion = integer(root.simulatorVersion, `report[${reportIndex}].simulatorVersion`, 1);
  const provenance = record(root.provenance, `report[${reportIndex}].provenance`);
  const requestObject = record(root.request, `report[${reportIndex}].request`);
  const policy = record(root.policy, `report[${reportIndex}].policy`);
  const planObject = record(root.plan, `report[${reportIndex}].plan`);
  const request = {
    gamesPerCell: integer(requestObject.gamesPerCell, 'request.gamesPerCell', 1),
    seeds: strings(requestObject.seeds, 'request.seeds'),
    castRules: castRules(requestObject.castRules, 'request.castRules'),
    modeIds: strings(requestObject.modeIds, 'request.modeIds'),
    openerRuneIds: strings(requestObject.openerRuneIds, 'request.openerRuneIds'),
    replyRuneIds: strings(requestObject.replyRuneIds, 'request.replyRuneIds'),
    factorialDesign: stringValue(requestObject.factorialDesign, 'request.factorialDesign'),
  };
  if (!request.seeds.length || !request.castRules.length || !request.modeIds.length
      || !request.openerRuneIds.length || !request.replyRuneIds.length) {
    fail(`report[${reportIndex}] request selections must not be empty`);
  }

  if (!Array.isArray(root.roster) || !root.roster.length) fail(`report[${reportIndex}].roster must be non-empty`);
  const roster = root.roster.map((item, index) => {
    const rune = record(item, `roster[${index}]`);
    return { id: stringValue(rune.id, `roster[${index}].id`), uses: integer(rune.uses, `roster[${index}].uses`) };
  });
  if (new Set(roster.map(({ id }) => id)).size !== roster.length) fail(`report[${reportIndex}] has duplicate roster ids`);

  if (!Array.isArray(root.modes) || !root.modes.length) fail(`report[${reportIndex}].modes must be non-empty`);
  const modes = root.modes.map((item, index) => {
    const mode = record(item, `modes[${index}]`);
    const parsed = {
      id: stringValue(mode.id, `modes[${index}].id`),
      mode: integer(mode.mode, `modes[${index}].mode`),
      weight: finite(mode.weight, `modes[${index}].weight`),
    };
    if (parsed.weight <= 0) fail(`modes[${index}].weight must be positive`);
    return parsed;
  });
  if (new Set(modes.map(({ id }) => id)).size !== modes.length) fail(`report[${reportIndex}] has duplicate mode ids`);

  const plan = {
    mechanicalConfigurations: integer(planObject.mechanicalConfigurations, 'plan.mechanicalConfigurations', 1),
    cellRecords: integer(planObject.cellRecords, 'plan.cellRecords', 1),
    totalGames: integer(planObject.totalGames, 'plan.totalGames', 1),
    replicationCount: integer(planObject.replicationCount, 'plan.replicationCount', 1),
    branchSensitiveRunes: strings(planObject.branchSensitiveRunes, 'plan.branchSensitiveRunes'),
  };
  if (!Array.isArray(root.cells)) fail(`report[${reportIndex}].cells must be an array`);
  const cells = root.cells.map((item, index) => validateRawCell(
    record(item, `cells[${index}]`), simulatorVersion, request, modes, roster, reportIndex, index,
  ));
  if (cells.length !== plan.cellRecords) fail(`report[${reportIndex}] plan.cellRecords does not match cells`);
  if (cells.reduce((sum, cell) => sum + cell.games, 0) !== plan.totalGames) {
    fail(`report[${reportIndex}] plan.totalGames does not match cells`);
  }
  if (request.seeds.length !== plan.replicationCount) fail(`report[${reportIndex}] replicationCount does not match request seeds`);
  validateRequestedCoverage(cells, request, plan.branchSensitiveRunes, reportIndex);
  const mechanical = new Set(cells.map((cell) => rawCellKey(
    cell.castRule, cell.modeId, cell.openerRune, cell.replyRune,
  ))).size;
  if (mechanical !== plan.mechanicalConfigurations) {
    fail(`report[${reportIndex}] mechanicalConfigurations does not match unique treatments`);
  }

  return {
    schemaVersion: RAW_SCHEMA_VERSION, simulatorVersion, provenance, request, policy,
    seedDerivation: stringValue(root.seedDerivation, `report[${reportIndex}].seedDerivation`),
    roster, modes, plan, cells,
  };
}

function validateRawCell(
  value: JsonRecord,
  simulatorVersion: number,
  request: RawReport['request'],
  modes: RawMode[],
  roster: RawRune[],
  reportIndex: number,
  cellIndex: number,
): RawCell {
  const label = `report[${reportIndex}].cells[${cellIndex}]`;
  const castRule = stringValue(value.castRule, `${label}.castRule`);
  if (castRule !== 'one' && castRule !== 'chain') fail(`${label}.castRule is invalid`);
  const cell: RawCell = {
    ...value,
    baseSeed: stringValue(value.baseSeed, `${label}.baseSeed`),
    replication: integer(value.replication, `${label}.replication`),
    castRule,
    modeId: stringValue(value.modeId, `${label}.modeId`),
    openerRune: stringValue(value.openerRune, `${label}.openerRune`),
    replyRune: stringValue(value.replyRune, `${label}.replyRune`),
    cellSeed: stringValue(value.cellSeed, `${label}.cellSeed`),
    games: integer(value.games, `${label}.games`, 1),
    openerWins: integer(value.openerWins, `${label}.openerWins`),
    draws: integer(value.draws, `${label}.draws`),
    replyWins: integer(value.replyWins, `${label}.replyWins`),
    outcomePoints2: integer(value.outcomePoints2, `${label}.outcomePoints2`),
  };
  if (!modes.some(({ id }) => id === cell.modeId)) fail(`${label} names a mode outside its report`);
  if (!roster.some(({ id }) => id === cell.openerRune) || !roster.some(({ id }) => id === cell.replyRune)) {
    fail(`${label} names a rune outside its report roster`);
  }
  if (!request.seeds.includes(cell.baseSeed)) fail(`${label}.baseSeed is absent from request.seeds`);
  if (request.seeds[cell.replication] !== cell.baseSeed) fail(`${label}.replication does not identify baseSeed`);
  if (cell.openerWins + cell.draws + cell.replyWins !== cell.games) fail(`${label} W/D/L do not reconcile`);
  if (cell.outcomePoints2 !== 2 * cell.openerWins + cell.draws) fail(`${label}.outcomePoints2 does not reconcile`);
  const expectedSeed = `rune-matchups-v${simulatorVersion}#${cell.baseSeed}#${cell.castRule}`
    + `#${cell.modeId}#${cell.openerRune}#${cell.replyRune}`;
  if (cell.cellSeed !== expectedSeed) fail(`${label}.cellSeed does not follow the v1 derivation`);

  if (cell.terminalReasons !== undefined) {
    const terminal = record(cell.terminalReasons, `${label}.terminalReasons`);
    const total = Object.entries(terminal).reduce((sum, [key, count]) => sum + integer(count, `${label}.terminalReasons.${key}`), 0);
    if (total !== cell.games) fail(`${label}.terminalReasons do not reconcile`);
  }
  if (cell.internalOpener !== undefined) {
    const internal = record(cell.internalOpener, `${label}.internalOpener`);
    const totals = { games: 0, wins: 0, draws: 0, losses: 0 };
    for (const side of ['ai', 'me'] as const) {
      const split = record(internal[side], `${label}.internalOpener.${side}`);
      const games = integer(split.games, `${label}.internalOpener.${side}.games`);
      const wins = integer(split.wins, `${label}.internalOpener.${side}.wins`);
      const draws = integer(split.draws, `${label}.internalOpener.${side}.draws`);
      const losses = integer(split.losses, `${label}.internalOpener.${side}.losses`);
      if (wins + draws + losses !== games) fail(`${label}.internalOpener.${side} does not reconcile`);
      totals.games += games; totals.wins += wins; totals.draws += draws; totals.losses += losses;
    }
    if (totals.games !== cell.games || totals.wins !== cell.openerWins
        || totals.draws !== cell.draws || totals.losses !== cell.replyWins) {
      fail(`${label}.internalOpener does not reconcile to cell outcome totals`);
    }
  }
  if (cell.roles !== undefined) {
    if (!Array.isArray(cell.roles) || cell.roles.length !== 2) fail(`${label}.roles must be [opener, reply]`);
    for (let role = 0; role < 2; role++) {
      const aggregate = record(cell.roles[role], `${label}.roles[${role}]`);
      const casts = integer(aggregate.casts, `${label}.roles[${role}].casts`);
      integer(aggregate.gamesWithCast, `${label}.roles[${role}].gamesWithCast`);
      if (!Array.isArray(aggregate.castTimingBins) || aggregate.castTimingBins.length !== 10) {
        fail(`${label}.roles[${role}].castTimingBins must have ten bins`);
      }
      const timingCasts = aggregate.castTimingBins.reduce((sum: number, count: unknown, bin: number) =>
        sum + integer(count, `${label}.roles[${role}].castTimingBins[${bin}]`), 0);
      if (timingCasts !== casts) fail(`${label}.roles[${role}].castTimingBins do not reconcile to casts`);
      const histogram = record(aggregate.chargesSpentHistogram, `${label}.roles[${role}].chargesSpentHistogram`);
      let histogramGames = 0, histogramCasts = 0;
      for (const [rawCasts, rawCount] of Object.entries(histogram)) {
        const castCount = integer(+rawCasts, `${label}.roles[${role}].chargesSpentHistogram key`);
        const count = integer(rawCount, `${label}.roles[${role}].chargesSpentHistogram.${rawCasts}`);
        histogramGames += count; histogramCasts += castCount * count;
      }
      if (histogramGames !== cell.games || histogramCasts !== casts) {
        fail(`${label}.roles[${role}].chargesSpentHistogram does not reconcile`);
      }
    }
  }
  assertFiniteTree(cell, label);
  return cell;
}

function assertFiniteTree(value: unknown, label: string): void {
  if (typeof value === 'number' && !Number.isFinite(value)) fail(`${label} contains a non-finite number`);
  if (Array.isArray(value)) value.forEach((child, index) => assertFiniteTree(child, `${label}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as JsonRecord)) assertFiniteTree(child, `${label}.${key}`);
  }
}

function validateRequestedCoverage(
  cells: RawCell[],
  request: RawReport['request'],
  sensitiveRunes: string[],
  reportIndex: number,
): void {
  const actual = new Set<string>();
  for (const cell of cells) {
    const key = `${cell.baseSeed}\u0000${rawCellKey(cell.castRule, cell.modeId, cell.openerRune, cell.replyRune)}`;
    if (actual.has(key)) fail(`report[${reportIndex}] duplicates requested cell ${cell.cellSeed}`);
    actual.add(key);
  }
  const expected = new Set<string>();
  const reduced = request.factorialDesign === 'multi-use-reduced'
    && request.castRules.includes('one') && request.castRules.includes('chain');
  for (const seed of request.seeds) for (const mode of request.modeIds) {
    for (const opener of request.openerRuneIds) for (const reply of request.replyRuneIds) {
      const sensitive = sensitiveRunes.includes(opener) || sensitiveRunes.includes(reply);
      for (const rule of request.castRules) {
        if (reduced && rule === 'chain' && !sensitive) continue;
        expected.add(`${seed}\u0000${rawCellKey(rule, mode, opener, reply)}`);
      }
    }
  }
  if (actual.size !== expected.size || [...expected].some((key) => !actual.has(key))) {
    fail(`report[${reportIndex}] cells do not exactly cover its requested design`);
  }
}

function validateCompatibility(reports: RawReport[]): { roster: RawRune[]; modes: RawMode[]; sensitive: string[] } {
  const simulatorVersion = reports[0].simulatorVersion;
  const policy = stableString(reports[0].policy);
  const seedDerivation = reports[0].seedDerivation;
  const roster = reports[0].roster.slice().sort((a, b) => a.id.localeCompare(b.id));
  const rosterSignature = stableString(roster);
  const sourceHashes = reports[0].provenance.fileSha256;
  const modeMap = new Map<string, RawMode>();
  const sensitive = new Set<string>();
  for (let index = 0; index < reports.length; index++) {
    const report = reports[index];
    if (report.simulatorVersion !== simulatorVersion) fail(`report[${index}] simulatorVersion differs`);
    if (stableString(report.policy) !== policy) fail(`report[${index}] policy differs`);
    if (report.seedDerivation !== seedDerivation) fail(`report[${index}] seed derivation differs`);
    const candidateRoster = report.roster.slice().sort((a, b) => a.id.localeCompare(b.id));
    if (stableString(candidateRoster) !== rosterSignature) fail(`report[${index}] roster or uses differ`);
    if (sourceHashes !== undefined && report.provenance.fileSha256 !== undefined
        && stableString(report.provenance.fileSha256) !== stableString(sourceHashes)) {
      fail(`report[${index}] rule or harness source hashes differ`);
    }
    for (const id of report.plan.branchSensitiveRunes) sensitive.add(id);
    for (const mode of report.modes) {
      const prior = modeMap.get(mode.id);
      if (prior && stableString(prior) !== stableString(mode)) fail(`mode ${mode.id} differs between reports`);
      modeMap.set(mode.id, mode);
    }
  }
  if (stableString(roster.map(({ id }) => id)) !== stableString(V1_RUNES)) {
    fail(`analysis requires the complete v1 rune roster: ${V1_RUNES.join(', ')}`);
  }
  const modes = [...modeMap.values()].sort((a, b) => a.mode - b.mode || a.id.localeCompare(b.id));
  const modeIds = modes.map(({ id }) => id).sort();
  if (stableString(modeIds) !== stableString(V1_MODES)) {
    fail(`analysis requires the complete v1 mode roster: ${V1_MODES.join(', ')}`);
  }
  if (new Set(modes.map(({ mode }) => mode)).size !== modes.length) fail('v1 mode numeric values must be unique');
  for (const rune of roster) if (rune.uses > 1) sensitive.add(rune.id);
  return { roster, modes, sensitive: [...sensitive].sort() };
}

function poolCells(
  records: RawCell[], effectiveRule: CastRule, sourceRule: CastRule, inherited: boolean,
): PooledCell {
  const sorted = records.slice().sort((a, b) => a.baseSeed.localeCompare(b.baseSeed));
  let games = 0, openerWins = 0, draws = 0, replyWins = 0;
  const replications = sorted.map((cell): ReplicatePayoff => {
    games += cell.games; openerWins += cell.openerWins; draws += cell.draws; replyWins += cell.replyWins;
    return {
      baseSeed: cell.baseSeed, games: cell.games, openerWins: cell.openerWins,
      draws: cell.draws, replyWins: cell.replyWins,
      openerScore: clean(cell.outcomePoints2 / (2 * cell.games)),
    };
  });
  const score = (openerWins + 0.5 * draws) / games;
  const squaredSum = openerWins + 0.25 * draws;
  const varianceOfMean = games > 1
    ? Math.max(0, (squaredSum - games * score ** 2) / (games * (games - 1))) : 0;
  const standardError = Math.sqrt(varianceOfMean);
  const scores = replications.map(({ openerScore }) => openerScore);
  const sd = standardDeviation(scores);
  return {
    castRule: effectiveRule, sourceCastRule: sourceRule, inheritedAcrossCastRules: inherited,
    modeId: sorted[0].modeId, openerRune: sorted[0].openerRune, replyRune: sorted[0].replyRune,
    games, openerWins, draws, replyWins,
    openerScore: clean(score), standardError: clean(standardError),
    ci95: [clean(Math.max(0, score - 1.96 * standardError)), clean(Math.min(1, score + 1.96 * standardError))],
    replications,
    replicationSummary: {
      count: scores.length, mean: clean(mean(scores)), standardDeviation: sd === null ? null : clean(sd),
      minimum: clean(Math.min(...scores)), maximum: clean(Math.max(...scores)),
    },
  };
}

function matrix(runes: string[], get: (row: string, column: string) => number): MatrixReport {
  return { rows: runes.slice(), columns: runes.slice(), values: runes.map((row) =>
    runes.map((column) => clean(get(row, column)))) };
}

function analyzeBranch(
  rule: CastRule,
  modes: RawMode[],
  runes: string[],
  sensitive: Set<string>,
  rawGroups: Map<string, RawCell[]>,
  equilibriumIterations: number,
) {
  const effective = new Map<string, PooledCell>();
  const missing: string[] = [];
  let expectedSeeds: string[] | null = null;
  for (const mode of modes) for (const opener of runes) for (const reply of runes) {
    let sourceRule = rule;
    let records = rawGroups.get(rawCellKey(rule, mode.id, opener, reply));
    let inherited = false;
    if (!records && rule === 'chain' && !sensitive.has(opener) && !sensitive.has(reply)) {
      sourceRule = 'one';
      records = rawGroups.get(rawCellKey('one', mode.id, opener, reply));
      inherited = !!records;
    }
    if (!records) { missing.push(sourceCellKey(mode.id, opener, reply)); continue; }
    const seeds = records.map(({ baseSeed }) => baseSeed).sort();
    if (!expectedSeeds) expectedSeeds = seeds;
    else if (stableString(seeds) !== stableString(expectedSeeds)) {
      fail(`${rule} branch does not have the same independent replicate seeds in every treatment`);
    }
    effective.set(treatmentKey(mode.id, opener, reply), poolCells(records, rule, sourceRule, inherited));
  }
  if (missing.length) fail(`${rule} branch is missing ${missing.length} treatments; first is ${missing[0]}`);

  const getCell = (mode: string, opener: string, reply: string): PooledCell => {
    const found = effective.get(treatmentKey(mode, opener, reply));
    if (!found) throw new Error(`Internal missing cell ${mode}:${opener}->${reply}`);
    return found;
  };
  const q = (mode: string, first: string, second: string): number => {
    if (first === second) return 0.5;
    return 0.5 * (getCell(mode, first, second).openerScore + 1 - getCell(mode, second, first).openerScore);
  };
  const qVariance = (mode: string, first: string, second: string): number => {
    if (first === second) return 0;
    return 0.25 * (getCell(mode, first, second).standardError ** 2
      + getCell(mode, second, first).standardError ** 2);
  };
  const openerEffect = (mode: string, first: string, second: string): number =>
    0.5 * (getCell(mode, first, second).openerScore + getCell(mode, second, first).openerScore) - 0.5;
  const totalWeight = modes.reduce((sum, mode) => sum + mode.weight, 0);
  const weights = new Map(modes.map((mode) => [mode.id, mode.weight / totalWeight]));
  const weightedQ = (first: string, second: string): number => modes.reduce((sum, mode) =>
    sum + weights.get(mode.id)! * q(mode.id, first, second), 0);
  const weightedQVariance = (first: string, second: string): number => modes.reduce((sum, mode) =>
    sum + weights.get(mode.id)! ** 2 * qVariance(mode.id, first, second), 0);
  const uniform = 1 / runes.length;
  const strengthMap = new Map<string, number>();
  for (const rune of runes) strengthMap.set(rune,
    runes.reduce((sum, foe) => sum + uniform * weightedQ(rune, foe), 0));

  const modeReports = modes.map((mode) => ({
    id: mode.id,
    weight: mode.weight,
    normalizedWeight: clean(weights.get(mode.id)!),
    uniformOpenerScore: clean(runes.reduce((sum, opener) => sum + runes.reduce((inner, reply) =>
      inner + getCell(mode.id, opener, reply).openerScore / (runes.length ** 2), 0), 0)),
    oriented: matrix(runes, (opener, reply) => getCell(mode.id, opener, reply).openerScore),
    seatNeutral: matrix(runes, (first, second) => q(mode.id, first, second)),
    openerEffect: matrix(runes, (first, second) => openerEffect(mode.id, first, second)),
  }));

  const strengths = runes.map((rune) => {
    const score = strengthMap.get(rune)!;
    const variance = runes.reduce((sum, foe) => sum + uniform ** 2 * weightedQVariance(rune, foe), 0);
    const se = Math.sqrt(variance);
    const openScore = modes.reduce((modeSum, mode) => modeSum + weights.get(mode.id)! *
      runes.reduce((sum, foe) => sum + uniform * getCell(mode.id, rune, foe).openerScore, 0), 0);
    const replyScore = modes.reduce((modeSum, mode) => modeSum + weights.get(mode.id)! *
      runes.reduce((sum, foe) => sum + uniform * (1 - getCell(mode.id, foe, rune).openerScore), 0), 0);
    const modeStrengths = modes.map((mode) => ({
      modeId: mode.id,
      score: clean(runes.reduce((sum, foe) => sum + uniform * q(mode.id, rune, foe), 0)),
    }));
    const worstWheel = runes.map((foe) => ({ foe, score: weightedQ(rune, foe) }))
      .sort((a, b) => a.score - b.score || a.foe.localeCompare(b.foe))[0];
    const worstDistinctWheel = runes.filter((foe) => foe !== rune)
      .map((foe) => ({ foe, score: weightedQ(rune, foe) }))
      .sort((a, b) => a.score - b.score || a.foe.localeCompare(b.foe))[0];
    const worstCell = modes.flatMap((mode) => runes.map((foe) =>
      ({ modeId: mode.id, foe, score: q(mode.id, rune, foe) })))
      .sort((a, b) => a.score - b.score || a.modeId.localeCompare(b.modeId) || a.foe.localeCompare(b.foe))[0];
    const modeSd = Math.sqrt(modeStrengths.reduce((sum, item) =>
      sum + weights.get(item.modeId)! * (item.score - score) ** 2, 0));
    return {
      rune, uniformPopulationStrength: clean(score), standardError: clean(se),
      ci95: [clean(Math.max(0, score - 1.96 * se)), clean(Math.min(1, score + 1.96 * se))],
      openerScore: clean(openScore), replyScore: clean(replyScore),
      openerMinusReply: clean(openScore - replyScore),
      modeStandardDeviation: clean(modeSd), modeStrengths,
      worstWheelMatchupIncludingMirror: { rune: worstWheel.foe, score: clean(worstWheel.score) },
      worstDistinctWheelMatchup: { rune: worstDistinctWheel.foe, score: clean(worstDistinctWheel.score) },
      worstModeMatchup: { modeId: worstCell.modeId, rune: worstCell.foe, score: clean(worstCell.score) },
    };
  });

  const pairs = combinations(runes, 2).map(([first, second]) => {
    const wheelScore = weightedQ(first, second);
    const signedEdge = wheelScore - 0.5;
    const modeValues = modes.map((mode) => ({ modeId: mode.id, score: q(mode.id, first, second) }));
    const experienced = modeValues.reduce((sum, item) =>
      sum + weights.get(item.modeId)! * Math.abs(item.score - 0.5), 0);
    const sorted = modeValues.slice().sort((a, b) => a.score - b.score || a.modeId.localeCompare(b.modeId));
    const minimum = sorted[0], maximum = sorted[sorted.length - 1];
    return {
      runes: [first, second], firstRuneWheelScore: clean(wheelScore), signedEdge: clean(signedEdge),
      modeWeightedAbsoluteEdge: clean(experienced),
      modeWeightedAbsoluteEdgeMinusAbsoluteWheelEdge: clean(experienced - Math.abs(signedEdge)),
      minimumModeScore: clean(minimum.score), maximumModeScore: clean(maximum.score),
      modeRange: clean(maximum.score - minimum.score), pointSignReversal: minimum.score < 0.5 && maximum.score > 0.5,
      worstModeForFirstRune: minimum.modeId,
      additiveStrengthResidual: clean(signedEdge - (strengthMap.get(first)! - strengthMap.get(second)!)),
      modeScores: modeValues.map((item) => ({ modeId: item.modeId, score: clean(item.score) })),
    };
  });
  const allStrengths = strengths.map(({ uniformPopulationStrength }) => uniformPopulationStrength);
  const weightedMatrix = matrix(runes, weightedQ);
  const weightedDominance = pureDominance(weightedMatrix.values, runes);
  const weightedSaddles = pureSaddles(weightedMatrix.values, runes);
  const weightedEquilibrium = approximateZeroSum(weightedMatrix.values, runes, equilibriumIterations);
  const populationPolarization = runes.reduce((outer, first) => outer + runes.reduce((inner, second) =>
    inner + uniform ** 2 * modes.reduce((modeSum, mode) => modeSum
      + weights.get(mode.id)! * Math.abs(q(mode.id, first, second) - 0.5), 0), 0), 0);
  const precommitPolarization = runes.reduce((outer, first) => outer + runes.reduce((inner, second) =>
    inner + uniform ** 2 * Math.abs(weightedQ(first, second) - 0.5), 0), 0);

  const classic = modes.find(({ id }) => id === 'classic')!;
  const trial = analyzeTrial(classic.id, runes, getCell, equilibriumIterations);
  return {
    castRule: rule,
    replicationSeeds: expectedSeeds,
    effectiveCellCount: effective.size,
    inheritedInvariantCellCount: [...effective.values()].filter(({ inheritedAcrossCastRules }) => inheritedAcrossCastRules).length,
    orientedCells: [...effective.values()].sort((a, b) => {
      const ma = modes.findIndex(({ id }) => id === a.modeId), mb = modes.findIndex(({ id }) => id === b.modeId);
      return ma - mb || a.openerRune.localeCompare(b.openerRune) || a.replyRune.localeCompare(b.replyRune);
    }),
    modes: modeReports,
    weighted: {
      population: { kind: 'uniform', shares: Object.fromEntries(runes.map((rune) => [rune, clean(uniform)])) },
      seatNeutral: weightedMatrix,
      selectionGame: {
        interpretation: 'Simultaneous fixed-rune precommit against the ranked mode wheel, using the seat-neutral payoff matrix.',
        pointEstimatePureDominance: {
          rowChooser: weightedDominance.opener,
          columnChooser: weightedDominance.reply,
        },
        pointEstimatePureSaddles: weightedSaddles,
        pointEstimateSaddleClassification: weightedSaddles.length ? 'has-pure-saddle' : 'mixed-or-cyclic',
        approximateMwProfile: weightedEquilibrium,
      },
      strengths,
      strengthSpread: clean(Math.max(...allStrengths) - Math.min(...allStrengths)),
      pairs,
      uniformPopulationModeAverageAbsoluteEdgeIncludingMirrors: clean(populationPolarization),
      uniformPopulationModeAverageAbsoluteEdgeConditionalOnDifferentRunes:
        clean(populationPolarization / (1 - uniform)),
      uniformPopulationPrecommitAbsoluteEdgeIncludingMirrors: clean(precommitPolarization),
    },
    trial,
  };
}

function analyzeTrial(
  classicMode: string,
  runes: string[],
  getCell: (mode: string, opener: string, reply: string) => PooledCell,
  iterations: number,
) {
  const offers = combinations(runes, 3).map((offer) => {
    const payoff = offer.map((opener) => offer.map((reply) => getCell(classicMode, opener, reply).openerScore));
    const dominance = pureDominance(payoff, offer);
    const saddles = pureSaddles(payoff, offer);
    const approximateMwProfile = approximateZeroSum(payoff, offer, iterations);
    return {
      id: offer.join('+'), runes: offer, payoff: matrix(offer, (opener, reply) =>
        getCell(classicMode, opener, reply).openerScore),
      sourceCells: offer.flatMap((opener) => offer.map((reply) => sourceCellKey(classicMode, opener, reply))),
      pointEstimatePureDominance: dominance,
      pointEstimatePureSaddles: saddles,
      pointEstimateSaddleClassification: saddles.length ? 'has-pure-saddle' : 'mixed-or-cyclic',
      approximateMwProfile,
    };
  });
  const offerWeight = 1 / offers.length;
  const openerShares = Object.fromEntries(runes.map((rune) => [rune, clean(offers.reduce((sum, offer) => {
    const at = offer.runes.indexOf(rune);
    return sum + (at < 0 ? 0 : offerWeight * offer.approximateMwProfile.openerTimeAverageMix[at]);
  }, 0))]));
  const replyShares = Object.fromEntries(runes.map((rune) => [rune, clean(offers.reduce((sum, offer) => {
    const at = offer.runes.indexOf(rune);
    return sum + (at < 0 ? 0 : offerWeight * offer.approximateMwProfile.replyTimeAverageMix[at]);
  }, 0))]));
  const uniquePureSaddles = offers.every(({ pointEstimatePureSaddles }) => pointEstimatePureSaddles.length === 1);
  const exactPureSaddleProfile = uniquePureSaddles ? {
    interpretation: 'Unique-pure-saddle selection convention for the point-estimate offer games; not a human-choice forecast or proof about the uncertain true game.',
    meanOpenerValue: clean(offers.reduce((sum, offer) =>
      sum + offerWeight * offer.pointEstimatePureSaddles[0].payoff, 0)),
    mirrorProbability: clean(offers.reduce((sum, offer) =>
      sum + offerWeight * (offer.pointEstimatePureSaddles[0].mirror ? 1 : 0), 0)),
    openerRuneShares: Object.fromEntries(runes.map((rune) => [rune, clean(offers.reduce((sum, offer) =>
      sum + offerWeight * (offer.pointEstimatePureSaddles[0].openerRune === rune ? 1 : 0), 0))])),
    replyRuneShares: Object.fromEntries(runes.map((rune) => [rune, clean(offers.reduce((sum, offer) =>
      sum + offerWeight * (offer.pointEstimatePureSaddles[0].replyRune === rune ? 1 : 0), 0))])),
  } : null;
  return {
    boardRule: 'classic-backed',
    offerDistribution: 'uniform over 20 three-of-six offers',
    offerCount: offers.length,
    orderedOfferChoiceContexts: offers.length * 9,
    underlyingMechanicalCellCount: runes.length ** 2,
    dependency: 'Every offer references the same pooled 36 Classic opener-oriented cells; 180 contexts are not independent samples.',
    approximateMwMethod: offers[0].approximateMwProfile.method,
    aggregate: {
      pointEstimateGameTheory: {
        offersWithPureSaddle: offers.filter(({ pointEstimatePureSaddles }) => pointEstimatePureSaddles.length).length,
        offersWithExactlyOnePureSaddle: offers.filter(({ pointEstimatePureSaddles }) => pointEstimatePureSaddles.length === 1).length,
        offersWithMirrorPureSaddle: offers.filter(({ pointEstimatePureSaddles }) =>
          pointEstimatePureSaddles.some(({ mirror }) => mirror)).length,
        offersWithOffDiagonalPureSaddle: offers.filter(({ pointEstimatePureSaddles }) =>
          pointEstimatePureSaddles.some(({ mirror }) => !mirror)).length,
        offersWithStrictlyDominatedOpenerChoice: offers.filter(({ pointEstimatePureDominance }) =>
          pointEstimatePureDominance.opener.some(({ strictDominators }) => strictDominators.length)).length,
        offersWithStrictlyDominatedReplyChoice: offers.filter(({ pointEstimatePureDominance }) =>
          pointEstimatePureDominance.reply.some(({ strictDominators }) => strictDominators.length)).length,
        uniquePureSaddleSelection: exactPureSaddleProfile,
      },
      approximateMwDiagnostics: {
        interpretation: 'Finite-iteration time-average diagnostic, not an equilibrium prediction; may retain mass on strictly dominated choices.',
        method: offers[0].approximateMwProfile.method,
        meanBoundsMidpoint: clean(offers.reduce((sum, offer) =>
          sum + offerWeight * offer.approximateMwProfile.boundsMidpoint, 0)),
        meanTimeAverageProfilePayoff: clean(offers.reduce((sum, offer) =>
          sum + offerWeight * offer.approximateMwProfile.timeAverageProfilePayoff, 0)),
        meanIndependentTimeAverageProfileMirrorProbability: clean(offers.reduce((sum, offer) =>
          sum + offerWeight * offer.approximateMwProfile.independentTimeAverageProfileMirrorProbability, 0)),
        openerTimeAverageShares: openerShares,
        replyTimeAverageShares: replyShares,
        maximumPrimalDualGap: clean(Math.max(...offers.map(({ approximateMwProfile }) =>
          approximateMwProfile.primalDualGap))),
      },
    },
    offers,
  };
}

function pureDominance(payoff: number[][], runes: string[]) {
  const opener = runes.map((rune, target) => {
    const candidates = runes.flatMap((alternative, other) => {
      if (other === target) return [];
      const differences = payoff[other].map((value, column) => value - payoff[target][column]);
      const minimum = Math.min(...differences);
      return [{ alternative, minimum, strict: differences.every((value) => value > EPSILON),
        weak: differences.every((value) => value >= -EPSILON) && differences.some((value) => value > EPSILON) }];
    });
    return {
      rune,
      strictDominators: candidates.filter(({ strict }) => strict).map(({ alternative }) => alternative),
      weakDominators: candidates.filter(({ weak }) => weak).map(({ alternative }) => alternative),
      bestPureDominanceMargin: clean(Math.max(...candidates.map(({ minimum }) => minimum))),
    };
  });
  const reply = runes.map((rune, target) => {
    const candidates = runes.flatMap((alternative, other) => {
      if (other === target) return [];
      const differences = payoff.map((row) => row[target] - row[other]);
      const minimum = Math.min(...differences);
      return [{ alternative, minimum, strict: differences.every((value) => value > EPSILON),
        weak: differences.every((value) => value >= -EPSILON) && differences.some((value) => value > EPSILON) }];
    });
    return {
      rune,
      strictDominators: candidates.filter(({ strict }) => strict).map(({ alternative }) => alternative),
      weakDominators: candidates.filter(({ weak }) => weak).map(({ alternative }) => alternative),
      bestPureDominanceMargin: clean(Math.max(...candidates.map(({ minimum }) => minimum))),
    };
  });
  return { opener, reply };
}

function pureSaddles(payoff: number[][], runes: string[]) {
  const out: Array<{
    openerRune: string;
    replyRune: string;
    mirror: boolean;
    payoff: number;
    openerDeviationMargin: number;
    replyDeviationMargin: number;
    minimumDeviationMargin: number;
  }> = [];
  for (let row = 0; row < runes.length; row++) for (let column = 0; column < runes.length; column++) {
    const value = payoff[row][column];
    const rowBestResponds = payoff.every((candidate) => value >= candidate[column] - EPSILON);
    const columnBestResponds = payoff[row].every((candidate) => value <= candidate + EPSILON);
    if (rowBestResponds && columnBestResponds) {
      const openerAlternatives = payoff.flatMap((candidate, candidateRow) =>
        candidateRow === row ? [] : [candidate[column]]);
      const replyAlternatives = payoff[row].filter((_, candidateColumn) => candidateColumn !== column);
      const openerDeviationMargin = value - Math.max(...openerAlternatives);
      const replyDeviationMargin = Math.min(...replyAlternatives) - value;
      out.push({
        openerRune: runes[row], replyRune: runes[column], mirror: row === column,
        payoff: clean(value),
        openerDeviationMargin: clean(openerDeviationMargin),
        replyDeviationMargin: clean(replyDeviationMargin),
        minimumDeviationMargin: clean(Math.min(openerDeviationMargin, replyDeviationMargin)),
      });
    }
  }
  return out;
}

export function approximateZeroSum(payoff: number[][], runes: string[], iterations = DEFAULT_EQUILIBRIUM_ITERATIONS) {
  if (!Number.isInteger(iterations) || iterations < 1_000) throw new Error('Equilibrium iterations must be an integer >= 1000.');
  const size = runes.length;
  if (!size || payoff.length !== size || payoff.some((row) => row.length !== size)) {
    throw new Error('Zero-sum payoff matrix must be square and match its rune labels.');
  }
  const learningRate = Math.sqrt(2 * Math.log(size) / iterations);
  let opener = Array.from({ length: size }, () => 1 / size);
  let reply = Array.from({ length: size }, () => 1 / size);
  const openerAverage = Array.from({ length: size }, () => 0);
  const replyAverage = Array.from({ length: size }, () => 0);
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let index = 0; index < size; index++) {
      openerAverage[index] += opener[index]; replyAverage[index] += reply[index];
    }
    const rowPayoffs = payoff.map((row) => row.reduce((sum, value, column) => sum + value * reply[column], 0));
    const columnPayoffs = Array.from({ length: size }, (_, column) =>
      payoff.reduce((sum, row, rowIndex) => sum + opener[rowIndex] * row[column], 0));
    const maxRow = Math.max(...rowPayoffs), minColumn = Math.min(...columnPayoffs);
    const nextOpener = opener.map((weight, index) => weight * Math.exp(learningRate * (rowPayoffs[index] - maxRow)));
    const nextReply = reply.map((weight, index) => weight * Math.exp(-learningRate * (columnPayoffs[index] - minColumn)));
    const openerTotal = nextOpener.reduce((sum, value) => sum + value, 0);
    const replyTotal = nextReply.reduce((sum, value) => sum + value, 0);
    opener = nextOpener.map((value) => value / openerTotal);
    reply = nextReply.map((value) => value / replyTotal);
  }
  const p = openerAverage.map((value) => value / iterations);
  const q = replyAverage.map((value) => value / iterations);
  const rowAgainstQ = payoff.map((row) => row.reduce((sum, value, column) => sum + value * q[column], 0));
  const columnAgainstP = Array.from({ length: size }, (_, column) =>
    payoff.reduce((sum, row, rowIndex) => sum + p[rowIndex] * row[column], 0));
  const lower = Math.min(...columnAgainstP), upper = Math.max(...rowAgainstQ);
  const profilePayoff = p.reduce((sum, probability, row) => sum + probability
    * payoff[row].reduce((inner, value, column) => inner + value * q[column], 0), 0);
  const entropy = (strategy: number[]) => -strategy.reduce((sum, probability) =>
    probability > 0 ? sum + probability * Math.log(probability) : sum, 0);
  return {
    method: `deterministic multiplicative-weights time-average (${iterations} iterations); approximate point strategies, not equilibrium-polytope ranges`,
    iterations,
    learningRate: clean(learningRate),
    openerTimeAverageMix: p.map(clean),
    replyTimeAverageMix: q.map(clean),
    guaranteedPayoffLowerBound: clean(lower),
    bestResponseUpperBound: clean(upper),
    timeAverageProfilePayoff: clean(profilePayoff),
    boundsMidpoint: clean((lower + upper) / 2),
    primalDualGap: clean(upper - lower),
    independentTimeAverageProfileMirrorProbability:
      clean(p.reduce((sum, probability, index) => sum + probability * q[index], 0)),
    openerEffectiveChoices: clean(Math.exp(entropy(p))),
    replyEffectiveChoices: clean(Math.exp(entropy(q))),
    openerPureChoiceRegret: Object.fromEntries(runes.map((rune, index) => [rune, clean(upper - rowAgainstQ[index])])),
    replyPureChoiceRegret: Object.fromEntries(runes.map((rune, index) => [rune, clean(columnAgainstP[index] - lower)])),
  };
}

export function analyzeRuneMatchupReports(values: unknown[], options: AnalysisOptions = {}) {
  if (!values.length) throw new Error('At least one raw report is required.');
  const equilibriumIterations = options.equilibriumIterations ?? DEFAULT_EQUILIBRIUM_ITERATIONS;
  if (!Number.isInteger(equilibriumIterations) || equilibriumIterations < 1_000) {
    throw new Error('equilibriumIterations must be an integer >= 1000.');
  }
  const reports = values.map(parseReport);
  const compatible = validateCompatibility(reports);
  const runes = compatible.roster.map(({ id }) => id).sort();
  const rawGroups = new Map<string, RawCell[]>();
  const seenSeeds = new Set<string>();
  for (const report of reports) for (const cell of report.cells) {
    if (seenSeeds.has(cell.cellSeed)) fail(`duplicate cellSeed ${cell.cellSeed} would double-count a replication`);
    seenSeeds.add(cell.cellSeed);
    const key = rawCellKey(cell.castRule, cell.modeId, cell.openerRune, cell.replyRune);
    const group = rawGroups.get(key) ?? [];
    if (group.some(({ baseSeed }) => baseSeed === cell.baseSeed)) fail(`duplicate baseSeed in treatment ${cell.cellSeed}`);
    group.push(cell); rawGroups.set(key, group);
  }
  const rawRules = new Set<CastRule>();
  for (const report of reports) for (const cell of report.cells) rawRules.add(cell.castRule);
  const branches = [...rawRules].sort((a, b) => a === b ? 0 : a === 'one' ? -1 : 1)
    .map((rule) => analyzeBranch(
      rule, compatible.modes, runes, new Set(compatible.sensitive), rawGroups, equilibriumIterations,
    ));
  return {
    schemaVersion: 1,
    analysisVersion: ANALYSIS_VERSION,
    source: {
      rawSchemaVersion: RAW_SCHEMA_VERSION,
      simulatorVersion: reports[0].simulatorVersion,
      sourceReportCount: reports.length,
      rawCellRecordCount: reports.reduce((sum, report) => sum + report.cells.length, 0),
      uniqueCellSeedCount: seenSeeds.size,
      policy: stableValue(reports[0].policy),
      seedDerivation: reports[0].seedDerivation,
    },
    validation: {
      complete: true,
      checks: [
        'v1 schemas and requested designs reconcile',
        'W/D/L and doubled outcome numerators reconcile',
        'cell seeds are unique and follow the v1 derivation',
        'terminal, internal-opener, cast histogram and timing-bin aggregates reconcile when present',
        'policy, roster, uses, seed derivation and overlapping mode definitions are compatible',
        'every analyzed branch has every mode/rune/opener treatment and one common replicate-seed set',
      ],
      modes: compatible.modes,
      roster: compatible.roster,
      branchSensitiveRunes: compatible.sensitive,
    },
    identities: {
      oriented: 'O_m(i,j) is opener rune i score against reply rune j; draws score 0.5.',
      seatNeutral: 'Q_m(i,j)=0.5*[O_m(i,j)+1-O_m(j,i)].',
      openerEffect: 'A_m(i,j)=0.5*[O_m(i,j)+O_m(j,i)]-0.5.',
      uncertainty: 'Unadjusted fixed-policy IID Monte Carlo normal approximations; no multiple-comparison, bootstrap, policy-model, or human-strategy uncertainty is included.',
    },
    branches,
  };
}

function help(): string {
  return `Usage: node --experimental-strip-types tools/rune-matchup-analysis.ts [options] report.json [report-2.json ...]

Options:
  --output PATH                    write JSON here; otherwise stdout
  --equilibrium-iterations N       deterministic approximation iterations, default ${DEFAULT_EQUILIBRIUM_ITERATIONS}
  --help                           show this help`;
}

async function main() {
  if (process.argv.includes('--help')) { console.log(help()); return; }
  let output: string | undefined;
  let equilibriumIterations = DEFAULT_EQUILIBRIUM_ITERATIONS;
  const inputs: string[] = [];
  for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index];
    if (argument === '--output') output = process.argv[++index];
    else if (argument === '--equilibrium-iterations') equilibriumIterations = +(process.argv[++index] ?? '');
    else if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`);
    else inputs.push(argument);
  }
  if (!inputs.length) throw new Error('At least one raw report path is required.');
  const reports = inputs.map((file) => JSON.parse(readFileSync(file, 'utf8')) as unknown);
  const analysis = analyzeRuneMatchupReports(reports, { equilibriumIterations });
  const json = JSON.stringify(analysis, null, 2) + '\n';
  if (output) {
    const target = path.resolve(output);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, json);
  } else process.stdout.write(json);
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
