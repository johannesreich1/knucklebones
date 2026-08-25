// Focused contract for tools/rune-sunder-sensitivity.ts.
// Run: mise exec -- node --experimental-strip-types tests/rune-sunder-sensitivity.test.ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AI, ME, BOUNTY, CLASSIC, freshCharm, legalCols,
  type GameState, type Mode, type Player,
} from '../src/core/rules.ts';
import { SPELLS, machineCast, spellById, type CastCtx } from '../src/core/spells.ts';
import {
  DEFAULT_SEEDS, FROZEN_MATCHUP_SHA256,
  attachBaselines, parseSunderSensitivityCli, planSunderSensitivity,
  playSunderSensitivityGame, runSunderSensitivity,
  type BaselineInput, type SunderSensitivityReport,
} from '../tools/rune-sunder-sensitivity.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, details?: unknown) => {
  if (!condition) problems.push(message + (details === undefined ? '' : ` :: ${JSON.stringify(details)}`));
};
const throws = (fn: () => unknown, message: string) => {
  try { fn(); problems.push(`${message} :: did not throw`); } catch { /* expected */ }
};

/* ---- exact targeted plan ---- */
{
  const plan = planSunderSensitivity();
  check(plan.length === 112, 'four fixed seeds retain 112 separate cell records', plan.length);
  check(new Set(plan.map((cell) => cell.baseSeed)).size === 4
    && DEFAULT_SEEDS.every((seed) => plan.some((cell) => cell.baseSeed === seed)),
  'all four final-study replications are explicit');
  const first = plan.filter((cell) => cell.replication === 0);
  const one = first.filter((cell) => cell.castRule === 'one');
  const chain = first.filter((cell) => cell.castRule === 'chain');
  check(first.length === 28 && one.length === 24 && chain.length === 4,
    'one replication is 24 one-cast plus four FATE-chain configurations', { one: one.length, chain: chain.length });
  check(one.filter((cell) => cell.modeId === 'classic').length === 11
    && one.filter((cell) => cell.modeId === 'bounty').length === 11,
  'Classic and Bounty each contain all 11 directed SUNDER cells');
  check(one.filter((cell) => cell.modeId === 'classic' || cell.modeId === 'bounty')
    .every((cell) => cell.openerRune === 'sunder' || cell.replyRune === 'sunder'),
  'every broad one-cast cell contains SUNDER');
  const shield = one.filter((cell) => cell.modeId === 'colshield');
  check(shield.length === 2
    && shield.some((cell) => cell.openerRune === 'sunder' && cell.replyRune === 'ward')
    && shield.some((cell) => cell.openerRune === 'ward' && cell.replyRune === 'sunder'),
  'COLUMN SHIELD adds exactly both SUNDER/WARD orientations', shield);
  check(chain.every((cell) => (cell.modeId === 'classic' || cell.modeId === 'bounty')
    && new Set([cell.openerRune, cell.replyRune]).has('fate')
    && new Set([cell.openerRune, cell.replyRune]).has('sunder')),
  'only directed FATE/SUNDER cells receive the branch-sensitive chain treatment', chain);
  check(new Set(plan.map((cell) =>
    `${cell.baseSeed}:${cell.castRule}:${cell.modeId}:${cell.openerRune}:${cell.replyRune}`)).size === 112,
  'every treatment identity is unique');
  throws(() => planSunderSensitivity([]), 'empty seed set fails closed');
  throws(() => planSunderSensitivity(['same', 'same']), 'duplicate seeds fail closed');
}

/* ---- production BOUNTY cast threshold is explicitly bank-aware ---- */
{
  const sunder = spellById('sunder')!;
  const board: GameState = [[[], [], []], [[5], [5], [5]]];
  const context = (mode: Mode): CastCtx => ({
    mode,
    die: 5,
    setDie: () => undefined,
    draw: () => 1,
    bagLeft: null,
    charm: freshCharm(),
  });
  check(machineCast(board, AI, sunder, context(CLASSIC), 16) === null,
    'board-only wide/plain delta 10 holds SUNDER in Classic');
  check(machineCast(board, AI, sunder, context(BOUNTY), 16) === -1,
    'opt-in BOUNTY +1/kill raises wide/plain delta to 12 and casts at Normal threshold');
}

