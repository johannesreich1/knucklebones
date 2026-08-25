// Focused contract for tools/rune-ward-sensitivity.ts.
// Run: node --experimental-strip-types tests/rune-ward-sensitivity.test.ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AI, type GameState, type Player } from '../src/core/rules.ts';
import { SPELLS } from '../src/core/spells.ts';
import {
  DEFAULT_SEEDS, FROZEN_MATCHUP_SHA256, WARD_SENSITIVITY_VERSION,
  attachBaseline, parseWardSensitivityCli, planWardSensitivity,
  playWardSensitivityGame, runWardSensitivity,
  type WardSensitivityReport,
} from '../tools/rune-ward-sensitivity.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, details?: unknown) => {
  if (!condition) problems.push(message + (details === undefined ? '' : ` :: ${JSON.stringify(details)}`));
};
const throws = (fn: () => unknown, message: string) => {
  try { fn(); problems.push(`${message} :: did not throw`); } catch { /* expected */ }
};

/* ---- exact targeted plan and fixed defaults ---- */
{
  const planned = planWardSensitivity();
  check(planned.length === 52, 'four defaults produce 52 separate cell records', planned.length);
  check(new Set(planned.map((cell) => cell.baseSeed)).size === 4
    && DEFAULT_SEEDS.every((seed) => planned.some((cell) => cell.baseSeed === seed)),
  'the four final-study seeds remain explicit');
  check(planned.every((cell) => cell.modeId === 'colshield'), 'every cell is COLUMN SHIELD');
  const firstReplication = planned.filter((cell) => cell.replication === 0);
  const one = firstReplication.filter((cell) => cell.castRule === 'one');
  const chain = firstReplication.filter((cell) => cell.castRule === 'chain');
  check(one.length === 11 && new Set(one.map((cell) => `${cell.openerRune}->${cell.replyRune}`)).size === 11,
    'one-cast scope is exactly 11 directed WARD-containing cells', one);
  check(one.every((cell) => cell.openerRune === 'ward' || cell.replyRune === 'ward'),
    'every one-cast cell contains WARD');
  check(chain.length === 2
    && chain.some((cell) => cell.openerRune === 'fate' && cell.replyRune === 'ward')
    && chain.some((cell) => cell.openerRune === 'ward' && cell.replyRune === 'fate'),
  'chain scope is exactly the two directed FATE/WARD cells', chain);
  check(new Set(planned.map((cell) => `${cell.baseSeed}:${cell.castRule}:${cell.openerRune}:${cell.replyRune}`)).size === 52,
    'every planned cell identity is unique');
  throws(() => planWardSensitivity([]), 'empty seed list fails closed');
  throws(() => planWardSensitivity(['same', 'same']), 'duplicate replications fail closed');
}

/* ---- scripted production-Normal coordinator outcomes ---- */
{
  const cell = {
    baseSeed: 'scripted', replication: 0, castRule: 'one' as const,
    modeId: 'colshield' as const, openerRune: 'ward', replyRune: 'nudge',
  };
  /* WARD chooses own column 0: [6,6] is worth 24 and the foe can still strike
     it. In v2, filling it is allowed rather than vetoed. Column 2 remains the
     contrasting alternative. The foe is one placement from a terminal board,
     keeping each script to exactly one coordinated turn. */
  const initialState: GameState = [
    [[6, 6], [1, 2, 3], [1, 2]],
    [[1, 2], [1, 2, 3], [1, 2, 3]],
  ];
  const scripted = (aiChoices: number[]) => {
    const choices = aiChoices.slice();
    const supply = [5, 6];
    return playWardSensitivityGame(cell, 0, {
      openerPlayer: AI,
      initialState,
      endlessDraw: () => supply.shift() ?? 6,
      placementDecision: (st: GameState, who: Player) => who === AI ? (choices.shift() ?? 2) : 0,
    });
  };

  const recurs = scripted([2, 0]);
  check(recurs.coordination[0].hazardPreviews === 1
    && recurs.coordination[0].hazardousSuccessfulCasts === 1
    && recurs.coordination[0].vetoes === 0
    && recurs.coordination[0].previewFinalDivergences === 1
    && recurs.coordination[0].immediateRedundantPlacements === 0
    && recurs.game.casts[0].length === 1,
  'projected preview may diverge from final completion without making WARD redundant', recurs);

  const completion = scripted([0, 2]);
  check(completion.coordination[0].hazardPreviews === 1
    && completion.coordination[0].vetoes === 0
    && completion.coordination[0].hazardousSuccessfulCasts === 1
    && completion.coordination[0].immediateRedundantPlacements === 0
    && completion.coordination[0].previewFinalComparisons === 1
    && completion.game.casts[0].length === 1,
  'projected completion preview keeps the WARD cast and records no obsolete veto', completion);

  const remainsSafe = scripted([2, 2]);
  check(remainsSafe.coordination[0].hazardPreviews === 1
    && remainsSafe.coordination[0].hazardousSuccessfulCasts === 1
    && remainsSafe.coordination[0].previewFinalDivergences === 0
    && remainsSafe.coordination[0].immediateRedundantPlacements === 0
    && remainsSafe.game.casts[0].length === 1,
  'matching safe preview/final placement retains a useful WARD', remainsSafe);

  check([recurs, completion, remainsSafe].every((result) =>
    result.coordination[1].hazardPreviews === 0
    && result.game.terminalReason === 'board-full'
    && result.game.placements === 2),
  'scripted games isolate coordination to the WARD opener and terminate cleanly');
}

