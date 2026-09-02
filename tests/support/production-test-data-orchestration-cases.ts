// Orchestration cases for tests/production-test-data.test.ts: the exact Rune
// prerequisite plus the wipe/human-wipe/seed rollout programs. Extracted so
// the owner test stays inside the architecture line budget; every assertion is
// unchanged. Fakes here count calls and replay canned reads — the typed stubs
// below keep them inside the tool's real option contract.
import assert from 'node:assert/strict';
import {
  BASE_PRODUCTION_TEST_DATA_AUDIT_SQL,
  EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL,
  LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL,
  PRODUCTION_HUMAN_WIPE_OPT_IN,
  PRODUCTION_RANKED_CURVE_STAGE_SQL,
  PRODUCTION_RANKED_CURVE_VERSION_SQL,
  PRODUCTION_TEST_DATA_OPT_INS,
  RUNE_TRIAL_PRODUCTION_STAGE_SQL,
  SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL,
  SEED_PRODUCTION_BOTS_SQL,
  WIPE_PRODUCTION_ACCOUNTS_SQL,
  WIPE_PRODUCTION_HUMAN_ACCOUNTS_SQL,
} from '../../tools/database/production-test-data-core.mjs';
import {
  auditProductionRankedCurve,
  auditExactRuneTrialProduction,
  rolloutProductionTestData,
} from '../../tools/database/production-test-data.mjs';
import {
  RUNE_TRIAL_FUNCTIONS,
  RUNE_TRIAL_JOB,
  RUNE_TRIAL_POST_APPLY_DATA,
  RUNE_TRIAL_SCHEMA,
} from '../../tools/database/production-rollout.mjs';
import {
  baseAudit,
  emptyRune,
  runeStage,
  seededAudit,
  streakBaselineStage,
} from './production-test-data-cases.ts';

type RolloutOptions = NonNullable<Parameters<typeof rolloutProductionTestData>[0]>;

/* The implied options type of the untyped .mjs drops destructured bindings
   that have no default (phase, optIn, humanWipeOptIn); restore them here so
   the calls below stay fully checked on every other option. */
type RolloutCallOptions = RolloutOptions & {
  phase: string;
  optIn?: string;
  humanWipeOptIn?: string;
};
const rollout = (options: RolloutCallOptions) => rolloutProductionTestData({
  rankedCurve: async () => 1,
  ...options,
});

/* The rollout ignores verifyEnvironment's return value, so the stub can
   satisfy the real signature with an inert frozen environment. */
const FAKE_ENVIRONMENT = Object.freeze({
  root: '/repo',
  cli: '/repo/node_modules/.bin/supabase',
  runner: Object.freeze({ capture: () => '', run: () => {} }),
});

export const environmentStub = (
  onVerify?: () => void,
): RolloutOptions['verifyEnvironment'] => () => {
  onVerify?.();
  return FAKE_ENVIRONMENT;
};

/* The orchestration only reads ledgerStage from the exact prerequisite; the
   full audit shape is the real auditor's concern, so widen at this boundary. */
type ExactPrerequisite = RolloutOptions['exactBotSeedPrerequisite'];
export const exactPrerequisiteStub = (onCheck?: () => void): ExactPrerequisite =>
  (async () => {
    onCheck?.();
    return { ledgerStage: 1 };
  }) as unknown as ExactPrerequisite;

export async function assertProductionRankedCurveAudit() {
  const legacyQueries: string[] = [];
  assert.equal(await auditProductionRankedCurve(async (query) => {
    legacyQueries.push(query);
    if (query === PRODUCTION_RANKED_CURVE_STAGE_SQL) return [{ versionFunction: false }];
    throw new Error('legacy audit queried an absent function');
  }), 1);
  assert.deepEqual(legacyQueries, [PRODUCTION_RANKED_CURVE_STAGE_SQL]);

  const installedQueries: string[] = [];
  assert.equal(await auditProductionRankedCurve(async (query) => {
    installedQueries.push(query);
    if (query === PRODUCTION_RANKED_CURVE_STAGE_SQL) return [{ versionFunction: true }];
    if (query === PRODUCTION_RANKED_CURVE_VERSION_SQL) return [{ curveVersion: 1 }];
    throw new Error('unexpected installed-curve query');
  }), 1);
  assert.deepEqual(installedQueries, [
    PRODUCTION_RANKED_CURVE_STAGE_SQL,
    PRODUCTION_RANKED_CURVE_VERSION_SQL,
  ]);

  assert.equal(await auditProductionRankedCurve(async (query) => {
    if (query === PRODUCTION_RANKED_CURVE_STAGE_SQL) return [{ versionFunction: true }];
    return [{ curveVersion: 2 }];
  }), 2);
  await assert.rejects(
    () => auditProductionRankedCurve(async (query) => query === PRODUCTION_RANKED_CURVE_STAGE_SQL
      ? [{ versionFunction: true }]
      : [{ curveVersion: 3 }]),
    /curve version/i,
  );
}

