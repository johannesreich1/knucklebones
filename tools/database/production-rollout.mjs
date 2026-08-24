// Guarded, allow-listed production migrations. The repository migration
// directory is intentionally not used as a db-push workdir: its compact local
// history differs from the canonical timestamped production ledger.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPABASE_PROJECT_REF } from '../../src/config.ts';
import { productionRead } from '../debug/production-read.mjs';
import {
  assertConfiguredLinkedProjectRef,
  assertExactApply,
  assertExactDryRun,
  assertProductionApplyOptIn,
  assertSameRolloutPlan,
  computeAppliedPrefixPendingSuffix,
  parseCliJson,
  parseMigrationFilename,
  productionDbPushArgs,
  productionMigrationFetchArgs,
  validatePlayerSettingsSchemaStage,
  withTemporaryWorkspace,
} from './production-rollout-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI_VERSION = '2.115.0';
const CLI = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
);
const PROD_OPT_IN = 'KB_ALLOW_PRODUCTION_DB_MIGRATIONS';

const ROLLOUTS = Object.freeze({
  'settings-locale': Object.freeze({
    migrations: Object.freeze([
      Object.freeze({
        version: '20260823192604',
        name: 'player_settings',
        file: 'supabase/migrations/20260823192604_player_settings.sql',
        sha256: 'a4a62ac3af0e6a3523999d5e49b60e2a425af5604551a2ccefe18e212c0025fb',
      }),
      Object.freeze({
        version: '20260824133121',
        name: 'player_settings_locale',
        file: 'supabase/migrations/20260824133121_player_settings_locale.sql',
        sha256: '9bf3236179c2891c729f434fbb99855aae39cf05e781bb0d13711d73f7b15ffa',
      }),
    ]),
  }),
});

