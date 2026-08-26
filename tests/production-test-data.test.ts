import assert from 'node:assert/strict';
import os from 'node:os';
import { createCliRunner } from '../tools/database/cli-runner.mjs';
import {
  BASE_PRODUCTION_TEST_DATA_AUDIT_SQL,
  PRODUCTION_HUMAN_WIPE_OPT_IN,
  PRODUCTION_TEST_DATA_CLI_VERSION,
  PRODUCTION_TEST_DATA_OPT_INS,
  PRODUCTION_TEST_DATA_PROJECT_REF,
  PRODUCTION_WIPE_HUMAN_ACCOUNT_CEILING,
  ProductionTestDataGuardError,
  REFRESH_PRODUCTION_BOT_PROFILES_SQL,
  SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL,
  SEED_PRODUCTION_BOTS_SQL,
  WIPE_PRODUCTION_ACCOUNTS_SQL,
  WIPE_PRODUCTION_HUMAN_ACCOUNTS_SQL,
  assertPinnedProductionCli,
  assertProductionProjectBinding,
  assertProductionRepositoryState,
  assertProductionTestDataOptIn,
  assertProductionWipeComplete,
  assertProductionWipeHumanOptIn,
  assertProductionWipePreflight,
  productionTestDataQueryArgs,
  validateBaseProductionTestDataAudit,
  validateEmptyRuneTrialDataAudit,
  validateProductionTestDataPhase,
  validateRuneTrialProductionStage,
} from '../tools/database/production-test-data-core.mjs';
import {
  executeFixedProductionTestDataSql,
} from '../tools/database/production-test-data.mjs';
import {
  baseAudit,
  emptyRune,
  runeStage,
} from './support/production-test-data-cases.ts';
import {
  assertExactRuneTrialPrerequisite,
  assertHumanWipeOverride,
  assertSeedOrchestration,
  assertWipeOrchestration,
} from './support/production-test-data-orchestration-cases.ts';
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

check('human-account ceiling admits only the second distinct literal opt-in', () => {
  assert.equal(PRODUCTION_WIPE_HUMAN_ACCOUNT_CEILING, 0);
  assert.notEqual(PRODUCTION_HUMAN_WIPE_OPT_IN.name, PRODUCTION_TEST_DATA_OPT_INS.wipe.name);
  assert.notEqual(PRODUCTION_HUMAN_WIPE_OPT_IN.value, PRODUCTION_TEST_DATA_OPT_INS.wipe.value);
  assert.equal(assertProductionWipeHumanOptIn(0, true, undefined), false);
  assert.equal(assertProductionWipeHumanOptIn(1, false, undefined), true);
  assert.equal(assertProductionWipeHumanOptIn(40, true, PRODUCTION_HUMAN_WIPE_OPT_IN.value), true);
  guarded(() => assertProductionWipeHumanOptIn(
    1, true, undefined,
  ), /human accounts over the test-data ceiling/);
  guarded(() => assertProductionWipeHumanOptIn(
    1, true, PRODUCTION_TEST_DATA_OPT_INS.wipe.value,
  ), /WIPE_REAL_HUMAN_ACCOUNTS/);
  guarded(() => assertProductionWipeHumanOptIn(-1, true, undefined), /non-negative integer/);
});