export async function assertCurveV2ProductionTestDataRefusal() {
  for (const phase of ['wipe', 'seed-bots', 'refresh-bot-profiles'] as const) {
    for (const apply of [false, true]) {
      let reads = 0;
      let writes = 0;
      await assert.rejects(() => rollout({
        phase,
        apply,
        optIn: apply ? PRODUCTION_TEST_DATA_OPT_INS[phase].value : undefined,
        rankedCurve: async () => 2,
        read: async () => { reads++; throw new Error('v2 refusal reached data audit'); },
        verifyEnvironment: environmentStub(),
        execute: () => { writes++; },
        log: () => {},
      }), new RegExp(`Production ${phase} is disabled after curve-v2 activation`));
      assert.equal(reads, 0, `${phase} ${apply ? 'apply' : 'preview'} read mutable data on v2`);
      assert.equal(writes, 0, `${phase} ${apply ? 'apply' : 'preview'} wrote on v2`);
    }
  }
}

export async function assertExactRuneTrialPrerequisite() {
  const fullSchema = {
    cron_extension: true,
    profile_progression: true,
    match_protocol: true,
    queue_protocol: true,
    player_runes_table: true,
    match_actions_table: true,
    private_tables: true,
    indexes: true,
    policies: true,
    table_grants: true,
    private_tables_locked: true,
    realtime_publication: true,
  };
  const responses = new Map<string, unknown[]>([
    [RUNE_TRIAL_PRODUCTION_STAGE_SQL, [runeStage(true)]],
    [RUNE_TRIAL_SCHEMA, [fullSchema]],
    [RUNE_TRIAL_FUNCTIONS, [{
      function_contracts: true, function_bodies: true, function_grants: true,
    }]],
    [RUNE_TRIAL_JOB, [{ cron_job: true, cron_job_contract: true }]],
    [RUNE_TRIAL_POST_APPLY_DATA, [{
      profile_backfill: true, legacy_matches: true, legacy_queue: true, new_tables_empty: true,
    }]],
  ]);
  const seen: string[] = [];
  const result = await auditExactRuneTrialProduction(async (query) => {
    seen.push(query);
    const rows = responses.get(query);
    if (!rows) throw new Error('unexpected query');
    return rows;
  });
  assert.equal(result.ledgerStage, 1);
  assert.deepEqual(seen, [
    RUNE_TRIAL_PRODUCTION_STAGE_SQL,
    RUNE_TRIAL_SCHEMA,
    RUNE_TRIAL_FUNCTIONS,
    RUNE_TRIAL_JOB,
    RUNE_TRIAL_POST_APPLY_DATA,
  ]);
  responses.set(RUNE_TRIAL_FUNCTIONS, [{
    function_contracts: true, function_bodies: false, function_grants: true,
  }]);
  await assert.rejects(
    () => auditExactRuneTrialProduction(async query => responses.get(query)!),
    /partial|incomplete/,
  );
}

export async function assertWipeOrchestration() {
  const botsOnly = baseAudit({ authUsers: 14, profiles: 14, bots: 14, humans: 0, matches: 230 });
  const after = baseAudit();
  const reads = new Map<string, unknown[][]>([
    [RUNE_TRIAL_PRODUCTION_STAGE_SQL, [[runeStage(false)]]],
    [LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL, [[streakBaselineStage(false)]]],
    [BASE_PRODUCTION_TEST_DATA_AUDIT_SQL, [[botsOnly], [after]]],
  ]);
  const read = async (query: string) => reads.get(query)!.shift()!;
  const executed: string[] = [];
  let verified = 0;
  const result = await rollout({
    phase: 'wipe',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS.wipe.value,
    // A stray human-wipe literal must not move a bot-only wipe off the
    // ceiling-guarded standard program.
    humanWipeOptIn: PRODUCTION_HUMAN_WIPE_OPT_IN.value,
    read,
    verifyEnvironment: environmentStub(() => { verified++; }),
    execute: sql => { executed.push(sql); },
    log: () => {},
  });
  assert.equal(result.applied, true);
  assert.equal(verified, 1);
  assert.deepEqual(executed, [WIPE_PRODUCTION_ACCOUNTS_SQL]);

  let previewWrites = 0;
  await rollout({
    phase: 'wipe',
    read: async query => {
      if (query === RUNE_TRIAL_PRODUCTION_STAGE_SQL) return [runeStage(false)];
      if (query === LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL) {
        return [streakBaselineStage(false)];
      }
      return [baseAudit({ authUsers: 54, profiles: 54, bots: 14, humans: 40, matches: 230 })];
    },
    verifyEnvironment: environmentStub(),
    execute: () => { previewWrites++; },
    log: () => {},
  });
  assert.equal(previewWrites, 0);
}