/* ---- scripted coordinated reuse, 5% slip, and same-column attribution ---- */
{
  const cell = (modeId: 'classic' | 'bounty') => ({
    baseSeed: `script-${modeId}`,
    replication: 0,
    castRule: 'one' as const,
    modeId,
    openerRune: 'sunder',
    replyRune: 'nudge',
  });
  const initialState: GameState = [
    [[1, 2], [1, 2, 3], [1, 2]],
    [[3, 3], [3, 3], [3, 3]],
  ];
  const scripted = (modeId: 'classic' | 'bounty', slipSample: number) => {
    let draw = 0;
    return playSunderSensitivityGame(cell(modeId), 0, {
      openerPlayer: AI,
      initialState,
      endlessDraw: () => draw++ === 0 ? 3 : 1 + (draw % 6),
      searchRandom: [() => slipSample, () => 0.5],
      placementDecision: (st, who, die, mode, random, rootCharm) => {
        const legal = legalCols(st[who]);
        return who === AI && rootCharm?.sunder[AI] && legal.includes(2) ? 2 : legal[0];
      },
    });
  };

  const reused = scripted('classic', 0.5);
  const reuse = reused.coordination[0];
  check(reuse.coordinatedPreviews === 1 && reuse.slipChecks === 1 && reuse.slips === 0
    && reuse.coordinatedPlacementsReused === 1
    && reuse.coordinatedVsBlindDifferences === 1
    && reuse.placementTransitionHistogram['0->2'] === 1,
  'Normal reuses a charm-aware column 2 preview while blind policy chose column 0', reuse);
  check(reuse.castAttributableComparisons === 1 && reuse.incrementalKillsSum === 4
    && reuse.incrementalOpponentScoreRemovedSum === 24
    && reuse.incrementalKillsHistogram['4'] === 1
    && reuse.incrementalBountySum === 0 && reused.game.casts[0].length === 1,
  'Classic attributes four extra kills and 24 extra removed score to SUNDER on the same final column', reuse);

  const slipped = scripted('classic', 0);
  const slip = slipped.coordination[0];
  check(slip.slips === 1 && slip.coordinatedPlacementsReused === 0
    && slip.slippedFinalVsPreviewDifferences === 1
    && slip.castAttributableComparisons === 1,
  'sample below 5% discards the preview and makes an independent plain final choice', slip);

  const bounty = scripted('bounty', 0.5);
  check(bounty.coordination[0].incrementalKillsSum === 4
    && bounty.coordination[0].incrementalBountySum === 4
    && bounty.game.bounty[0] >= 4,
  'BOUNTY records one incremental banked point per SUNDER-attributable kill', bounty.coordination[0]);
}

/* ---- projected SUNDER charm preserves and values a live enemy WARD ---- */
{
  const cell = {
    baseSeed: 'live-ward', replication: 0, castRule: 'one' as const,
    modeId: 'classic' as const, openerRune: 'ward', replyRune: 'sunder',
  };
  const supply = [5, 6];
  let fallback = 0;
  const result = playSunderSensitivityGame(cell, 0, {
    openerPlayer: AI,
    initialState: [[[6, 6], [6, 6], [6, 6]], [[], [], []]],
    endlessDraw: () => supply.shift() ?? 1 + (fallback++ % 6),
    searchRandom: [() => 0.5, () => 0.5],
    placementDecision: (st, who, die, mode, random, rootCharm) => {
      const legal = legalCols(st[who]);
      if (who === AI && legal.includes(2)) return 2;
      if (who === ME && rootCharm?.sunder[ME] && legal.includes(1)) return 1;
      return legal[0];
    },
  });
  const sunder = result.coordination[1];
  check(result.game.casts[0].length === 1 && result.game.casts[1].length === 1,
    'WARD is established before reply SUNDER casts', result.game.casts.map((casts) => casts.length));
  check(sunder.liveEnemyWardCasts === 1 && sunder.liveEnemyWardsSum === 1
    && sunder.liveWardValuationComparisons === 1,
  'SUNDER root valuation observes the live enemy WARD', sunder);
  check(sunder.plannedWardAbsorbedStrikes === 1 && sunder.plannedWardAbsorbedDice === 2
    && sunder.actualWardAbsorbedStrikes === 1 && sunder.actualWardAbsorbedDice === 2,
  'planned and actual wide strikes agree that WARD protects two matching dice', sunder);
  check(sunder.incrementalKillsSum === 2 && sunder.incrementalOpponentScoreRemovedSum === 24,
    'same-column wide/plain attribution excludes the two WARD-protected dice', sunder);
}