check('shared CLI runner announces, disables telemetry, and fails closed on any exit state', () => {
  const announced: string[] = [];
  const environments: Array<Record<string, string | undefined>> = [];
  const runner = createCliRunner({
    env: { PATH: '/usr/bin' },
    spawn: ((command: string, args: string[], options: { env: Record<string, string> }) => {
      environments.push(options.env);
      return { status: 0, stdout: ' ok \n', stderr: '', signal: null };
    }) as never,
    announce: (message: string) => { announced.push(message); },
  });
  assert.equal(runner.capture('git', ['status', 'a b']), 'ok');
  assert.deepEqual(announced, ['$ git status "a b"']);
  assert.equal(environments[0].SUPABASE_TELEMETRY_DISABLED, '1');
  assert.equal(environments[0].PATH, '/usr/bin');
  const failing = createCliRunner({
    spawn: (() => ({ status: 1, stdout: '', stderr: 'boom', signal: null })) as never,
    announce: () => {},
  });
  assert.throws(() => failing.run('supabase', ['db', 'query']), /supabase db query exited with 1\nboom/);
  const killed = createCliRunner({
    spawn: (() => ({ status: null, stdout: '', stderr: '', signal: 'SIGKILL' })) as never,
    announce: () => {},
  });
  assert.throws(() => killed.capture('supabase', ['--version']), /was terminated by SIGKILL/);
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

check('standard wipe refuses humans inside the transaction; only the override program omits the guard', () => {
  assert.ok(WIPE_PRODUCTION_ACCOUNTS_SQL.includes(
    `(select count(*) from public.profiles where not is_bot)\n       > ${PRODUCTION_WIPE_HUMAN_ACCOUNT_CEILING} then`,
  ));
  assert.match(WIPE_PRODUCTION_ACCOUNTS_SQL, /human accounts over the test-data ceiling/);
  assert.doesNotMatch(WIPE_PRODUCTION_HUMAN_ACCOUNTS_SQL, /test-data ceiling/);
  // The override program must be the standard transaction minus exactly the
  // ceiling guard — nothing else may diverge between the two fixed programs.
  const guardStart = WIPE_PRODUCTION_ACCOUNTS_SQL.indexOf('  -- Launch guard');
  const guardEnd = WIPE_PRODUCTION_ACCOUNTS_SQL.indexOf(
    '  if (select count(*) from public.seasons', guardStart,
  );
  assert.ok(guardStart > 0 && guardEnd > guardStart);
  assert.equal(
    WIPE_PRODUCTION_ACCOUNTS_SQL.slice(0, guardStart)
      + WIPE_PRODUCTION_ACCOUNTS_SQL.slice(guardEnd),
    WIPE_PRODUCTION_HUMAN_ACCOUNTS_SQL,
  );
});

check('ranked pool tier CASE is registry-derived and byte-identical to the reviewed literals', () => {
  const tierCase = (peak: string) => `(case
  when coalesce(${peak}, 0) >= 720 then 'ivory'
  when coalesce(${peak}, 0) >= 300 then 'bone'
  else 'stone'
end)`;
  assert.ok(SEED_PRODUCTION_BOTS_SQL.includes(`ranked_pool_tier = ${tierCase('seed_row.peak')}`));
  assert.ok(SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL.includes(tierCase('rating.peak')));
  assert.ok(REFRESH_PRODUCTION_BOT_PROFILES_SQL.includes(tierCase('plan.new_peak')));
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

  // The human-account override is a fixed reviewed program too: it must pass
  // the allow-list and then stop at the same temp-directory validation.
  assert.throws(() => executeFixedProductionTestDataSql(WIPE_PRODUCTION_HUMAN_ACCOUNTS_SQL, {
    createTemp: () => os.tmpdir(),
    removeTemp: () => { removed = true; },
  }), /Refusing unsafe production test-data temporary directory/);
  assert.equal(removed, false, 'an unvalidated broad path was recursively removed');
});

await checkAsync('exact Rune prerequisite reuses full schema, body, grant, RLS, publication, cron, and baseline audits', async () => {
  await assertExactRuneTrialPrerequisite();
});

await checkAsync('exact streak-baseline prerequisite reuses catalog, ACL, body, and data audits', async () => {
  await assertExactStreakBaselinePrerequisite();
});

await checkAsync('wipe orchestration previews without writes and applies only through the fixed SQL', async () => {
  await assertWipeOrchestration();
});

await checkAsync('wipe refuses live human accounts unless the distinct override literal is present', async () => {
  await assertHumanWipeOverride();
});

await checkAsync('seed orchestration hard-blocks absent migration and rechecks exact prerequisite before its fixed write', async () => {
  await assertSeedOrchestration();
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