export const SETTINGS_SCHEMA = String.raw`
select
  to_regclass('public.player_settings') is not null as table_exists,
  coalesce((select c.relrowsecurity
              from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'player_settings'), false)
    as rls_enabled,
  (select count(*) between 7 and 8
          and count(*) filter (where column_name = 'user_id' and data_type = 'uuid'
                                and is_nullable = 'NO' and column_default is null
                                and is_identity = 'NO' and is_generated = 'NEVER') = 1
          and count(*) filter (where column_name = 'sound' and data_type = 'boolean'
                                and is_nullable = 'NO' and column_default = 'true') = 1
          and count(*) filter (where column_name = 'numerals' and data_type = 'boolean'
                                and is_nullable = 'NO' and column_default = 'false') = 1
          and count(*) filter (where column_name = 'p1_hue' and data_type = 'text'
                                and is_nullable = 'NO' and column_default = '''cy''::text') = 1
          and count(*) filter (where column_name = 'p2_hue' and data_type = 'text'
                                and is_nullable = 'NO' and column_default = '''mg''::text') = 1
          and count(*) filter (where column_name = 'colorblind' and data_type = 'boolean'
                                and is_nullable = 'NO' and column_default = 'false') = 1
          and count(*) filter (where column_name = 'reduced_motion' and data_type = 'boolean'
                                and is_nullable = 'YES' and column_default is null) = 1
          and count(*) filter (where column_name not in
                                ('user_id', 'sound', 'numerals', 'p1_hue', 'p2_hue',
                                 'colorblind', 'reduced_motion', 'locale')) = 0
     from information_schema.columns
    where table_schema = 'public' and table_name = 'player_settings')
    as base_columns,
  exists (select 1 from pg_constraint
           where conrelid = to_regclass('public.player_settings')
             and conname = 'player_settings_pkey' and contype = 'p' and convalidated
             and pg_get_constraintdef(oid, true) = 'PRIMARY KEY (user_id)')
    as primary_key,
  exists (select 1 from pg_constraint
           where conrelid = to_regclass('public.player_settings')
             and conname = 'player_settings_user_id_fkey' and contype = 'f'
             and convalidated and not condeferrable
             and pg_get_constraintdef(oid, true) =
                 'FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE')
    as cascade_profile_fk,
  (select count(*) = 3
          and count(*) filter (
                where conname = 'player_settings_p1_hue_check' and contype = 'c'
                  and convalidated and pg_get_constraintdef(oid, true) =
                    $p1$CHECK (p1_hue = ANY (ARRAY['cy'::text, 'mg'::text, 'gold'::text, 'green'::text, 'violet'::text, 'orange'::text, 'blue'::text]))$p1$) = 1
          and count(*) filter (
                where conname = 'player_settings_p2_hue_check' and contype = 'c'
                  and convalidated and pg_get_constraintdef(oid, true) =
                    $p2$CHECK (p2_hue = ANY (ARRAY['cy'::text, 'mg'::text, 'gold'::text, 'green'::text, 'violet'::text, 'orange'::text, 'blue'::text]))$p2$) = 1
          and count(*) filter (
                where conname = 'player_settings_check' and contype = 'c'
                  and convalidated and pg_get_constraintdef(oid, true) =
                    'CHECK (p1_hue <> p2_hue)') = 1
     from pg_constraint
    where conrelid = to_regclass('public.player_settings')
      and conname in ('player_settings_p1_hue_check',
                      'player_settings_p2_hue_check', 'player_settings_check'))
    and not exists (
      select 1 from pg_constraint
       where conrelid = to_regclass('public.player_settings')
         and conname not in ('player_settings_pkey', 'player_settings_user_id_fkey',
                             'player_settings_p1_hue_check',
                             'player_settings_p2_hue_check', 'player_settings_check',
                             'player_settings_locale_check'))
    as base_checks,
  (select count(*) = 3
          and count(*) filter (where policyname = 'player_settings_select_own'
                                and permissive = 'PERMISSIVE'
                                and roles = array['authenticated']::name[]
                                and cmd = 'SELECT'
                                and qual = $predicate$(user_id = ( SELECT auth.uid() AS uid))$predicate$
                                and with_check is null) = 1
          and count(*) filter (where policyname = 'player_settings_insert_own'
                                and permissive = 'PERMISSIVE'
                                and roles = array['authenticated']::name[]
                                and cmd = 'INSERT' and qual is null
                                and with_check = $predicate$(user_id = ( SELECT auth.uid() AS uid))$predicate$) = 1
          and count(*) filter (where policyname = 'player_settings_update_own'
                                and permissive = 'PERMISSIVE'
                                and roles = array['authenticated']::name[]
                                and cmd = 'UPDATE'
                                and qual = $predicate$(user_id = ( SELECT auth.uid() AS uid))$predicate$
                                and with_check = $predicate$(user_id = ( SELECT auth.uid() AS uid))$predicate$) = 1
     from pg_policies
    where schemaname = 'public' and tablename = 'player_settings')
    as owner_policies,
  coalesce((select array_agg(distinct a.privilege_type::text
                             order by a.privilege_type::text)
              from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
              cross join lateral aclexplode(
                coalesce(c.relacl, acldefault('r', c.relowner))) a
              join pg_roles r on r.oid = a.grantee
             where n.nspname = 'public' and c.relname = 'player_settings'
               and r.rolname = 'authenticated'), array[]::text[])
    = array['INSERT', 'SELECT', 'UPDATE']::text[] as authenticated_grants,
  not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(
        coalesce(c.relacl, acldefault('r', c.relowner))) a
      left join pg_roles r on r.oid = a.grantee
     where n.nspname = 'public' and c.relname = 'player_settings'
       and (a.grantee = 0 or r.rolname = 'anon')) as anon_locked,
  coalesce((select array_agg(distinct a.privilege_type::text
                             order by a.privilege_type::text)
              from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
              cross join lateral aclexplode(
                coalesce(c.relacl, acldefault('r', c.relowner))) a
              join pg_roles r on r.oid = a.grantee
             where n.nspname = 'public' and c.relname = 'player_settings'
               and r.rolname = 'service_role'), array[]::text[])
    = array['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER',
            'TRUNCATE', 'UPDATE']::text[]
    as service_role_grants,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'player_settings'
             and column_name = 'locale') as locale_column,
  coalesce((select data_type = 'text' and is_nullable = 'YES' and column_default is null
              from information_schema.columns
             where table_schema = 'public' and table_name = 'player_settings'
               and column_name = 'locale'), false) as locale_shape,
  coalesce((select convalidated
                    and pg_get_constraintdef(oid, true) =
                      $constraint$CHECK (locale IS NULL OR (locale = ANY (ARRAY['en'::text, 'de'::text, 'fr'::text])))$constraint$
              from pg_constraint
             where conrelid = to_regclass('public.player_settings')
               and conname = 'player_settings_locale_check'
               and contype = 'c'), false) as locale_constraint,
  coalesce((select col_description(to_regclass('public.player_settings'), ordinal_position::integer)
                    = 'Null follows the current device language; otherwise a supported base locale override.'
              from information_schema.columns
             where table_schema = 'public' and table_name = 'player_settings'
               and column_name = 'locale'), false) as locale_comment;
`;

export const VALID_LOCALE_VALUES = String.raw`
select count(*) filter (
         where locale is not null and locale <> all(array['en', 'de', 'fr']::text[])
       )::integer as invalid_locale_count
  from public.player_settings;
`;