/* ---- deterministic aggregate and schema reconciliation ---- */
let deterministic: SunderSensitivityReport;
{
  const options = { games: 2, seeds: ['focused'], provenance: { test: true } };
  deterministic = runSunderSensitivity(options);
  const rerun = runSunderSensitivity(options);
  check(JSON.stringify(deterministic) === JSON.stringify(rerun),
    'same treatment request reruns byte-identically');
  check(deterministic.plan.mechanicalConfigurations === 28
    && deterministic.plan.oneCastConfigurations === 24
    && deterministic.plan.chainConfigurations === 4
    && deterministic.plan.classicConfigurations === 13
    && deterministic.plan.bountyConfigurations === 13
    && deterministic.plan.colshieldConfigurations === 2
    && deterministic.plan.cellRecords === 28
    && deterministic.plan.totalGames === 56,
  'report counts reconcile to exact targeted design', deterministic.plan);

  const originalRandom = Math.random;
  Math.random = () => { throw new Error('ambient Math.random reached'); };
  try { runSunderSensitivity({ games: 1, seeds: ['no-ambient-random'] }); }
  catch (error) { problems.push(`simulation reached ambient Math.random :: ${String(error)}`); }
  finally { Math.random = originalRandom; }

  for (const cell of deterministic.cells) {
    check(cell.openerWins + cell.draws + cell.replyWins === cell.games,
      'W/D/L reconciles', cell);
    check(cell.outcomePoints2 === 2 * cell.openerWins + cell.draws,
      'doubled outcome reconciles', cell);
    check(cell.marginSum === cell.openerScoreSum - cell.replyScoreSum,
      'margin reconciles to scores', cell);
    check(Object.values(cell.terminalReasons).reduce((sum, count) => sum + count, 0) === cell.games,
      'terminal reasons reconcile', cell.terminalReasons);
    check(cell.internalOpener.ai.games === 1 && cell.internalOpener.me.games === 1,
      'internal identities alternate inside each directed cell', cell.internalOpener);
    check(cell.modeId !== 'bounty' || (cell.kills[0] === cell.bounty[0] && cell.kills[1] === cell.bounty[1]),
      'BOUNTY bank reconciles to destroyed dice', { kills: cell.kills, bounty: cell.bounty });
    for (let index = 0 as 0 | 1; index < 2; index = (index + 1) as 0 | 1) {
      const role = cell.roles[index];
      const runeId = index === 0 ? cell.openerRune : cell.replyRune;
      const uses = SPELLS.find((spell) => spell.id === runeId)!.uses;
      check(role.casts + role.unusedCharges === cell.games * uses,
        'casts and unused charges reconcile to registry supply', { cell, index });
      check(role.immediateSwingCount === role.casts,
        'each cast retains one frozen-v1 immediate-swing record', { cell, index });
      if (runeId === 'sunder') {
        check(role.coordinatedPreviews === role.casts
          && role.slipChecks === role.coordinatedPreviews
          && role.slips + role.coordinatedPlacementsReused === role.slipChecks
          && role.coordinatedVsBlindComparisons === role.coordinatedPreviews
          && role.castAttributableComparisons === role.casts,
        'every SUNDER cast reconciles preview, slip, and attribution counters', { cell, index, role });
        check(Object.values(role.incrementalKillsHistogram).reduce((sum, count) => sum + count, 0) === role.casts,
          'incremental-kill histogram contains every SUNDER cast', { cell, index, role });
        check(role.zeroMarginalCasts <= role.zeroIncrementalKillCasts
          && role.zeroIncrementalKillCasts <= role.casts,
        'zero-marginal counters are nested within SUNDER casts', { cell, index, role });
        check(role.liveWardValuationComparisons === role.liveEnemyWardCasts,
          'every cast seeing live enemy WARDs receives a valuation comparison', { cell, index, role });
        check(cell.modeId === 'bounty'
          ? role.incrementalBountySum === role.incrementalKillsSum
          : role.incrementalBountySum === 0,
        'incremental BOUNTY is opt-in only and equals attributable kills', { cell, index, role });
      } else {
        check(role.coordinatedPreviews === 0 && role.castAttributableComparisons === 0
          && role.incrementalKillsSum === 0 && role.slipChecks === 0,
        'non-SUNDER role has no SUNDER coordination diagnostics', { cell, index, role });
      }
    }
  }
}

