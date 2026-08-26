import assert from 'node:assert/strict';
import os from 'node:os';
import {
  BASE_PRODUCTION_TEST_DATA_AUDIT_SQL,
  EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL,
  LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL,
  PRODUCTION_TEST_DATA_CLI_VERSION,
  PRODUCTION_TEST_DATA_OPT_INS,
  PRODUCTION_TEST_DATA_PROJECT_REF,
  ProductionTestDataGuardError,
  RUNE_TRIAL_PRODUCTION_STAGE_SQL,
  SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL,
  SEED_PRODUCTION_BOTS_SQL,
  WIPE_PRODUCTION_ACCOUNTS_SQL,
  assertPinnedProductionCli,
  assertProductionProjectBinding,
  assertProductionRepositoryState,
  assertProductionTestDataOptIn,
  assertProductionWipeComplete,
  assertProductionWipePreflight,
  productionTestDataQueryArgs,
  validateBaseProductionTestDataAudit,
  validateEmptyRuneTrialDataAudit,
  validateProductionTestDataPhase,
  validateRuneTrialProductionStage,
} from '../tools/database/production-test-data-core.mjs';
import {
  auditExactRuneTrialProduction,
  executeFixedProductionTestDataSql,
  rolloutProductionTestData,
} from '../tools/database/production-test-data.mjs';
import {
  RUNE_TRIAL_FUNCTIONS,
  RUNE_TRIAL_JOB,
  RUNE_TRIAL_POST_APPLY_DATA,
  RUNE_TRIAL_SCHEMA,
} from '../tools/database/production-rollout.mjs';
import {
  baseAudit,
  emptyRune,
  runeStage,
  seededAudit,
  streakBaselineStage,
} from './support/production-test-data-cases.ts';
import {
  assertBotProfileRefreshOrchestration,
  assertBotProfileRefreshSql,
  assertBotSeedSql,
  assertExactSeedAudit,
  assertExactStreakBaselinePrerequisite,
  assertRealisticBotSeedPlan,
  assertRefreshAudit,
  assertStreakBaselineStage,
} from './support/production-test-data-bot-profile-cases.ts';

const checked: string[] = [];
const problems: string[] = [];