export async function assertHumanWipeOverride() {
  const withHumans = baseAudit({ authUsers: 54, profiles: 54, bots: 14, humans: 40, matches: 230 });
  let writes = 0;
  await assert.rejects(() => rollout({
    phase: 'wipe',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS.wipe.value,
    humanWipeOptIn: PRODUCTION_TEST_DATA_OPT_INS.wipe.value,
    read: async query => {
      if (query === RUNE_TRIAL_PRODUCTION_STAGE_SQL) return [runeStage(false)];
      if (query === LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL) {
        return [streakBaselineStage(false)];
      }
      return [withHumans];
    },
    verifyEnvironment: environmentStub(),
    execute: () => { writes++; },
    log: () => {},
  }), /human accounts over the test-data ceiling/);
  assert.equal(writes, 0);

  const reads = new Map<string, unknown[][]>([
    [RUNE_TRIAL_PRODUCTION_STAGE_SQL, [[runeStage(false)]]],
    [LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL, [[streakBaselineStage(false)]]],
    [BASE_PRODUCTION_TEST_DATA_AUDIT_SQL, [[withHumans], [baseAudit()]]],
  ]);
  const executed: string[] = [];
  const result = await rollout({
    phase: 'wipe',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS.wipe.value,
    humanWipeOptIn: PRODUCTION_HUMAN_WIPE_OPT_IN.value,
    read: async query => reads.get(query)!.shift()!,
    verifyEnvironment: environmentStub(),
    execute: sql => { executed.push(sql); },
    log: () => {},
  });
  assert.equal(result.applied, true);
  assert.deepEqual(executed, [WIPE_PRODUCTION_HUMAN_ACCOUNTS_SQL]);
}

export async function assertSeedOrchestration() {
  let writes = 0;
  await assert.rejects(() => rollout({
    phase: 'seed-bots',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS['seed-bots'].value,
    read: async query => {
      if (query === RUNE_TRIAL_PRODUCTION_STAGE_SQL) return [runeStage(false)];
      if (query === LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL) {
        return [streakBaselineStage(false)];
      }
      return [baseAudit()];
    },
    verifyEnvironment: environmentStub(),
    exactBotSeedPrerequisite: async () => { throw new Error('must not run'); },
    execute: () => { writes++; },
    log: () => {},
  }), /migrations must be complete/);
  assert.equal(writes, 0);

  const lifecycle: string[] = [];
  const read = async (query: string) => {
    if (query === RUNE_TRIAL_PRODUCTION_STAGE_SQL) return [runeStage(true)];
    if (query === LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL) {
      return [streakBaselineStage(true)];
    }
    if (query === BASE_PRODUCTION_TEST_DATA_AUDIT_SQL) return [baseAudit()];
    if (query === EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL) return [emptyRune()];
    if (query === SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL) {
      lifecycle.push('seeded-state');
      return [seededAudit()];
    }
    throw new Error('unexpected query');
  };
  let exactChecks = 0;
  const executed: string[] = [];
  const result = await rollout({
    phase: 'seed-bots',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS['seed-bots'].value,
    read,
    verifyEnvironment: environmentStub(),
    exactBotSeedPrerequisite: exactPrerequisiteStub(() => {
      exactChecks++;
      lifecycle.push('exact-schema');
    }),
    execute: sql => {
      lifecycle.push('execute');
      executed.push(sql);
    },
    log: () => {},
  });
  assert.equal(result.applied, true);
  assert.equal(exactChecks, 3);
  assert.deepEqual(executed, [SEED_PRODUCTION_BOTS_SQL]);
  assert.deepEqual(lifecycle, [
    'exact-schema',
    'exact-schema',
    'execute',
    'exact-schema',
    'seeded-state',
  ]);
}