/* ---- three frozen baseline sources and exact per-seed deltas ---- */
{
  const source = runSunderSensitivity({ games: 1, seeds: ['baseline-fixture'], provenance: { test: true } });
  const baselineFor = (modeId: 'classic' | 'bounty' | 'colshield'): BaselineInput => ({
    input: `raw-${modeId}.json`,
    reportSha256: `${modeId}-sha`,
    report: {
      schemaVersion: 1,
      simulatorVersion: 1,
      provenance: {
        fileSha256: {
          'tools/rune-matchups.ts': FROZEN_MATCHUP_SHA256,
          'src/core/spells.ts': `${modeId}-old-spells`,
        },
      },
      request: { gamesPerCell: 1, seeds: ['baseline-fixture'], modeIds: [modeId] },
      policy: {
        placement: 'searchRoot', cast: 'machineCast', depth: 2,
        riskWeight: 0.9, opponentWeight: 1, defaultDemand: 16,
        demandOverrides: {},
        uses: Object.fromEntries(SPELLS.map((spell) => [spell.id, spell.uses])),
      },
      cells: source.cells.filter((cell) => cell.modeId === modeId).map((cell) => ({
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
        kills: cell.kills,
        bounty: cell.bounty,
        roles: [{ casts: cell.roles[0].casts }, { casts: cell.roles[1].casts }],
      })),
    },
  });
  const inputs = [baselineFor('classic'), baselineFor('bounty'), baselineFor('colshield')];
  const compared = attachBaselines(source, inputs);
  check(compared.baselines?.length === 3 && compared.comparisons?.length === 28,
    'three source reports cover all 28 per-seed treatment records', compared.baselines);
  check((compared.comparisons?.every((cell) => cell.delta.outcomePoints2 === 0
    && cell.delta.openerOutcomeRate === 0
    && cell.delta.roleCasts[0] === 0 && cell.delta.roleCasts[1] === 0)) ?? false,
  'identical baseline fixture produces exact zero outcome/cast deltas');
  check((compared.targetedSummary?.oneCastSunderSeatNeutral.length === 13
    && compared.targetedSummary.fateChainSunderSeatNeutral.length === 2
    && compared.targetedSummary.oneCastSunderSeatNeutral.every((row) => row.delta === 0)) ?? false,
  'targeted summary contains twelve full-mode pairs plus COLUMN SHIELD WARD and two chain rows');
  check(compared.baselines?.every((baseline) => baseline.pairedGameSeeds
    && baseline.emitterSha256 === FROZEN_MATCHUP_SHA256
    && baseline.sourceFileSha256['src/core/spells.ts'].endsWith('old-spells')) ?? false,
  'baseline references preserve paired identity and all historical source hashes');
  throws(() => attachBaselines(source, inputs.slice(0, 2)), 'missing COLUMN SHIELD baseline fails closed');
  const duplicate = [inputs[0], inputs[0], inputs[1], inputs[2]];
  throws(() => attachBaselines(source, duplicate), 'duplicate baseline mode fails closed');
  const wrong = structuredClone(inputs);
  (wrong[0].report as { provenance: { fileSha256: Record<string, string> } })
    .provenance.fileSha256['tools/rune-matchups.ts'] = 'wrong';
  throws(() => attachBaselines(source, wrong), 'non-frozen baseline emitter fails closed');
}

/* ---- strict CLI and import-safe executable boundary ---- */
{
  const defaults = parseSunderSensitivityCli([]);
  check(defaults.games === 3000 && defaults.seeds.length === 4 && defaults.baselines.length === 0,
    'CLI defaults select 3000 games and four fixed seeds', defaults);
  const selected = parseSunderSensitivityCli([
    '--games', '7', '--seed', 'a', '--seed', 'b',
    '--baseline', 'classic.json', '--baseline', 'bounty.json', '--baseline', 'colshield.json', '--quiet',
  ]);
  check(selected.games === 7 && selected.seeds.join(',') === 'a,b'
    && selected.baselines.join(',') === 'classic.json,bounty.json,colshield.json' && selected.quiet,
  'repeatable seed/baseline arguments remain separate', selected);
  throws(() => parseSunderSensitivityCli(['--mdoe', 'classic']), 'unknown flags fail closed');
  throws(() => parseSunderSensitivityCli(['--games']), 'missing values fail closed');
  throws(() => parseSunderSensitivityCli(['--games', '1', '--games', '2']), 'duplicate singleton flags fail closed');
  throws(() => parseSunderSensitivityCli(['--seed', 'same', '--seed', 'same']), 'duplicate seeds fail closed');
  throws(() => parseSunderSensitivityCli(['--baseline', 'same', '--baseline', 'same']), 'duplicate baselines fail closed');
  throws(() => parseSunderSensitivityCli(['--baseline', 'classic', '--baseline', 'bounty']),
    'partial baseline set fails before a long treatment run');
  throws(() => parseSunderSensitivityCli(['positional']), 'positional arguments fail closed');

  const script = fileURLToPath(new URL('../tools/rune-sunder-sensitivity.ts', import.meta.url));
  const invoke = (args: string[]) => spawnSync(process.execPath, [
    '--no-warnings', '--experimental-strip-types', script, ...args,
  ], { encoding: 'utf8' });
  /* Production WARD/charm policy changed after the retained SUNDER study.
     Do not bless replacement source hashes here: the CLI must fail closed
     until a deliberate SUNDER instrument v2 rerun establishes new pins. */
  const driftGuard = invoke(['--games', '1', '--seed', 'cli-smoke', '--quiet']);
  check(driftGuard.status !== 0
    && driftGuard.stderr.includes('Production SUNDER policy source drifted:')
    && driftGuard.stdout.trim() === '',
  'SUNDER CLI refuses to emit evidence after production drift; v2 rerun and repin required', {
    status: driftGuard.status,
    stderr: driftGuard.stderr,
    stdout: driftGuard.stdout.slice(0, 200),
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