function usage(message, code = 64) {
  if (message) console.error(message);
  console.error('Usage: node --experimental-strip-types tools/database/production-rollout.mjs settings-locale [--apply]');
  console.error(`Apply requires ${PROD_OPT_IN}=1.`);
  process.exitCode = code;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim().slice(-6000);
    throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function supabase(args) {
  return run(CLI, args);
}

function cliJson(args) {
  const result = supabase([...args, '--output-format', 'json']);
  return parseCliJson(`${result.stderr}\n${result.stdout}`);
}

function verifyRuntime() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) throw new Error(`Node 24 is required; found ${process.version}.`);
  if (!existsSync(CLI)) {
    throw new Error('The lockfile-pinned Supabase CLI is missing; run npm ci with Node 24.');
  }
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const locked = packageLock.packages?.['node_modules/supabase'];
  if (packageJson.devDependencies?.supabase !== CLI_VERSION
      || locked?.version !== CLI_VERSION || typeof locked?.integrity !== 'string') {
    throw new Error(`Supabase CLI ${CLI_VERSION} must be exact and integrity-pinned in the lockfile.`);
  }
  const versionOutput = supabase(['--version']).stdout;
  const found = versionOutput.match(/\b\d+\.\d+\.\d+\b/u)?.[0];
  if (found !== CLI_VERSION) {
    throw new Error(`Supabase CLI ${CLI_VERSION} is required; found ${found ?? 'no version'}.`);
  }
}

function assertWorkspaceProjectRef(temp) {
  const refFile = path.join(temp, 'supabase', '.temp', 'project-ref');
  if (!existsSync(refFile)) throw new Error('Temporary Supabase project is not linked.');
  return assertConfiguredLinkedProjectRef(
    SUPABASE_PROJECT_REF,
    readFileSync(refFile, 'utf8'),
    SUPABASE_PROJECT_REF,
  );
}