/* ---- deterministic run plus raw reconciliation ---- */
let deterministicReport: WardSensitivityReport;
{
  const options = { games: 2, seeds: ['focused'], provenance: { test: true } };
  deterministicReport = runWardSensitivity(options);
  const rerun = runWardSensitivity(options);
  check(JSON.stringify(deterministicReport) === JSON.stringify(rerun),
    'the same targeted request reruns byte-identically');
  check(WARD_SENSITIVITY_VERSION === 2 && deterministicReport.instrumentVersion === 2
    && deterministicReport.cells.every((cell) => cell.treatmentCellId.startsWith('rune-ward-sensitivity-v2#')),
  'the changed projected-WARD treatment is explicitly versioned as instrument v2');
  check(deterministicReport.plan.mechanicalConfigurations === 13
    && deterministicReport.plan.oneCastConfigurations === 11
    && deterministicReport.plan.chainConfigurations === 2
    && deterministicReport.plan.cellRecords === 13
    && deterministicReport.plan.totalGames === 26,
  'report plan reconciles configurations, records, and games', deterministicReport.plan);

  const originalRandom = Math.random;
  Math.random = () => { throw new Error('ambient Math.random reached'); };
  try { runWardSensitivity({ games: 1, seeds: ['no-ambient-random'] }); }
  catch (error) { problems.push(`simulation reached ambient Math.random :: ${String(error)}`); }
  finally { Math.random = originalRandom; }

  for (const cell of deterministicReport.cells) {
    check(cell.openerWins + cell.draws + cell.replyWins === cell.games,
      'cell W/D/L reconciles', cell);
    check(cell.outcomePoints2 === 2 * cell.openerWins + cell.draws,
      'cell doubled outcome reconciles', cell);
    check(cell.marginSum === cell.openerScoreSum - cell.replyScoreSum,
      'cell margin reconciles to scores', cell);
    check(Object.values(cell.terminalReasons).reduce((sum, count) => sum + count, 0) === cell.games,
      'cell terminal reasons reconcile', cell.terminalReasons);
    check(cell.internalOpener.ai.games === 1 && cell.internalOpener.me.games === 1,
      'core identities alternate within each directed cell', cell.internalOpener);
    for (let role = 0 as 0 | 1; role < 2; role = (role + 1) as 0 | 1) {
      const aggregate = cell.roles[role];
      const runeId = role === 0 ? cell.openerRune : cell.replyRune;
      const uses = SPELLS.find((candidate) => candidate.id === runeId)!.uses;
      check(aggregate.casts + aggregate.unusedCharges === cell.games * uses,
        'casts plus unused charges reconcile to registry supply', { cell, role });
      check(aggregate.immediateSwingCount === aggregate.casts,
        'every cast contributes one frozen-v1 immediate swing', { cell, role });
      check(aggregate.hazardPreviews === aggregate.vetoes + aggregate.hazardousSuccessfulCasts,
        'each hazard preview ends in a veto or successful hazardous cast', { cell, role });
      check(aggregate.previewFinalComparisons === aggregate.hazardPreviews,
        'every hazard preview is followed by Normal final placement', { cell, role });
      check(aggregate.previewFinalDivergences <= aggregate.previewFinalComparisons,
        'preview/final divergences are bounded by comparisons', { cell, role });
      check(aggregate.vetoes === 0 && aggregate.immediateRedundantPlacements === 0,
        'v2 projected previews never revive the retired completion veto/redundancy counters', { cell, role });
      check(aggregate.hazardPreviews === 0
        || typeof SPELLS.find((candidate) => candidate.id === runeId)?.cpuRootCharm === 'function',
      'every legacy-named preview counter comes from a projected-root-charm policy', { cell, role });
    }
  }
}

