import assert from 'node:assert/strict';
import {
  ProductionRolloutGuardError,
  assertConfiguredLinkedProjectRef,
  assertExactApply,
  assertExactDryRun,
  assertProductionApplyOptIn,
  assertSameRolloutPlan,
  computeAppliedPrefixPendingSuffix,
  parseCliJson,
  parseMigrationFilename,
  parseMigrationListJson,
  productionDbPushArgs,
  productionMigrationFetchArgs,
  validateMigrationFilenames,
  withTemporaryWorkspace,
} from '../tools/database/production-rollout-core.mjs';
import { runProductionMigrationSchemaCases } from './support/production-migration-schema-cases.ts';

const BASE = '20260823192604_player_settings.sql';
const LOCALE = '20260824133121_player_settings_locale.sql';
const EXPANDED_LOCALES = '20260825161016_expand_player_settings_locales.sql';
const GAME_CENTER = '20260823132611_game_center_service_grants.sql';
const RETENTION = '20260824212535_match_command_retention.sql';
const PROJECT = 'euzjcejbkxvqfrttgaxu';
const checked: string[] = [];
const problems: string[] = [];
const errs: string[] = [];

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
  assert.throws(run, (error: unknown) => error instanceof ProductionRolloutGuardError
    && pattern.test(error.message));
}

function dryRun(migrations: string[], overrides: Record<string, unknown> = {}) {
  return {
    upToDate: migrations.length === 0,
    dryRun: true,
    migrations,
    seeds: [],
    roles: [],
    message: 'Finished supabase db push.',
    ...overrides,
  };
}

check('CLI JSON parser accepts log lines before the final object', () => {
  assert.deepEqual(parseCliJson('Connecting to remote database...\n{\n  "ok": true\n}\n'), { ok: true });
});

check('CLI JSON parser rejects malformed and non-object output', () => {
  guarded(() => parseCliJson('Connecting...\n{ nope'), /valid JSON/);
  guarded(() => parseCliJson('[1, 2, 3]'), /JSON object/);
});

check('migration-list JSON exposes validated local and remote versions', () => {
  const parsed = parseMigrationListJson(`log line\n${JSON.stringify({
    migrations: [
      { local: '20260823192604', remote: '20260823192604', time: '2026-08-23 19:26:04' },
      { local: '20260824133121', remote: '', time: '2026-08-24 13:31:21' },
    ],
    message: 'Migrations listed',
  }, null, 2)}`);
  assert.deepEqual(parsed.migrations.map(row => [row.local, row.remote]), [
    ['20260823192604', '20260823192604'],
    ['20260824133121', ''],
  ]);
  guarded(() => parseMigrationListJson('{"migrations":{},"message":"bad"}'), /field types/);
  guarded(() => parseMigrationListJson(JSON.stringify({
    migrations: [{ local: 'not-a-version', remote: '', time: '' }],
    message: 'bad',
  })), /digit migration version/);
});

check('migration filenames are extracted, ordered, and path-safe', () => {
  assert.deepEqual(parseMigrationFilename(BASE), {
    filename: BASE,
    version: '20260823192604',
    name: 'player_settings',
  });
  assert.equal(validateMigrationFilenames([BASE, LOCALE, EXPANDED_LOCALES]).length, 3);
  guarded(() => parseMigrationFilename(`../${BASE}`), /Invalid migration filename/);
  guarded(() => validateMigrationFilenames([LOCALE, BASE]), /strictly increasing/);
  guarded(
    () => validateMigrationFilenames([BASE, '20260823192604_duplicate.sql']),
    /Duplicate migration version/,
  );
});

check('ordered migration state accepts complete settings stages zero through three', () => {
  assert.deepEqual(computeAppliedPrefixPendingSuffix([BASE, LOCALE, EXPANDED_LOCALES], []), {
    stage: 0,
    applied: [],
    pending: [BASE, LOCALE, EXPANDED_LOCALES],
  });
  assert.deepEqual(computeAppliedPrefixPendingSuffix(
    [BASE, LOCALE, EXPANDED_LOCALES],
    ['20260823192604', '99999999999999'],
  ), {
    stage: 1,
    applied: [BASE],
    pending: [LOCALE, EXPANDED_LOCALES],
  });
  assert.deepEqual(computeAppliedPrefixPendingSuffix(
    [BASE, LOCALE, EXPANDED_LOCALES],
    ['20260823192604', '20260824133121'],
  ), {
    stage: 2,
    applied: [BASE, LOCALE],
    pending: [EXPANDED_LOCALES],
  });
  assert.deepEqual(computeAppliedPrefixPendingSuffix(
    [BASE, LOCALE, EXPANDED_LOCALES],
    ['20260823192604', '20260824133121', '20260825161016'],
  ), {
    stage: 3,
    applied: [BASE, LOCALE, EXPANDED_LOCALES],
    pending: [],
  });
});

check('ordered migration state rejects a later migration without its predecessor', () => {
  guarded(
    () => computeAppliedPrefixPendingSuffix(
      [BASE, LOCALE, EXPANDED_LOCALES],
      ['20260825161016'],
    ),
    /selected predecessor/,
  );
});

check('exact dry-run accepts only the selected pending suffix', () => {
  assert.deepEqual(assertExactDryRun(
    `Preparing...\n${JSON.stringify(dryRun([BASE, LOCALE, EXPANDED_LOCALES]), null, 2)}`,
    [BASE, LOCALE, EXPANDED_LOCALES],
  ), { migrations: [BASE, LOCALE, EXPANDED_LOCALES] });
});

check('exact dry-run rejects an extra held Game Center migration', () => {
  guarded(
    () => assertExactDryRun(
      dryRun([GAME_CENTER, BASE, LOCALE, EXPANDED_LOCALES]),
      [BASE, LOCALE, EXPANDED_LOCALES],
    ),
    /allow-list and order/,
  );
});