function verifyCommittedMigrations(rollout) {
  for (const migration of rollout.migrations) {
    const absolute = path.join(ROOT, migration.file);
    if (!existsSync(absolute)) throw new Error(`Missing migration: ${migration.file}`);
    const working = readFileSync(absolute);
    if (sha256(working) !== migration.sha256) {
      throw new Error(`Migration hash changed: ${migration.file}`);
    }
    const committed = spawnSync('git', ['show', `HEAD:${migration.file}`], {
      cwd: ROOT,
      encoding: null,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (committed.status !== 0 || !Buffer.isBuffer(committed.stdout)
        || !working.equals(committed.stdout)) {
      throw new Error(`Migration must match committed HEAD exactly: ${migration.file}`);
    }
  }
}

async function auditProduction(rollout) {
  const placeholders = rollout.migrations.map((_, index) => `$${index + 1}::text`).join(', ');
  const historySql = `
    select version, name
      from supabase_migrations.schema_migrations
     where version in (${placeholders})
     order by version;
  `;
  const history = await productionRead(historySql, rollout.migrations.map(({ version }) => version));
  for (const row of history) {
    const expected = rollout.migrations.find(({ version }) => version === row.version);
    if (!expected || row.name !== expected.name) {
      throw new Error(`Unexpected production migration identity at ${String(row.version)}.`);
    }
  }
  const migrationsByFilename = new Map(
    rollout.migrations.map((migration) => [path.basename(migration.file), migration]),
  );
  const selected = computeAppliedPrefixPendingSuffix(
    [...migrationsByFilename.keys()],
    history.map(({ version }) => version),
  );
  const plan = {
    stage: selected.stage,
    applied: selected.applied.map((filename) => migrationsByFilename.get(filename)),
    pending: selected.pending.map((filename) => migrationsByFilename.get(filename)),
  };
  if ([...plan.applied, ...plan.pending].some((migration) => !migration)) {
    throw new Error('Production rollout manifest could not be mapped to its migration files.');
  }
  const rows = await productionRead(SETTINGS_SCHEMA);
  if (rows.length !== 1) throw new Error('Production schema audit returned an unexpected shape.');
  const row = rows[0];
  const evidence = {
    baseTable: row.table_exists === true,
    baseContract: [
      row.rls_enabled,
      row.base_columns,
      row.primary_key,
      row.cascade_profile_fk,
      row.base_checks,
      row.owner_policies,
      row.authenticated_grants,
      row.anon_locked,
      row.service_role_grants,
    ].every((value) => value === true),
    localeColumn: row.locale_column === true && row.locale_shape === true,
    localeConstraint: row.locale_constraint === true,
    localeComment: row.locale_comment === true,
    localeValues: false,
  };
  if (plan.applied.length === rollout.migrations.length) {
    const values = await productionRead(VALID_LOCALE_VALUES);
    evidence.localeValues = values.length === 1 && Number(values[0].invalid_locale_count) === 0;
  }
  const schemaStage = validatePlayerSettingsSchemaStage(evidence);
  if (schemaStage !== plan.stage) {
    throw new Error(`Production schema stage ${schemaStage} does not match migration stage ${plan.stage}.`);
  }
  return { history, plan, evidence };
}

function prepareWorkspace(temp, rollout, plan) {
  supabase(['init', '--workdir', temp, '--yes']);
  const linked = cliJson(['link', '--workdir', temp, '--project-ref', SUPABASE_PROJECT_REF, '--yes']);
  assertConfiguredLinkedProjectRef(
    SUPABASE_PROJECT_REF,
    linked.project_ref,
    SUPABASE_PROJECT_REF,
  );
  assertWorkspaceProjectRef(temp);
  cliJson(productionMigrationFetchArgs(temp, SUPABASE_PROJECT_REF));

  const migrationsDir = path.join(temp, 'supabase', 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  const fetched = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));
  const fetchedVersions = new Map(
    fetched.map((file) => [parseMigrationFilename(file).version, file]),
  );
  for (const migration of plan.applied) {
    const fetchedName = fetchedVersions.get(migration.version);
    if (!fetchedName || fetchedName !== path.basename(migration.file)) {
      throw new Error(`Fetched production history does not match ${migration.version}.`);
    }
  }
  for (const migration of plan.pending) {
    if (fetchedVersions.has(migration.version)) {
      throw new Error(`Pending migration already appeared in fetched history: ${migration.version}.`);
    }
    copyFileSync(path.join(ROOT, migration.file), path.join(migrationsDir, path.basename(migration.file)));
  }
}

function dryRun(temp, expected) {
  assertWorkspaceProjectRef(temp);
  const output = cliJson(productionDbPushArgs(temp, SUPABASE_PROJECT_REF, true));
  assertExactDryRun(output, expected.map(({ file }) => path.basename(file)));
  return output;
}

function apply(temp, expected) {
  assertWorkspaceProjectRef(temp);
  const output = cliJson(productionDbPushArgs(temp, SUPABASE_PROJECT_REF, false));
  assertExactApply(output, expected.map(({ file }) => path.basename(file)));
}

function planSnapshot(plan) {
  return {
    stage: plan.stage,
    applied: plan.applied.map(({ file }) => path.basename(file)),
    pending: plan.pending.map(({ file }) => path.basename(file)),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return usage(null, 0);
  const rolloutName = args.find((argument) => !argument.startsWith('-'));
  const unknown = args.filter((argument) => argument !== rolloutName && argument !== '--apply');
  if (!rolloutName || unknown.length) return usage(unknown.length ? `Unknown option: ${unknown[0]}` : 'Missing rollout name.');
  const rollout = ROLLOUTS[rolloutName];
  if (!rollout) return usage(`Unknown rollout: ${rolloutName}`);
  const wantsApply = args.includes('--apply');
  assertProductionApplyOptIn(wantsApply, process.env[PROD_OPT_IN]);

  verifyRuntime();
  verifyCommittedMigrations(rollout);
  const before = await auditProduction(rollout);
  if (!before.plan.pending.length) {
    process.stdout.write(JSON.stringify({ rollout: rolloutName, status: 'up-to-date', checks: before.evidence }, null, 2) + '\n');
    return;
  }

  await withTemporaryWorkspace(
    () => mkdtempSync(path.join(os.tmpdir(), 'knucklebones-production-migrations-')),
    (temp) => rmSync(temp, { recursive: true, force: true }),
    async (temp) => {
      prepareWorkspace(temp, rollout, before.plan);
      dryRun(temp, before.plan.pending);
      if (!wantsApply) {
        process.stdout.write(JSON.stringify({
          rollout: rolloutName,
          status: 'ready',
          applied: before.plan.applied.map(({ file }) => path.basename(file)),
          pending: before.plan.pending.map(({ file }) => path.basename(file)),
          checks: before.evidence,
        }, null, 2) + '\n');
        return;
      }

      const immediatelyBefore = await auditProduction(rollout);
      assertSameRolloutPlan(planSnapshot(before.plan), planSnapshot(immediatelyBefore.plan));
      dryRun(temp, immediatelyBefore.plan.pending);
      apply(temp, immediatelyBefore.plan.pending);

      const after = await auditProduction(rollout);
      if (after.plan.pending.length) {
        throw new Error('Production still reports pending rollout migrations.');
      }
      process.stdout.write(JSON.stringify({
        rollout: rolloutName,
        status: 'applied',
        migrations: immediatelyBefore.plan.pending.map(({ file }) => path.basename(file)),
        checks: after.evidence,
      }, null, 2) + '\n');
    },
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