/* ---- baseline validation, exact cell deltas, and targeted summary ---- */
{
  const source = runWardSensitivity({ games: 1, seeds: ['baseline-fixture'], provenance: { test: true } });
  const baseline = {
    schemaVersion: 1,
    simulatorVersion: 1,
    provenance: { fileSha256: { 'tools/rune-matchups.ts': FROZEN_MATCHUP_SHA256 } },
    request: { gamesPerCell: 1, seeds: ['baseline-fixture'], modeIds: ['colshield'] },
    policy: {
      placement: 'searchRoot', cast: 'machineCast', depth: 2,
      riskWeight: 0.9, opponentWeight: 1, defaultDemand: 16,
      demandOverrides: {},
      uses: Object.fromEntries(SPELLS.map((spell) => [spell.id, spell.uses])),
    },
    cells: source.cells.map((cell) => ({
      baseSeed: cell.baseSeed,
      castRule: cell.castRule,
      modeId: cell.modeId,
      openerRune: cell.openerRune,
      replyRune: cell.replyRune,
      cellSeed: cell.sourceCellSeed,
      games: cell.games,
      openerWins: cell.openerWins,
      draws: cell.draws,
      replyWins: cell.replyWins,
      outcomePoints2: cell.outcomePoints2,
      openerScoreSum: cell.openerScoreSum,
      replyScoreSum: cell.replyScoreSum,
      roles: [{ casts: cell.roles[0].casts }, { casts: cell.roles[1].casts }],
    })),
  };
  const compared = attachBaseline(source, baseline, { input: 'fixture.json', reportSha256: 'fixture-sha' });
  check(compared.baseline?.comparedCellRecords === 13 && compared.comparisons?.length === 13,
    'every per-seed targeted cell receives an exact baseline comparison', compared.baseline);
  check((compared.comparisons?.every((cell) => cell.delta.outcomePoints2 === 0
    && cell.delta.openerOutcomeRate === 0
    && cell.delta.roleCasts[0] === 0 && cell.delta.roleCasts[1] === 0)) ?? false,
  'identical fixture baseline produces exact zero outcome/cast deltas');
  check((compared.targetedSummary?.oneCastWardSeatNeutral.length === SPELLS.length
    && compared.targetedSummary.oneCastWardUniformPopulationStrength.delta === 0
    && compared.targetedSummary.chainFateWardSeatNeutral.delta === 0) ?? false,
  'seat-neutral WARD summary pools all six opponents and the FATE chain branch');
  check(compared.baseline?.pairedGameSeeds === true
    && compared.baseline.emitterSha256 === FROZEN_MATCHUP_SHA256,
  'comparison records frozen emitter identity and common-game-seed pairing');

  const wrongHash = structuredClone(baseline);
  wrongHash.provenance.fileSha256['tools/rune-matchups.ts'] = 'wrong';
  throws(() => attachBaseline(source, wrongHash, { input: 'bad.json', reportSha256: 'bad' }),
    'non-frozen baseline emitter fails closed');
  const wrongGames = structuredClone(baseline);
  wrongGames.request.gamesPerCell = 2;
  throws(() => attachBaseline(source, wrongGames, { input: 'bad.json', reportSha256: 'bad' }),
    'mismatched baseline game cohort fails closed');
  const missing = structuredClone(baseline);
  missing.cells.pop();
  throws(() => attachBaseline(source, missing, { input: 'bad.json', reportSha256: 'bad' }),
    'missing targeted baseline cell fails closed');
}

/* ---- strict parser and real import-safe CLI boundary ---- */
{
  const defaults = parseWardSensitivityCli([]);
  check(defaults.games === 3000 && defaults.seeds.length === 4
    && defaults.baseline === undefined && !defaults.quiet,
  'CLI defaults are the fixed final-study cohort', defaults);
  const selected = parseWardSensitivityCli([
    '--games', '7', '--seed', 'a', '--seed', 'b', '--baseline', 'raw.json', '--quiet',
  ]);
  check(selected.games === 7 && selected.seeds.join(',') === 'a,b'
    && selected.baseline === 'raw.json' && selected.quiet,
  'repeatable seeds and singleton options parse exactly', selected);
  throws(() => parseWardSensitivityCli(['--mdoe', 'classic']), 'unknown flags fail closed');
  throws(() => parseWardSensitivityCli(['--games']), 'missing values fail closed');
  throws(() => parseWardSensitivityCli(['--games', '1', '--games', '2']), 'duplicate singleton flags fail closed');
  throws(() => parseWardSensitivityCli(['--seed', 'same', '--seed', 'same']), 'duplicate seeds fail closed');
  throws(() => parseWardSensitivityCli(['positional']), 'unexpected positional arguments fail closed');

  const script = fileURLToPath(new URL('../tools/rune-ward-sensitivity.ts', import.meta.url));
  const invoke = (args: string[]) => spawnSync(process.execPath, [
    '--no-warnings', '--experimental-strip-types', script, ...args,
  ], { encoding: 'utf8' });
  const success = invoke(['--games', '1', '--seed', 'cli-smoke', '--quiet']);
  let parsed: WardSensitivityReport | null = null;
  try { parsed = JSON.parse(success.stdout) as WardSensitivityReport; } catch { /* checked below */ }
  check(success.status === 0 && parsed?.plan.cellRecords === 13 && parsed.plan.totalGames === 13
    && parsed.provenance.fileSha256 !== undefined,
  'valid CLI emits one 13-cell replication with source provenance', {
    status: success.status, stderr: success.stderr, stdout: success.stdout.slice(0, 200),
  });
  const unknown = invoke(['--wat', 'x']);
  check(unknown.status !== 0 && unknown.stderr.includes('Unknown option: --wat'),
    'unknown CLI option exits nonzero', { status: unknown.status, stderr: unknown.stderr });
  const missing = invoke(['--baseline']);
  check(missing.status !== 0 && missing.stderr.includes('Missing value for --baseline'),
    'missing CLI value exits nonzero', { status: missing.status, stderr: missing.stderr });
}

console.log(JSON.stringify({ problems }, null, 2));
process.exitCode = problems.length ? 1 : 0;