check('exact dry-run rejects missing, reordered, seeded, and role-bearing plans', () => {
  const expected = [BASE, LOCALE, EXPANDED_LOCALES];
  guarded(() => assertExactDryRun(dryRun([BASE, LOCALE]), expected), /allow-list and order/);
  guarded(() => assertExactDryRun(dryRun([LOCALE, BASE, EXPANDED_LOCALES]), expected), /strictly increasing/);
  guarded(
    () => assertExactDryRun(dryRun(expected, { seeds: ['seed.sql'] }), expected),
    /seeds or roles/,
  );
  guarded(
    () => assertExactDryRun(dryRun(expected, { roles: ['roles.sql'] }), expected),
    /seeds or roles/,
  );
});

check('exact apply requires the complete non-dry-run CLI response', () => {
  const expected = [BASE, LOCALE, EXPANDED_LOCALES];
  const applied = dryRun(expected, { dryRun: false });
  assert.deepEqual(assertExactApply(applied, expected), {
    migrations: expected,
  });
  guarded(() => assertExactApply(dryRun(expected), expected), /exact apply/);
  guarded(
    () => assertExactApply({ ...applied, upToDate: true }, expected),
    /up-to-date state/,
  );
  const { roles: _roles, ...withoutRoles } = applied;
  guarded(() => assertExactApply(withoutRoles, expected), /unexpected shape/);
  guarded(
    () => assertExactApply({ ...applied, roles: null }, expected),
    /invalid field types/,
  );
  guarded(
    () => assertExactApply({ ...applied, unexpected: true }, expected),
    /unexpected shape/,
  );
  guarded(
    () => assertExactApply({ ...applied, migrations: [LOCALE, BASE, EXPANDED_LOCALES] }, expected),
    /strictly increasing/,
  );
});

check('configured, linked, and explicit production refs must all agree', () => {
  assert.equal(assertConfiguredLinkedProjectRef(PROJECT, `${PROJECT}\n`, PROJECT), PROJECT);
  guarded(
    () => assertConfiguredLinkedProjectRef(PROJECT, 'aaaaaaaaaaaaaaaaaaaa', PROJECT),
    /project ref mismatch/,
  );
  guarded(
    () => assertConfiguredLinkedProjectRef(PROJECT, PROJECT, 'not-a-project'),
    /not a valid Supabase project ref/,
  );
});

check('production CLI argv is explicitly bound and excludes expansive inputs', () => {
  const fetch = productionMigrationFetchArgs('/tmp/kb-safe', PROJECT);
  const preview = productionDbPushArgs('/tmp/kb-safe', PROJECT, true);
  const apply = productionDbPushArgs('/tmp/kb-safe', PROJECT, false);
  assert.deepEqual(fetch, [
    'migration', 'fetch', '--workdir', '/tmp/kb-safe', '--linked', '--project-ref', PROJECT,
  ]);
  assert.deepEqual(preview, [
    'db', 'push', '--workdir', '/tmp/kb-safe', '--linked', '--project-ref', PROJECT,
    '--dry-run', '--skip-vault', '--yes',
  ]);
  assert.deepEqual(apply, [
    'db', 'push', '--workdir', '/tmp/kb-safe', '--linked', '--project-ref', PROJECT,
    '--skip-vault', '--yes',
  ]);
  for (const args of [fetch, preview, apply]) {
    assert.equal(args.includes('--include-all'), false);
    assert.equal(args.includes('--include-seed'), false);
    assert.equal(args.includes('--include-roles'), false);
    assert.equal(args.includes('reset'), false);
    assert.equal(args.includes('repair'), false);
  }
  guarded(() => productionDbPushArgs('/tmp/kb-safe', 'wrong', false), /project ref/);
  guarded(() => productionDbPushArgs('/tmp/kb-safe', PROJECT, 'no' as never), /must be boolean/);
});

check('apply opt-in and repeated audit plan both fail closed', () => {
  assert.equal(assertProductionApplyOptIn(false, undefined), false);
  assert.equal(assertProductionApplyOptIn(true, '1'), true);
  guarded(() => assertProductionApplyOptIn(true, undefined), /environment opt-in/);
  const plan = { stage: 0, applied: [], pending: [BASE, LOCALE, EXPANDED_LOCALES] };
  assert.deepEqual(assertSameRolloutPlan(plan, { ...plan }), plan);
  guarded(
    () => assertSameRolloutPlan(
      plan,
      { stage: 1, applied: [BASE], pending: [LOCALE, EXPANDED_LOCALES] },
    ),
    /changed during planning/,
  );
});

runProductionMigrationSchemaCases({
  check,
  guarded,
  retentionMigration: RETENTION,
  expandedLocalesMigration: EXPANDED_LOCALES,
});

await checkAsync('temporary workspace cleanup runs after success and preparation failure', async () => {
  const removed: string[] = [];
  const result = await withTemporaryWorkspace(
    () => '/tmp/kb-created',
    (workdir) => removed.push(workdir),
    async (workdir) => `${workdir}/done`,
  );
  assert.equal(result, '/tmp/kb-created/done');
  assert.deepEqual(removed, ['/tmp/kb-created']);

  await assert.rejects(
    withTemporaryWorkspace(
      () => '/tmp/kb-failed',
      (workdir) => removed.push(workdir),
      async () => { throw new Error('fetch failed'); },
    ),
    /fetch failed/,
  );
  assert.deepEqual(removed, ['/tmp/kb-created', '/tmp/kb-failed']);
});

console.log(JSON.stringify({ checked, problems, errs }, null, 2));
process.exitCode = problems.length || errs.length ? 1 : 0;