function check(name: string, run: () => void) {
  try {
    run();
    checked.push(name);
  } catch (error) {
    problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkAsync(name: string, run: () => Promise<void>) {
  try {
    await run();
    checked.push(name);
  } catch (error) {
    problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function guarded(run: () => unknown, pattern: RegExp) {
  assert.throws(run, (error: unknown) => error instanceof ProductionTestDataGuardError
    && pattern.test(error.message));
}

check('phases and phase-specific literal opt-ins are fail-closed', () => {
  assert.equal(validateProductionTestDataPhase('wipe'), 'wipe');
  assert.equal(validateProductionTestDataPhase('seed-bots'), 'seed-bots');
  assert.equal(validateProductionTestDataPhase('refresh-bot-profiles'), 'refresh-bot-profiles');
  guarded(() => validateProductionTestDataPhase('reset'), /must be one of/);
  assert.equal(assertProductionTestDataOptIn('wipe', false, undefined), false);
  assert.equal(assertProductionTestDataOptIn(
    'wipe', true, PRODUCTION_TEST_DATA_OPT_INS.wipe.value,
  ), true);
  guarded(() => assertProductionTestDataOptIn(
    'wipe', true, PRODUCTION_TEST_DATA_OPT_INS['seed-bots'].value,
  ), /WIPE_ALL_ACCOUNTS/);
  guarded(() => assertProductionTestDataOptIn('seed-bots', true, '150'), /SEED_EXACTLY_150_BOTS/);
  guarded(() => assertProductionTestDataOptIn(
    'refresh-bot-profiles', true, 'refresh',
  ), /REFRESH_EXACT_150_UNPLAYED_BOTS/);
});

check('project, main, clean-worktree, and pinned-CLI guards are exact', () => {
  assert.equal(assertProductionProjectBinding(
    PRODUCTION_TEST_DATA_PROJECT_REF,
    `${PRODUCTION_TEST_DATA_PROJECT_REF}\n`,
  ), PRODUCTION_TEST_DATA_PROJECT_REF);
  guarded(() => assertProductionProjectBinding(
    PRODUCTION_TEST_DATA_PROJECT_REF,
    'aaaaaaaaaaaaaaaaaaaa',
  ), /project ref mismatch/);

  assert.equal(assertProductionRepositoryState({
    root: '/repo', cwd: '/repo', branch: 'main', status: '', expectedRoot: '/repo',
  }), true);
  guarded(() => assertProductionRepositoryState({
    root: '/repo', cwd: '/repo', branch: 'feature', status: '', expectedRoot: '/repo',
  }), /local main/);
  guarded(() => assertProductionRepositoryState({
    root: '/repo', cwd: '/repo', branch: 'main', status: ' M file', expectedRoot: '/repo',
  }), /clean worktree/);

  const packageJson = { devDependencies: { supabase: PRODUCTION_TEST_DATA_CLI_VERSION } };
  const packageLock = { packages: {
    '': { devDependencies: { supabase: PRODUCTION_TEST_DATA_CLI_VERSION } },
    'node_modules/supabase': {
      version: PRODUCTION_TEST_DATA_CLI_VERSION,
      integrity: 'sha512-fixed',
    },
  } };
  assert.equal(assertPinnedProductionCli(
    packageJson, packageLock, PRODUCTION_TEST_DATA_CLI_VERSION,
  ), true);
  guarded(() => assertPinnedProductionCli(packageJson, packageLock, '2.114.0'), /Installed/);
});

check('database query argv is fixed to the linked production project and SQL file', () => {
  const args = productionTestDataQueryArgs('/tmp/fixed.sql');
  assert.deepEqual(args, [
    'db', 'query', '--linked', '--project-ref', PRODUCTION_TEST_DATA_PROJECT_REF,
    '--file', '/tmp/fixed.sql', '--output-format', 'json',
  ]);
  for (const forbidden of ['reset', '--include-all', '--include-seed', '--db-url']) {
    assert.equal(args.includes(forbidden), false);
  }
  guarded(() => productionTestDataQueryArgs('../bad.sql', 'aaaaaaaaaaaaaaaaaaaa'), /project ref mismatch/);
});

check('canonical seed has toned-down realistic histories across every ladder group', () => {
  assertRealisticBotSeedPlan();
});

check('wipe SQL is one bounded transaction with pre/postchecks and explicit safe deletion order', () => {
  assert.match(WIPE_PRODUCTION_ACCOUNTS_SQL, /^\s*begin;/);
  assert.match(WIPE_PRODUCTION_ACCOUNTS_SQL, /commit;\s*$/);
  assert.match(WIPE_PRODUCTION_ACCOUNTS_SQL, /lock_timeout = '10s'/);
  assert.match(WIPE_PRODUCTION_ACCOUNTS_SQL, /authOwned|storage\.objects|owner_id/);
  assert.ok(WIPE_PRODUCTION_ACCOUNTS_SQL.indexOf('delete from public.matches;')
    < WIPE_PRODUCTION_ACCOUNTS_SQL.indexOf('delete from auth.users;'));
  assert.doesNotMatch(WIPE_PRODUCTION_ACCOUNTS_SQL, /\btruncate\b/i);
  for (const table of [
    'auth.refresh_tokens', 'auth.mfa_challenges', 'auth.mfa_amr_claims',
    'auth.flow_state', 'auth.oauth_client_states', 'auth.saml_relay_states',
    'public.season_ratings', 'public.player_settings',
    'private.match_commands', 'public.player_runes', 'private.match_action_commands',
    'private.season_streak_baselines',
  ]) assert.ok(WIPE_PRODUCTION_ACCOUNTS_SQL.includes(table));
  assert.match(WIPE_PRODUCTION_ACCOUNTS_SQL, /with recursive account_graph/);
  assert.match(WIPE_PRODUCTION_ACCOUNTS_SQL, /pg_constraint/);
  assert.doesNotMatch(WIPE_PRODUCTION_ACCOUNTS_SQL, /public\.current_season\(\)/);
  assert.doesNotMatch(WIPE_PRODUCTION_ACCOUNTS_SQL, /delete from auth\.(oauth_clients|sso_providers|sso_domains|saml_providers|custom_oauth_providers)/);
});

check('seed SQL uses canonical minting and writes rating, season, tier, stats, and all postchecks atomically', () => {
  assertBotSeedSql();
});

check('profile refresh is update-only, exact, idempotent, and permanently blocks real play', () => {
  assertBotProfileRefreshSql();
});

check('base audits enforce Auth/profile consistency, Storage safety, and complete wipe', () => {
  assert.doesNotMatch(BASE_PRODUCTION_TEST_DATA_AUDIT_SQL, /public\.current_season\(\)/);
  assert.doesNotMatch(SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL, /(?:public\.current_season|private\.ranked_pool_tier_for_peak)\(/);
  const before = validateBaseProductionTestDataAudit([baseAudit({
    authUsers: 54, profiles: 54, bots: 14, humans: 40,
    authIdentities: 5, authSessions: 76, matches: 230,
  })]);
  assert.equal(assertProductionWipePreflight(before), before);
  guarded(() => assertProductionWipePreflight({
    ...before, storageObjects: 1, authOwnedStorageObjects: 1,
  }), /Storage objects/);
  const blank = validateBaseProductionTestDataAudit([baseAudit()]);
  assert.equal(assertProductionWipeComplete(blank), blank);
  guarded(() => assertProductionWipeComplete({ ...blank, matchCommands: 1 }), /matchCommands/);
  guarded(() => validateBaseProductionTestDataAudit([{ ...baseAudit(), unexpected: 0 }]), /unexpected shape/);
});

check('Rune stage permits only wholly absent or exact presence and empty tables stay empty', () => {
  assert.equal(validateRuneTrialProductionStage([runeStage(false)]), 0);
  assert.equal(validateRuneTrialProductionStage([runeStage(true)]), 1);
  guarded(() => validateRuneTrialProductionStage([
    runeStage(false, { migrationHistory: true }),
  ]), /partial/);
  assert.deepEqual(validateEmptyRuneTrialDataAudit([emptyRune()]), emptyRune());
  guarded(() => validateEmptyRuneTrialDataAudit([emptyRune({ playerRunes: 1 })]), /not empty/);
});

check('streak-baseline stage permits only wholly absent or exact presence', () => {
  assertStreakBaselineStage(guarded);
});

check('seed audit proves exact cardinality, no humans/orphans/data, unique points, and varied stats', () => {
  assertExactSeedAudit(guarded);
});

check('refresh audit accepts only the exact untouched or exact refreshed 150-bot states', () => {
  assertRefreshAudit(guarded);
});

check('executor rejects every SQL program outside the reviewed constants', () => {
  assert.throws(
    () => executeFixedProductionTestDataSql('delete from auth.users;'),
    /only its fixed SQL programs/,
  );

  let removed = false;
  assert.throws(() => executeFixedProductionTestDataSql(WIPE_PRODUCTION_ACCOUNTS_SQL, {
    createTemp: () => os.tmpdir(),
    removeTemp: () => { removed = true; },
  }), /Refusing unsafe production test-data temporary directory/);
  assert.equal(removed, false, 'an unvalidated broad path was recursively removed');
});

await checkAsync('exact Rune prerequisite reuses full schema, body, grant, RLS, publication, cron, and baseline audits', async () => {
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
});

await checkAsync('exact streak-baseline prerequisite reuses catalog, ACL, body, and data audits', async () => {
  await assertExactStreakBaselinePrerequisite();
});

await checkAsync('wipe orchestration previews without writes and applies only through the fixed SQL', async () => {
  const before = baseAudit({ authUsers: 54, profiles: 54, bots: 14, humans: 40, matches: 230 });
  const after = baseAudit();
  const reads = new Map<string, unknown[][]>([
    [RUNE_TRIAL_PRODUCTION_STAGE_SQL, [[runeStage(false)]]],
    [LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL, [[streakBaselineStage(false)]]],
    [BASE_PRODUCTION_TEST_DATA_AUDIT_SQL, [[before], [after]]],
  ]);
  const read = async (query: string) => reads.get(query)!.shift()!;
  const executed: string[] = [];
  let verified = 0;
  const result = await rolloutProductionTestData({
    phase: 'wipe',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS.wipe.value,
    read,
    verifyEnvironment: () => { verified++; },
    execute: sql => { executed.push(sql); },
    log: () => {},
  });
  assert.equal(result.applied, true);
  assert.equal(verified, 1);
  assert.deepEqual(executed, [WIPE_PRODUCTION_ACCOUNTS_SQL]);

  let previewWrites = 0;
  await rolloutProductionTestData({
    phase: 'wipe',
    read: async query => {
      if (query === RUNE_TRIAL_PRODUCTION_STAGE_SQL) return [runeStage(false)];
      if (query === LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL) {
        return [streakBaselineStage(false)];
      }
      return [before];
    },
    verifyEnvironment: () => {},
    execute: () => { previewWrites++; },
    log: () => {},
  });
  assert.equal(previewWrites, 0);
});

await checkAsync('seed orchestration hard-blocks absent migration and rechecks exact prerequisite before its fixed write', async () => {
  let writes = 0;
  await assert.rejects(() => rolloutProductionTestData({
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
    verifyEnvironment: () => {},
    exactBotSeedPrerequisite: async () => { throw new Error('must not run'); },
    execute: () => { writes++; },
    log: () => {},
  }), /migrations must be complete/);
  assert.equal(writes, 0);

  const read = async (query: string) => {
    if (query === RUNE_TRIAL_PRODUCTION_STAGE_SQL) return [runeStage(true)];
    if (query === LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL) {
      return [streakBaselineStage(true)];
    }
    if (query === BASE_PRODUCTION_TEST_DATA_AUDIT_SQL) return [baseAudit()];
    if (query === EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL) return [emptyRune()];
    if (query === SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL) return [seededAudit()];
    throw new Error('unexpected query');
  };
  let exactChecks = 0;
  const executed: string[] = [];
  const result = await rolloutProductionTestData({
    phase: 'seed-bots',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS['seed-bots'].value,
    read,
    verifyEnvironment: () => {},
    exactBotSeedPrerequisite: async () => { exactChecks++; return { ledgerStage: 1 }; },
    execute: sql => { executed.push(sql); },
    log: () => {},
  });
  assert.equal(result.applied, true);
  assert.equal(exactChecks, 3);
  assert.deepEqual(executed, [SEED_PRODUCTION_BOTS_SQL]);
});

await checkAsync('profile refresh writes only the exact legacy seed and no-ops when already current', async () => {
  await assertBotProfileRefreshOrchestration();
});

if (problems.length) {
  console.error(JSON.stringify({ out: { productionTestData: false }, checked, problems }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    out: { productionTestData: true, checks: checked.length },
    problems: [],
    errs: [],
  }, null, 2));
}
