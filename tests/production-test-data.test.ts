import assert from 'node:assert/strict';
import os from 'node:os';
import {
  BASE_PRODUCTION_TEST_DATA_AUDIT_SQL,
  EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL,
  PRODUCTION_BOT_SEED_PLAN,
  PRODUCTION_TEST_DATA_CLI_VERSION,
  PRODUCTION_TEST_DATA_OPT_INS,
  PRODUCTION_TEST_DATA_PROJECT_REF,
  ProductionTestDataGuardError,
  RUNE_TRIAL_PRODUCTION_STAGE_SQL,
  SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL,
  SEED_PRODUCTION_BOTS_SQL,
  WIPE_PRODUCTION_ACCOUNTS_SQL,
  assertPinnedProductionCli,
  assertProductionBotSeedComplete,
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
  validateSeededProductionTestDataAudit,
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
} from './support/production-test-data-cases.ts';

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
  guarded(() => validateProductionTestDataPhase('reset'), /must be one of/);
  assert.equal(assertProductionTestDataOptIn('wipe', false, undefined), false);
  assert.equal(assertProductionTestDataOptIn(
    'wipe', true, PRODUCTION_TEST_DATA_OPT_INS.wipe.value,
  ), true);
  guarded(() => assertProductionTestDataOptIn(
    'wipe', true, PRODUCTION_TEST_DATA_OPT_INS['seed-bots'].value,
  ), /WIPE_ALL_ACCOUNTS/);
  guarded(() => assertProductionTestDataOptIn('seed-bots', true, '150'), /SEED_EXACTLY_150_BOTS/);
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

check('canonical seed has exactly 150 unique deterministic points and varied records in all groups', () => {
  assert.equal(PRODUCTION_BOT_SEED_PLAN.length, 150);
  assert.equal(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.points)).size, 150);
  assert.equal(PRODUCTION_BOT_SEED_PLAN[0].points, 0);
  assert.equal(PRODUCTION_BOT_SEED_PLAN.at(-1)?.points, 4600);
  assert.ok(PRODUCTION_BOT_SEED_PLAN.every((row, index) => row.ordinal === index + 1));
  assert.ok(PRODUCTION_BOT_SEED_PLAN.every(row => row.wins > 0 && row.losses > 0 && row.draws >= 0));
  assert.ok(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.wins)).size >= 20);
  assert.ok(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.losses)).size >= 20);
  assert.equal(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.draws)).size, 4);
  for (const [min, max] of [[0, 300], [300, 720], [720, 1260], [1260, 2010],
    [2010, 3000], [3000, 4350], [4350, Number.POSITIVE_INFINITY]]) {
    assert.ok(PRODUCTION_BOT_SEED_PLAN.some(row => row.points >= min && row.points < max));
  }
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
  ]) assert.ok(WIPE_PRODUCTION_ACCOUNTS_SQL.includes(table));
  assert.match(WIPE_PRODUCTION_ACCOUNTS_SQL, /with recursive account_graph/);
  assert.match(WIPE_PRODUCTION_ACCOUNTS_SQL, /pg_constraint/);
  assert.doesNotMatch(WIPE_PRODUCTION_ACCOUNTS_SQL, /delete from auth\.(oauth_clients|sso_providers|sso_domains|saml_providers|custom_oauth_providers)/);
});

check('seed SQL uses canonical minting and writes rating, season, tier, stats, and all postchecks atomically', () => {
  assert.match(SEED_PRODUCTION_BOTS_SQL, /^\s*begin;/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /commit;\s*$/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /public\.mint_bot\(seed_row\.points\)/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /insert into public\.season_ratings/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /ranked_pool_tier = private\.ranked_pool_tier_for_peak/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /count\(distinct points\).*<> 150/s);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /max\(points\).*<> 4600/s);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /seed created unexpected Auth or ranked rows/);
  assert.doesNotMatch(SEED_PRODUCTION_BOTS_SQL, /generate_series|\btruncate\b/i);
  assert.equal((SEED_PRODUCTION_BOTS_SQL.match(/^\s*\(\d+, \d+, \d+, \d+, \d+\),?$/gm) ?? []).length, 150);
});

check('base audits enforce Auth/profile consistency, Storage safety, and complete wipe', () => {
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

check('seed audit proves exact cardinality, no humans/orphans/data, unique points, and varied stats', () => {
  const audit = validateSeededProductionTestDataAudit([seededAudit()]);
  assert.equal(assertProductionBotSeedComplete(audit), audit);
  guarded(() => assertProductionBotSeedComplete({ ...audit, humans: 1, bots: 149 }), /bots=149|ownership graph/);
  guarded(() => assertProductionBotSeedComplete({ ...audit, playerRunes: 1 }), /playerRunes/);
  guarded(() => assertProductionBotSeedComplete({ ...audit, neonPointBots: 0 }), /neonPointBots/);
});

check('executor rejects every SQL program outside the two reviewed constants', () => {
  assert.throws(
    () => executeFixedProductionTestDataSql('delete from auth.users;'),
    /only its two fixed SQL programs/,
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

await checkAsync('wipe orchestration previews without writes and applies only through the fixed SQL', async () => {
  const before = baseAudit({ authUsers: 54, profiles: 54, bots: 14, humans: 40, matches: 230 });
  const after = baseAudit();
  const reads = new Map<string, unknown[][]>([
    [RUNE_TRIAL_PRODUCTION_STAGE_SQL, [[runeStage(false)]]],
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
    read: async query => query === RUNE_TRIAL_PRODUCTION_STAGE_SQL
      ? [runeStage(false)] : [before],
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
    read: async query => query === RUNE_TRIAL_PRODUCTION_STAGE_SQL
      ? [runeStage(false)] : [baseAudit()],
    verifyEnvironment: () => {},
    exactRunePrerequisite: async () => { throw new Error('must not run'); },
    execute: () => { writes++; },
    log: () => {},
  }), /migration must be complete/);
  assert.equal(writes, 0);

  const read = async (query: string) => {
    if (query === RUNE_TRIAL_PRODUCTION_STAGE_SQL) return [runeStage(true)];
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
    exactRunePrerequisite: async () => { exactChecks++; return { ledgerStage: 1 }; },
    execute: sql => { executed.push(sql); },
    log: () => {},
  });
  assert.equal(result.applied, true);
  assert.equal(exactChecks, 3);
  assert.deepEqual(executed, [SEED_PRODUCTION_BOTS_SQL]);
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
