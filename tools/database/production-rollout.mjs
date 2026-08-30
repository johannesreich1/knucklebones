// Guarded, allow-listed production migrations. The repository's production
// prefix now matches production; the fresh fetched workdir remains deliberate so its
// migration directory is exactly the fixed allow-list and --include-all can
// never cross an unrelated pending migration.
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
import { SUPPORTED_LOCALES } from '../../src/i18n/locale.ts';
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
  validateAppleGameCenterSchemaStage,
  validateEquippedRankedSchemaStage,
  validateLadderStreakBaselineSchemaStage,
  validateMatchCommandRetentionSchemaStage,
  validatePlayerSettingsSchemaStage,
  validateRuneTrialSchemaStage,
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
const SQL_LOCALE_VALUES = SUPPORTED_LOCALES.map((locale) => `'${locale}'`).join(', ');
const SQL_LOCALE_TEXT_VALUES = SUPPORTED_LOCALES.map((locale) => `'${locale}'::text`).join(', ');
export const APPLE_GAME_CENTER_MIGRATION_SHA256 = Object.freeze({
  gameCenterIds: '0119452d927c1f20f69dee84dc9428b6506d1d4de228488e32c03a3fc15bf2a7',
  gameCenterServiceGrants: '817312cee43a0acf5169fa7638b78b9e91d8c1a97270dfcfad5e405cb5ff5cd4',
  appleIdentityCredentials: '9c3c887b061f520f875b870fe79bd3d7ad94dd58c0d0c17662c4641efc099760',
  appleRevocationUnstage: 'a3350911d5661e77bfa83045e5b52760d9114fc0dcd9c8522f27720f020f7f09',
});
export const RUNE_TRIAL_MIGRATION_SHA256 = '930c4c52979df8e94bb0e59e033203c3973401f433f1d7ac3594cac20291cc33';
export const EQUIPPED_RANKED_MIGRATION_SHA256 =
  'c41d5051fc1d6bbf522233ecaa469f83b12ee3efbdcfd237ff8841ed963d6f15';
export const RANDOM_RUNE_MODE_MIGRATION_SHA256 =
  'd27232fcf61165b4a0334e185b69818d0dd7c0cc172b9cc35e6d3360781d915f';
export const LADDER_STREAK_BASELINES_MIGRATION_SHA256 =
  '1b132572fde4df5f451e0c1780077c0e07156300fbd91b24833614a8d2e6c827';
export const MATCH_COMMAND_STALL_CHECK_MIGRATION_SHA256 =
  'ea067e3e3f63e94bed0ae4370317017b9530327697860f2fe961b52a42d295cd';

export const RANKED_RUNES_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: '20260830155543',
    name: 'equipped_runes_ranked',
    file: 'supabase/migrations/20260830155543_equipped_runes_ranked.sql',
    sha256: EQUIPPED_RANKED_MIGRATION_SHA256,
  }),
  Object.freeze({
    version: '20260830160000',
    name: 'random_rune_mode',
    file: 'supabase/migrations/20260830160000_random_rune_mode.sql',
    sha256: RANDOM_RUNE_MODE_MIGRATION_SHA256,
  }),
]);

const ROLLOUTS = Object.freeze({
  'settings-locale': Object.freeze({
    audit: 'settings-locale',
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
      Object.freeze({
        version: '20260825161016',
        name: 'expand_player_settings_locales',
        file: 'supabase/migrations/20260825161016_expand_player_settings_locales.sql',
        sha256: '48590f58f81fb75db0218da02dea18600564663d5a82275d51f5ab6c853482f3',
      }),
    ]),
  }),
  'match-command-retention': Object.freeze({
    audit: 'match-command-retention',
    migrations: Object.freeze([
      Object.freeze({
        version: '20260824212535',
        name: 'match_command_retention',
        file: 'supabase/migrations/20260824212535_match_command_retention.sql',
        sha256: '58f3cc83fcde8b29ccbd5a34d462fe18b219e423d52849b86139e05582bf4523',
      }),
    ]),
  }),
  'rune-trial': Object.freeze({
    audit: 'rune-trial',
    migrations: Object.freeze([
      Object.freeze({
        version: '20260825205241',
        name: 'rune_trial_ranked_v2',
        file: 'supabase/migrations/20260825205241_rune_trial_ranked_v2.sql',
        sha256: RUNE_TRIAL_MIGRATION_SHA256,
      }),
    ]),
  }),
  'ranked-runes': Object.freeze({
    audit: 'equipped-ranked',
    migrations: RANKED_RUNES_MIGRATIONS,
  }),
  'ladder-streak-baselines': Object.freeze({
    audit: 'ladder-streak-baselines',
    migrations: Object.freeze([
      Object.freeze({
        version: '20260826153000',
        name: 'ladder_streak_baselines',
        file: 'supabase/migrations/20260826153000_ladder_streak_baselines.sql',
        sha256: LADDER_STREAK_BASELINES_MIGRATION_SHA256,
      }),
    ]),
  }),
  'apple-game-center': Object.freeze({
    audit: 'apple-game-center',
    migrations: Object.freeze([
      Object.freeze({
        version: '20260826153100',
        name: 'game_center_ids',
        file: 'supabase/migrations/20260826153100_game_center_ids.sql',
        sha256: APPLE_GAME_CENTER_MIGRATION_SHA256.gameCenterIds,
      }),
      Object.freeze({
        version: '20260826153101',
        name: 'game_center_service_grants',
        file: 'supabase/migrations/20260826153101_game_center_service_grants.sql',
        sha256: APPLE_GAME_CENTER_MIGRATION_SHA256.gameCenterServiceGrants,
      }),
      Object.freeze({
        version: '20260826153102',
        name: 'apple_identity_credentials',
        file: 'supabase/migrations/20260826153102_apple_identity_credentials.sql',
        sha256: APPLE_GAME_CENTER_MIGRATION_SHA256.appleIdentityCredentials,
      }),
      Object.freeze({
        version: '20260826181000',
        name: 'apple_revocation_unstage',
        file: 'supabase/migrations/20260826181000_apple_revocation_unstage.sql',
        sha256: APPLE_GAME_CENTER_MIGRATION_SHA256.appleRevocationUnstage,
      }),
    ]),
  }),
  'match-command-stall-check': Object.freeze({
    audit: 'match-command-stall-check',
    migrations: Object.freeze([
      Object.freeze({
        version: '20260826181500',
        name: 'match_command_stall_check',
        file: 'supabase/migrations/20260826181500_match_command_stall_check.sql',
        sha256: MATCH_COMMAND_STALL_CHECK_MIGRATION_SHA256,
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
                    and pg_get_constraintdef(oid, true) in (
                      $original$CHECK (locale IS NULL OR (locale = ANY (ARRAY['en'::text, 'de'::text, 'fr'::text])))$original$,
                      $expanded$CHECK (locale IS NULL OR (locale = ANY (ARRAY[${SQL_LOCALE_TEXT_VALUES}])))$expanded$
                    )
              from pg_constraint
             where conrelid = to_regclass('public.player_settings')
               and conname = 'player_settings_locale_check'
               and contype = 'c'), false) as locale_constraint,
  coalesce((select convalidated
                    and pg_get_constraintdef(oid, true) =
                      $expanded$CHECK (locale IS NULL OR (locale = ANY (ARRAY[${SQL_LOCALE_TEXT_VALUES}])))$expanded$
              from pg_constraint
             where conrelid = to_regclass('public.player_settings')
               and conname = 'player_settings_locale_check'
               and contype = 'c'), false) as locale_expanded,
  coalesce((select col_description(to_regclass('public.player_settings'), ordinal_position::integer)
                    = 'Null follows the current device language; otherwise a supported base locale override.'
              from information_schema.columns
             where table_schema = 'public' and table_name = 'player_settings'
               and column_name = 'locale'), false) as locale_comment;
`;

export const VALID_LOCALE_VALUES = String.raw`
select count(*) filter (
         where locale is not null
           and locale <> all(array[${SQL_LOCALE_VALUES}]::text[])
       )::integer as invalid_locale_count
  from public.player_settings;
`;

export const MATCH_COMMAND_RETENTION_SCHEMA = String.raw`
select
  exists (select 1 from pg_extension where extname = 'pg_cron')
    as cron_extension,
  coalesce((
    select pg_get_indexdef(indexrelid) =
      'CREATE INDEX match_commands_retention_idx ON private.match_commands USING btree (created_at, match_id, command_id)'
      from pg_index
     where indexrelid = to_regclass('private.match_commands_retention_idx')
  ), false) as retention_index,
  coalesce((
    select not prosecdef
           and provolatile = 'v'
           and prokind = 'f'
           and prorettype = 'integer'::regtype
           and pronargs = 2
           and pronargdefaults = 1
           and oidvectortypes(proargtypes) = 'timestamp with time zone, integer'
           and 'search_path=""' = any(coalesce(proconfig, array[]::text[]))
      from pg_proc
     where oid = to_regprocedure(
       'private.purge_expired_match_commands(timestamp with time zone,integer)'
     )
  ), false) as cleanup_function,
  coalesce((
    select not exists (
      select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        left join pg_roles role on role.oid = acl.grantee
       where acl.privilege_type = 'EXECUTE'
         and (acl.grantee = 0
              or role.rolname in ('anon', 'authenticated', 'service_role'))
    )
      from pg_proc p
     where p.oid = to_regprocedure(
       'private.purge_expired_match_commands(timestamp with time zone,integer)'
     )
  ), false) as cleanup_function_locked;
`;

export const MATCH_COMMAND_RETENTION_JOB = String.raw`
select
  count(*) = 1 as cron_job,
  count(*) filter (
    where active
      and schedule = '0 * * * *'
      and btrim(regexp_replace(command, '[[:space:]]+', ' ', 'g')) =
        'select private.purge_expired_match_commands( clock_timestamp() - interval ''7 days'', 5000 );'
  ) = 1 as cron_job_contract
  from cron.job
 where jobname = 'purge-expired-match-commands';
`;

/* Classic auto-move stall recovery: the 13-argument commit_match_command is
   replaced by a 14-argument version whose trailing timestamptz precondition
   lets the database clock re-verify the 12-second stall. Stage 0 is the exact
   reviewed legacy function; stage 1 is the exact reviewed replacement; any
   other combination is a partial or foreign state and fails closed.

   Stage 1's body was re-pinned 2026-08-27 by
   20260827160000_auto_forfeit_streak, which supersedes the stall-check
   migration in place: the same 14-argument signature now also maintains
   p{1,2}_auto_streak, and reads a null precondition as an own-turn self
   placement to be checked for turn ownership rather than a stall. A database
   carrying only the stall-check migration therefore no longer matches stage 1
   — correctly, since that is no longer the reviewed state. */
export const MATCH_COMMAND_STALL_CHECK_SCHEMA = String.raw`
with legacy_command as (
  select procedure.*
    from pg_proc procedure
   where procedure.oid = to_regprocedure(
     'public.commit_match_command(uuid,uuid,uuid,smallint,boolean,integer,smallint,smallint,jsonb,smallint,smallint,jsonb,jsonb)'
   )
),
stall_command as (
  select procedure.*, language.lanname
    from pg_proc procedure
    join pg_language language on language.oid = procedure.prolang
   where procedure.oid = to_regprocedure(
     'public.commit_match_command(uuid,uuid,uuid,smallint,boolean,integer,smallint,smallint,jsonb,smallint,smallint,jsonb,jsonb,timestamptz)'
   )
)
select
  coalesce((
    select md5(prosrc) = '7b0d24c0fcb9457c2233c092d4087878' from legacy_command
  ), false) as legacy_command_function,
  coalesce((
    select pg_get_userbyid(proowner) = 'postgres'
           and lanname = 'plpgsql'
           and prosecdef
           and provolatile = 'v'
           and prokind = 'f'
           and prorettype = to_regtype('jsonb')
           and pronargdefaults = 2
           and proconfig = array['search_path=""']::text[]
      from stall_command
  ), false) as stall_command_function,
  coalesce((
    select md5(prosrc) = 'e3fd9a2600e539dfcbf796c6717993fd' from stall_command
  ), false) as stall_command_body,
  coalesce((
    select count(*) = 1
      and bool_and(
        coalesce(role.rolname, 'PUBLIC') = 'service_role'
        and access.privilege_type = 'EXECUTE'
        and not access.is_grantable
      )
      from stall_command procedure
      cross join lateral aclexplode(
        coalesce(procedure.proacl, acldefault('f', procedure.proowner))
      ) access
      left join pg_roles role on role.oid = access.grantee
     where access.grantee <> procedure.proowner
  ), false) as stall_command_grants,
  (
    select count(*) = 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname = 'commit_match_command'
  ) as single_command_function;
`;

export const APPLE_GAME_CENTER_SCHEMA = String.raw`
with expected_apple_functions(
  signature, language_name, volatility, return_type, argument_defaults, body_md5
) as (
  values
    ('public.store_apple_revocation_credential(uuid,text,text)', 'plpgsql', 'v', 'void', 0,
      'bd7cb050d53a93c49bb9ff4cacd29c5b'),
    ('public.apple_revocation_ready(uuid)', 'sql', 's', 'boolean', 0,
      '56644229d37ef57e73966778ecb7ae89'),
    ('public.stage_apple_revocation(uuid)', 'plpgsql', 'v', 'bigint', 0,
      '025d0927532e35e6c3d3846cf4c2145c'),
    ('public.take_apple_revocation(bigint)', 'sql', 'v', 'record', 0,
      '4175d639a78c7ae9832728a4975b7817'),
    ('public.claim_apple_revocations(integer)', 'sql', 'v', 'record', 1,
      '0a1c5b84596ce8ff2694c74b9f0b84d3'),
    ('public.finish_apple_revocation(bigint,text)', 'plpgsql', 'v', 'void', 0,
      '0b54a82ec6ce6fd367f4f870daee0226')
), apple_function_catalog as (
  select expected.*, procedure.oid, procedure.proowner, procedure.prosrc, procedure.proacl,
         procedure.prosecdef, procedure.provolatile, procedure.prokind,
         procedure.prorettype, procedure.pronargdefaults, procedure.proconfig,
         language.lanname, pg_get_userbyid(procedure.proowner) as owner_name
    from expected_apple_functions expected
    left join pg_proc procedure on procedure.oid = to_regprocedure(expected.signature)
    left join pg_language language on language.oid = procedure.prolang
), apple_function_access as (
  select catalog.signature,
         coalesce(role.rolname, 'PUBLIC') as role_name,
         access.privilege_type,
         access.is_grantable
    from apple_function_catalog catalog
    cross join lateral aclexplode(
      coalesce(catalog.proacl, acldefault('f', catalog.proowner))
    ) access
    left join pg_roles role on role.oid = access.grantee
   where catalog.oid is not null and access.grantee <> catalog.proowner
)
select
  (
    to_regclass('public.game_center_ids') is not null
    and coalesce((
      select relation.relrowsecurity and pg_get_userbyid(relation.relowner) = 'postgres'
        from pg_class relation
       where relation.oid = to_regclass('public.game_center_ids')
    ), false)
    and (
      select count(*) = 3
        and count(*) filter (
          where column_name = 'team_player_id' and data_type = 'text'
            and is_nullable = 'NO' and column_default is null
        ) = 1
        and count(*) filter (
          where column_name = 'user_id' and data_type = 'uuid'
            and is_nullable = 'NO' and column_default is null
        ) = 1
        and count(*) filter (
          where column_name = 'created_at' and data_type = 'timestamp with time zone'
            and is_nullable = 'NO' and column_default = 'now()'
        ) = 1
        from information_schema.columns
       where table_schema = 'public' and table_name = 'game_center_ids'
    )
    and (
      select count(*) = 3
        and count(*) filter (
          where conname = 'game_center_ids_pkey' and contype = 'p'
            and convalidated and pg_get_constraintdef(oid, true) = 'PRIMARY KEY (team_player_id)'
        ) = 1
        and count(*) filter (
          where conname = 'game_center_ids_user_id_key' and contype = 'u'
            and convalidated and pg_get_constraintdef(oid, true) = 'UNIQUE (user_id)'
        ) = 1
        and count(*) filter (
          where conname = 'game_center_ids_user_id_fkey' and contype = 'f'
            and convalidated and not condeferrable
            and pg_get_constraintdef(oid, true) =
              'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
        ) = 1
        from pg_constraint
       where conrelid = to_regclass('public.game_center_ids')
    )
    and not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = 'game_center_ids'
    )
  ) as game_center_table,
  (
    coalesce((
      select array_agg(distinct access.privilege_type::text
                       order by access.privilege_type::text)
        from pg_class relation
        cross join lateral aclexplode(
          coalesce(relation.relacl, acldefault('r', relation.relowner))
        ) access
        join pg_roles role on role.oid = access.grantee
       where relation.oid = to_regclass('public.game_center_ids')
         and role.rolname = 'service_role'
         and access.grantee <> relation.relowner
    ), array[]::text[]) = array['INSERT', 'SELECT']::text[]
    and not exists (
      select 1
        from pg_class relation
        cross join lateral aclexplode(
          coalesce(relation.relacl, acldefault('r', relation.relowner))
        ) access
        left join pg_roles role on role.oid = access.grantee
       where relation.oid = to_regclass('public.game_center_ids')
         and access.grantee <> relation.relowner
         and (access.grantee = 0 or role.rolname in ('anon', 'authenticated'))
    )
  ) as game_center_service_grant,
  (
    exists (
      select 1
        from pg_extension extension
        join pg_namespace namespace on namespace.oid = extension.extnamespace
       where extension.extname = 'supabase_vault' and namespace.nspname = 'vault'
    )
    and to_regclass('private.apple_revocation_credentials') is not null
    and coalesce((
      select relation.relrowsecurity and pg_get_userbyid(relation.relowner) = 'postgres'
        from pg_class relation
       where relation.oid = to_regclass('private.apple_revocation_credentials')
    ), false)
    and (
      select count(*) = 11
        and count(*) filter (
          where column_name = 'id' and data_type = 'bigint'
            and is_nullable = 'NO' and is_identity = 'YES'
            and identity_generation = 'ALWAYS'
        ) = 1
        and count(*) filter (
          where column_name = 'user_id' and data_type = 'uuid' and is_nullable = 'YES'
        ) = 1
        and count(*) filter (
          where column_name = 'client_id' and data_type = 'text' and is_nullable = 'NO'
        ) = 1
        and count(*) filter (
          where column_name = 'vault_secret_id' and data_type = 'uuid' and is_nullable = 'NO'
        ) = 1
        and count(*) filter (
          where column_name = 'state' and data_type = 'text' and is_nullable = 'NO'
            and column_default = '''active''::text'
        ) = 1
        and count(*) filter (
          where column_name = 'attempt_count' and data_type = 'integer'
            and is_nullable = 'NO' and column_default = '0'
        ) = 1
        and count(*) filter (
          where column_name in (
            'next_attempt_at', 'expires_at', 'processing_started_at'
          ) and data_type = 'timestamp with time zone' and is_nullable = 'YES'
        ) = 3
        and count(*) filter (
          where column_name in ('created_at', 'updated_at')
            and data_type = 'timestamp with time zone' and is_nullable = 'NO'
            and column_default = 'now()'
        ) = 2
        from information_schema.columns
       where table_schema = 'private' and table_name = 'apple_revocation_credentials'
    )
    and (
      select count(*) = 5
        and count(*) filter (
          where conname = 'apple_revocation_credentials_pkey'
            and contype = 'p' and convalidated
            and pg_get_constraintdef(oid, true) = 'PRIMARY KEY (id)'
        ) = 1
        and count(*) filter (
          where conname = 'apple_revocation_credentials_user_id_fkey'
            and contype = 'f' and convalidated and not condeferrable
            and pg_get_constraintdef(oid, true) =
              'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL'
        ) = 1
        and count(*) filter (
          where conname = 'apple_revocation_credentials_client_id_check'
            and contype = 'c' and convalidated
        ) = 1
        and count(*) filter (
          where conname = 'apple_revocation_credentials_state_check'
            and contype = 'c' and convalidated
        ) = 1
        and count(*) filter (
          where conname = 'apple_revocation_credentials_attempt_count_check'
            and contype = 'c' and convalidated
        ) = 1
        from pg_constraint
       where conrelid = to_regclass('private.apple_revocation_credentials')
    )
    and (
      select count(*) = 3 and bool_and(index.indisvalid and index.indisready)
        and count(*) filter (
          where index.indexrelid =
            to_regclass('private.apple_revocation_credentials_user_client_idx')
            and index.indisunique and index.indpred is not null
        ) = 1
        and count(*) filter (
          where index.indexrelid =
            to_regclass('private.apple_revocation_credentials_user_id_idx')
            and not index.indisunique and index.indpred is not null
        ) = 1
        and count(*) filter (
          where index.indexrelid =
            to_regclass('private.apple_revocation_credentials_due_idx')
            and not index.indisunique and index.indpred is not null
        ) = 1
        from pg_index index
       where index.indexrelid in (
         to_regclass('private.apple_revocation_credentials_user_client_idx'),
         to_regclass('private.apple_revocation_credentials_user_id_idx'),
         to_regclass('private.apple_revocation_credentials_due_idx')
       )
    )
    and not exists (
      select 1 from pg_policies
       where schemaname = 'private' and tablename = 'apple_revocation_credentials'
    )
  ) as apple_credential_table,
  (
    select count(*) = 6
      and bool_and(
        oid is not null
        and owner_name = 'postgres'
        and lanname = language_name
        and not prosecdef
        and provolatile = volatility::"char"
        and prokind = 'f'
        and prorettype = to_regtype(return_type)
        and pronargdefaults = argument_defaults
        and proconfig = array['search_path=""']::text[]
      )
      from apple_function_catalog
  ) as apple_credential_functions,
  (
    select count(*) = 6 and bool_and(md5(prosrc) = body_md5)
      from apple_function_catalog
  ) as apple_credential_function_bodies,
  (
    coalesce((
      select array_agg(distinct access.privilege_type::text
                       order by access.privilege_type::text)
        from pg_class relation
        cross join lateral aclexplode(
          coalesce(relation.relacl, acldefault('r', relation.relowner))
        ) access
        join pg_roles role on role.oid = access.grantee
       where relation.oid = to_regclass('private.apple_revocation_credentials')
         and role.rolname = 'service_role'
         and access.grantee <> relation.relowner
    ), array[]::text[]) = array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]
    and not exists (
      select 1
        from pg_class relation
        cross join lateral aclexplode(
          coalesce(relation.relacl, acldefault('r', relation.relowner))
        ) access
        left join pg_roles role on role.oid = access.grantee
       where relation.oid in (
         to_regclass('private.apple_revocation_credentials'),
         to_regclass('private.apple_revocation_credentials_id_seq')
       )
         and access.grantee <> relation.relowner
         and (access.grantee = 0 or role.rolname in ('anon', 'authenticated'))
    )
    and coalesce((
      select array_agg(distinct access.privilege_type::text
                       order by access.privilege_type::text)
        from pg_class relation
        cross join lateral aclexplode(
          coalesce(relation.relacl, acldefault('S', relation.relowner))
        ) access
        join pg_roles role on role.oid = access.grantee
       where relation.oid = to_regclass('private.apple_revocation_credentials_id_seq')
         and role.rolname = 'service_role'
         and access.grantee <> relation.relowner
    ), array[]::text[]) = array['SELECT', 'USAGE']::text[]
    and (select has_schema_privilege('service_role', namespace.oid, 'USAGE')
           from pg_namespace namespace where namespace.nspname = 'private')
    and (select has_schema_privilege('service_role', namespace.oid, 'USAGE')
           from pg_namespace namespace where namespace.nspname = 'vault')
    and coalesce(has_function_privilege(
      'service_role', to_regprocedure('vault.create_secret(text,text,text,uuid)'), 'EXECUTE'
    ), false)
    and coalesce(has_function_privilege(
      'service_role', to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)'), 'EXECUTE'
    ), false)
    and coalesce(has_table_privilege(
      'service_role', to_regclass('vault.secrets'), 'SELECT'
    ), false)
    and coalesce(has_table_privilege(
      'service_role', to_regclass('vault.secrets'), 'DELETE'
    ), false)
    and coalesce(has_table_privilege(
      'service_role', to_regclass('vault.decrypted_secrets'), 'SELECT'
    ), false)
    and (
      select count(*) = 6
        and bool_and(
          role_name = 'service_role'
          and privilege_type = 'EXECUTE'
          and not is_grantable
        )
        from apple_function_access
    )
  ) as apple_credential_grants,
  to_regprocedure('public.unstage_apple_revocation(uuid)') is not null
    as apple_unstage_function_present,
  (
    coalesce((
      select pg_get_userbyid(procedure.proowner) = 'postgres'
             and language.lanname = 'plpgsql'
             and not procedure.prosecdef
             and procedure.provolatile = 'v'
             and procedure.prokind = 'f'
             and procedure.prorettype = to_regtype('bigint')
             and procedure.pronargdefaults = 0
             and procedure.proconfig = array['search_path=""']::text[]
             and md5(procedure.prosrc) = 'a7277a021de3892315a3204c70295ef4'
        from pg_proc procedure
        join pg_language language on language.oid = procedure.prolang
       where procedure.oid = to_regprocedure('public.unstage_apple_revocation(uuid)')
    ), false)
    and coalesce((
      select count(*) = 1
        and bool_and(
          coalesce(role.rolname, 'PUBLIC') = 'service_role'
          and access.privilege_type = 'EXECUTE'
          and not access.is_grantable
        )
        from pg_proc procedure
        cross join lateral aclexplode(
          coalesce(procedure.proacl, acldefault('f', procedure.proowner))
        ) access
        left join pg_roles role on role.oid = access.grantee
       where procedure.oid = to_regprocedure('public.unstage_apple_revocation(uuid)')
         and access.grantee <> procedure.proowner
    ), false)
  ) as apple_unstage_function;
`;

export const RUNE_TRIAL_SCHEMA = String.raw`
select
  (
    exists (
      select 1
        from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'ranked_pool_tier' and data_type = 'text'
         and is_nullable = 'NO' and column_default = '''stone''::text'
         and is_identity = 'NO' and is_generated = 'NEVER'
    )
    and exists (
      select 1
        from pg_constraint
       where conrelid = to_regclass('public.profiles')
         and conname = 'profiles_ranked_pool_tier_check'
         and contype = 'c' and convalidated
         and pg_get_constraintdef(oid, true) =
           $check$CHECK (ranked_pool_tier = ANY (ARRAY['stone'::text, 'bone'::text, 'ivory'::text]))$check$
    )
  ) as profile_progression,
  (
    (
      select count(*) = 12
        and count(*) filter (where column_name = 'format' and data_type = 'text'
          and is_nullable = 'NO' and column_default = '''standard''::text') = 1
        and count(*) filter (where column_name = 'protocol_version' and data_type = 'smallint'
          and is_nullable = 'NO' and column_default = '1') = 1
        and count(*) filter (where column_name = 'rune_rules_version' and data_type = 'smallint'
          and is_nullable = 'YES' and column_default is null) = 1
        and count(*) filter (where column_name = 'pool_tier' and data_type = 'text'
          and is_nullable = 'NO' and column_default = '''stone''::text') = 1
        and count(*) filter (where column_name = 'phase' and data_type = 'text'
          and is_nullable = 'NO' and column_default = '''playing''::text') = 1
        and count(*) filter (where column_name = 'trial_offer' and data_type = 'ARRAY'
          and udt_name = '_text' and is_nullable = 'YES' and column_default is null) = 1
        and count(*) filter (where column_name in ('p1_rune', 'p2_rune', 'pending_aim')
          and data_type = 'text' and is_nullable = 'YES' and column_default is null) = 3
        and count(*) filter (where column_name = 'selection_deadline'
          and data_type = 'timestamp with time zone' and is_nullable = 'YES'
          and column_default is null) = 1
        and count(*) filter (where column_name in ('selection_version', 'action_version')
          and data_type = 'integer' and is_nullable = 'NO' and column_default = '0') = 2
        from information_schema.columns
       where table_schema = 'public' and table_name = 'matches'
         and column_name in (
           'format', 'protocol_version', 'rune_rules_version', 'pool_tier', 'phase',
           'trial_offer', 'p1_rune', 'p2_rune', 'selection_deadline',
           'selection_version', 'action_version', 'pending_aim'
         )
    )
    and (
      select count(*) = 12 and bool_and(convalidated)
        and count(*) filter (
          where conname = 'matches_modifier_check'
            and pg_get_constraintdef(oid, true) =
              $check$CHECK (modifier = ANY (ARRAY['classic'::text, 'rowswitch'::text, 'rowmult'::text, 'colshield'::text, 'singlestrike'::text, 'bounty'::text, 'limited'::text]))$check$
        ) = 1
        and count(*) filter (
          where conname = 'matches_format_check'
            and pg_get_constraintdef(oid, true) =
              $check$CHECK (format = ANY (ARRAY['standard'::text, 'rune_trial'::text]))$check$
        ) = 1
        and count(*) filter (
          where conname = 'matches_protocol_version_check'
            and pg_get_constraintdef(oid, true) =
              $check$CHECK (protocol_version = ANY (ARRAY[1, 2]))$check$
        ) = 1
        and count(*) filter (
          where conname = 'matches_rune_rules_version_check'
            and pg_get_constraintdef(oid, true) =
              'CHECK (rune_rules_version IS NULL OR rune_rules_version = 1)'
        ) = 1
        and count(*) filter (
          where conname = 'matches_pool_tier_check'
            and pg_get_constraintdef(oid, true) =
              $check$CHECK (pool_tier = ANY (ARRAY['stone'::text, 'bone'::text, 'ivory'::text]))$check$
        ) = 1
        and count(*) filter (
          where conname = 'matches_phase_check'
            and pg_get_constraintdef(oid, true) =
              $check$CHECK (phase = ANY (ARRAY['selection'::text, 'playing'::text]))$check$
        ) = 1
        and count(*) filter (
          where conname = 'matches_selection_version_check'
            and pg_get_constraintdef(oid, true) = 'CHECK (selection_version >= 0)'
        ) = 1
        and count(*) filter (
          where conname = 'matches_action_version_check'
            and pg_get_constraintdef(oid, true) = 'CHECK (action_version >= 0)'
        ) = 1
        and count(*) filter (
          where conname = 'matches_trial_offer_check'
            and pg_get_constraintdef(oid, true) like '%cardinality(trial_offer) = 3%'
            and pg_get_constraintdef(oid, true) like '%array_position(trial_offer, NULL::text) IS NULL%'
            and pg_get_constraintdef(oid, true) like '%''fate''::text%'
            and pg_get_constraintdef(oid, true) like '%''anvil''::text%'
        ) = 1
        and count(*) filter (
          where conname = 'matches_trial_runes_check'
            and pg_get_constraintdef(oid, true) like '%p1_rune%'
            and pg_get_constraintdef(oid, true) like '%p2_rune%'
            and pg_get_constraintdef(oid, true) like '%''fate''::text%'
            and pg_get_constraintdef(oid, true) like '%''anvil''::text%'
        ) = 1
        and count(*) filter (
          where conname = 'matches_pending_aim_check'
            and pg_get_constraintdef(oid, true) like '%pending_aim = ''anvil''::text%'
            and pg_get_constraintdef(oid, true) like '%CASE%WHEN turn = 1 THEN p1_rune%'
        ) = 1
        and count(*) filter (
          where conname = 'matches_format_state_check'
            and pg_get_constraintdef(oid, true) like '%format = ''standard''::text%'
            and pg_get_constraintdef(oid, true) like '%format = ''rune_trial''::text%'
            and pg_get_constraintdef(oid, true) like '%pool_tier = ''ivory''::text%'
            and pg_get_constraintdef(oid, true) like '%protocol_version = 2%'
        ) = 1
        from pg_constraint
       where conrelid = to_regclass('public.matches')
         and contype = 'c'
         and conname in (
           'matches_modifier_check', 'matches_format_check',
           'matches_protocol_version_check', 'matches_rune_rules_version_check',
           'matches_pool_tier_check', 'matches_phase_check',
           'matches_selection_version_check', 'matches_action_version_check',
           'matches_trial_offer_check', 'matches_trial_runes_check',
           'matches_pending_aim_check', 'matches_format_state_check'
         )
    )
  ) as match_protocol,
  (
    (
      select count(*) = 3
        and count(*) filter (where column_name = 'protocol_version'
          and data_type = 'smallint' and is_nullable = 'NO' and column_default = '1') = 1
        and count(*) filter (where column_name = 'capabilities'
          and data_type = 'ARRAY' and udt_name = '_text' and is_nullable = 'NO'
          and column_default = '''{}''::text[]') = 1
        and count(*) filter (where column_name = 'pool_tier'
          and data_type = 'text' and is_nullable = 'NO'
          and column_default = '''stone''::text') = 1
        from information_schema.columns
       where table_schema = 'public' and table_name = 'matchmaking_queue'
         and column_name in ('protocol_version', 'capabilities', 'pool_tier')
    )
    and (
      select count(*) = 3 and bool_and(convalidated)
        and count(*) filter (
          where conname = 'matchmaking_queue_protocol_version_check'
            and pg_get_constraintdef(oid, true) =
              'CHECK (protocol_version = ANY (ARRAY[1, 2]))'
        ) = 1
        and count(*) filter (
          where conname = 'matchmaking_queue_capabilities_check'
            and pg_get_constraintdef(oid, true) like '%rune_trial_v1%'
            and (
              pg_get_constraintdef(oid, true) like '%cardinality(capabilities) <= 1%'
              or md5(pg_get_constraintdef(oid, true)) =
                '81f60e7c70ee6080403a93229cd4205a'
            )
        ) = 1
        and count(*) filter (
          where conname = 'matchmaking_queue_pool_tier_check'
            and pg_get_constraintdef(oid, true) =
              $check$CHECK (pool_tier = ANY (ARRAY['stone'::text, 'bone'::text, 'ivory'::text]))$check$
        ) = 1
        from pg_constraint
       where conrelid = to_regclass('public.matchmaking_queue')
         and conname in (
           'matchmaking_queue_protocol_version_check',
           'matchmaking_queue_capabilities_check',
           'matchmaking_queue_pool_tier_check'
         )
    )
  ) as queue_protocol,
  (
    to_regclass('public.player_runes') is not null
    and coalesce((
      select c.relrowsecurity and pg_get_userbyid(c.relowner) = 'postgres'
        from pg_class c
       where c.oid = to_regclass('public.player_runes')
    ), false)
    and (
      select count(*) = 5
        and count(*) filter (where column_name = 'player_id' and data_type = 'uuid'
          and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name = 'rune_id' and data_type = 'text'
          and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name = 'source_match_id' and data_type = 'uuid'
          and is_nullable = 'YES' and column_default is null) = 1
        and count(*) filter (where column_name = 'collected_at'
          and data_type = 'timestamp with time zone' and is_nullable = 'NO'
          and column_default = 'now()') = 1
        and count(*) filter (where column_name = 'seen_at'
          and data_type = 'timestamp with time zone' and is_nullable = 'YES'
          and column_default is null) = 1
        from information_schema.columns
       where table_schema = 'public' and table_name = 'player_runes'
    )
    and (
      select count(*) = 5 and bool_and(convalidated)
        and count(*) filter (where contype = 'p'
          and pg_get_constraintdef(oid, true) = 'PRIMARY KEY (player_id, rune_id)') = 1
        and count(*) filter (where contype = 'f'
          and pg_get_constraintdef(oid, true) =
            'FOREIGN KEY (player_id) REFERENCES profiles(id) ON DELETE CASCADE') = 1
        and count(*) filter (where contype = 'f'
          and pg_get_constraintdef(oid, true) =
            'FOREIGN KEY (source_match_id) REFERENCES matches(id) ON DELETE SET NULL') = 1
        and count(*) filter (where contype = 'c'
          and pg_get_constraintdef(oid, true) like '%rune_id%'
          and pg_get_constraintdef(oid, true) like '%''fate''::text%'
          and pg_get_constraintdef(oid, true) like '%''anvil''::text%') = 1
        and count(*) filter (where contype = 'c'
          and pg_get_constraintdef(oid, true) =
            'CHECK (seen_at IS NULL OR seen_at >= collected_at)') = 1
        from pg_constraint
       where conrelid = to_regclass('public.player_runes')
    )
  ) as player_runes_table,
  (
    to_regclass('public.match_actions') is not null
    and coalesce((
      select c.relrowsecurity and pg_get_userbyid(c.relowner) = 'postgres'
        from pg_class c
       where c.oid = to_regclass('public.match_actions')
    ), false)
    and (
      select count(*) = 11
        and count(*) filter (where column_name in ('match_id')
          and data_type = 'uuid' and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name = 'idx' and data_type = 'integer'
          and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name = 'move_idx' and data_type = 'integer'
          and is_nullable = 'YES' and column_default is null) = 1
        and count(*) filter (where column_name in ('who', 'target_col', 'placed_col',
          'die_before', 'die_after') and data_type = 'smallint') = 5
        and count(*) filter (where column_name = 'kind' and data_type = 'text'
          and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name = 'rune_id' and data_type = 'text'
          and is_nullable = 'YES' and column_default is null) = 1
        and count(*) filter (where column_name = 'created_at'
          and data_type = 'timestamp with time zone' and is_nullable = 'NO'
          and column_default = 'now()') = 1
        from information_schema.columns
       where table_schema = 'public' and table_name = 'match_actions'
    )
    and (
      select count(*) = 10 and bool_and(convalidated)
        and count(*) filter (where contype = 'p'
          and pg_get_constraintdef(oid, true) = 'PRIMARY KEY (match_id, idx)') = 1
        and count(*) filter (where contype = 'u'
          and pg_get_constraintdef(oid, true) = 'UNIQUE (match_id, move_idx)') = 1
        and count(*) filter (where contype = 'f'
          and pg_get_constraintdef(oid, true) =
            'FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE') = 1
        and count(*) filter (where contype = 'c'
          and pg_get_constraintdef(oid, true) like '%kind = ''aim''::text%'
          and pg_get_constraintdef(oid, true) like '%kind = ''cast''::text%'
          and pg_get_constraintdef(oid, true) like '%kind = ''place''::text%') = 1
        from pg_constraint
       where conrelid = to_regclass('public.match_actions')
    )
  ) as match_actions_table,
  (
    to_regclass('private.rune_trial_choices') is not null
    and to_regclass('private.rune_trial_selection_commands') is not null
    and to_regclass('private.match_action_commands') is not null
    and (
      select count(*) = 3 and bool_and(pg_get_userbyid(c.relowner) = 'postgres')
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'private'
         and c.relname in (
           'rune_trial_choices',
           'rune_trial_selection_commands',
           'match_action_commands'
         )
         and c.relkind in ('r', 'p')
    )
    and (
      select count(*) = 7
        and count(*) filter (where column_name = 'match_id' and data_type = 'uuid'
          and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name in ('p1_choice', 'p2_choice')
          and data_type = 'text' and is_nullable = 'YES' and column_default is null) = 2
        and count(*) filter (where column_name in ('p1_auto_rune', 'p2_auto_rune')
          and data_type = 'text' and is_nullable = 'NO' and column_default is null) = 2
        and count(*) filter (where column_name in ('created_at', 'updated_at')
          and data_type = 'timestamp with time zone' and is_nullable = 'NO'
          and column_default = 'now()') = 2
        from information_schema.columns
       where table_schema = 'private' and table_name = 'rune_trial_choices'
    )
    and (
      select count(*) = 7
        and count(*) filter (where column_name in ('match_id', 'command_id', 'actor')
          and data_type = 'uuid' and is_nullable = 'NO' and column_default is null) = 3
        and count(*) filter (where column_name = 'rune_id' and data_type = 'text'
          and is_nullable = 'YES' and column_default is null) = 1
        and count(*) filter (where column_name = 'auto' and data_type = 'boolean'
          and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name = 'response' and data_type = 'jsonb'
          and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name = 'created_at'
          and data_type = 'timestamp with time zone' and is_nullable = 'NO'
          and column_default = 'now()') = 1
        from information_schema.columns
       where table_schema = 'private' and table_name = 'rune_trial_selection_commands'
    )
    and (
      select count(*) = 8
        and count(*) filter (where column_name in ('match_id', 'command_id', 'actor')
          and data_type = 'uuid' and is_nullable = 'NO' and column_default is null) = 3
        and count(*) filter (where column_name = 'auto' and data_type = 'boolean'
          and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name = 'expected_action_version'
          and data_type = 'integer' and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name = 'requested_action' and data_type = 'jsonb'
          and is_nullable = 'YES' and column_default is null) = 1
        and count(*) filter (where column_name = 'response' and data_type = 'jsonb'
          and is_nullable = 'NO' and column_default is null) = 1
        and count(*) filter (where column_name = 'created_at'
          and data_type = 'timestamp with time zone' and is_nullable = 'NO'
          and column_default = 'now()') = 1
        from information_schema.columns
       where table_schema = 'private' and table_name = 'match_action_commands'
    )
    and (select count(*) = 6 and bool_and(convalidated)
           from pg_constraint
          where conrelid = to_regclass('private.rune_trial_choices'))
    and (select count(*) = 4 and bool_and(convalidated)
           from pg_constraint
          where conrelid = to_regclass('private.rune_trial_selection_commands'))
    and (select count(*) = 6 and bool_and(convalidated)
           from pg_constraint
          where conrelid = to_regclass('private.match_action_commands'))
  ) as private_tables,
  (
    coalesce((
      select indisvalid and indisready and not indisunique
        and pg_get_indexdef(indexrelid) like
          'CREATE INDEX player_runes_source_match_idx ON public.player_runes USING btree (source_match_id)%'
        and pg_get_expr(indpred, indrelid, true) = 'source_match_id IS NOT NULL'
        from pg_index
       where indexrelid = to_regclass('public.player_runes_source_match_idx')
    ), false)
    and coalesce((
      select count(*) = 4 and bool_and(indisvalid and indisready and not indisunique)
        from pg_index
       where indexrelid in (
         to_regclass('private.rune_trial_selection_commands_retention_idx'),
         to_regclass('private.rune_trial_selection_commands_actor_idx'),
         to_regclass('private.match_action_commands_retention_idx'),
         to_regclass('private.match_action_commands_actor_idx')
       )
        and pg_get_indexdef(indexrelid) in (
          'CREATE INDEX rune_trial_selection_commands_retention_idx ON private.rune_trial_selection_commands USING btree (created_at, match_id, command_id)',
          'CREATE INDEX rune_trial_selection_commands_actor_idx ON private.rune_trial_selection_commands USING btree (actor)',
          'CREATE INDEX match_action_commands_retention_idx ON private.match_action_commands USING btree (created_at, match_id, command_id)',
          'CREATE INDEX match_action_commands_actor_idx ON private.match_action_commands USING btree (actor)'
        )
    ), false)
  ) as indexes,
  (
    (select count(*) = 1
       and count(*) filter (
         where policyname = 'player_runes_select_own'
           and permissive = 'PERMISSIVE'
           and roles = array['authenticated']::name[]
           and cmd = 'SELECT'
           and qual = $predicate$(player_id = ( SELECT auth.uid() AS uid))$predicate$
           and with_check is null
       ) = 1
       from pg_policies
      where schemaname = 'public' and tablename = 'player_runes')
    and
    (select count(*) = 1
       and count(*) filter (
         where policyname = 'match_actions_select_participant'
           and permissive = 'PERMISSIVE'
           and roles = array['authenticated']::name[]
           and cmd = 'SELECT' and with_check is null
           and qual like '%match.id = match_actions.match_id%'
           and qual like '%match.p1 = ( SELECT auth.uid() AS uid)%'
           and qual like '%match.p2 = ( SELECT auth.uid() AS uid)%'
       ) = 1
       from pg_policies
      where schemaname = 'public' and tablename = 'match_actions')
  ) as policies,
  (
    select count(*) = 3
      and count(*) filter (
        where role_name = 'authenticated' and privilege_type = 'SELECT'
          and not is_grantable
      ) = 2
      and count(*) filter (
        where role_name = 'service_role' and table_name = 'match_actions'
          and privilege_type = 'SELECT'
          and not is_grantable
      ) = 1
      and count(*) filter (
        where role_name = 'service_role' and table_name = 'player_runes'
      ) = 0
      from (
        select c.relname as table_name, coalesce(r.rolname, 'PUBLIC') as role_name,
               acl.privilege_type, acl.is_grantable
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          cross join lateral aclexplode(
            coalesce(c.relacl, acldefault('r', c.relowner))
          ) acl
          left join pg_roles r on r.oid = acl.grantee
         where n.nspname = 'public' and c.relname in ('player_runes', 'match_actions')
           and acl.grantee <> c.relowner
      ) grants
  ) as table_grants,
  (
    (select count(*) = 3
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private'
        and c.relname in (
          'rune_trial_choices', 'rune_trial_selection_commands',
          'match_action_commands'
        ))
    and not exists (
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(
          coalesce(c.relacl, acldefault('r', c.relowner))
        ) acl
       where n.nspname = 'private'
         and c.relname in (
           'rune_trial_choices', 'rune_trial_selection_commands',
           'match_action_commands'
         )
         and acl.grantee <> c.relowner
    )
  ) as private_tables_locked,
  exists (
    select 1
      from pg_publication_rel relation
      join pg_publication publication on publication.oid = relation.prpubid
     where publication.pubname = 'supabase_realtime'
       and relation.prrelid = to_regclass('public.match_actions')
  ) as realtime_publication,
  exists (select 1 from pg_extension where extname = 'pg_cron') as cron_extension;
`;

export const RUNE_TRIAL_FUNCTIONS = String.raw`
with expected(
  signature, schema_name, function_name, language_name, security_definer,
  volatility, return_type, argument_defaults, body_md5s
) as (
  values
    ('private.ranked_pool_tier_for_peak(integer)', 'private',
      'ranked_pool_tier_for_peak', 'sql', false, 'i', 'text', 0,
      array['ff03a2512b40e447699b2ba4f8ca9625']),
    ('public.acknowledge_rune_reward(text)', 'public',
      'acknowledge_rune_reward', 'plpgsql', true, 'v', 'boolean', 0,
      array['a66f2b1863080172a137f77f15f48e8c']),
    ('public.enqueue_ranked_player_v2(uuid,smallint,text[])', 'public',
      'enqueue_ranked_player_v2', 'plpgsql', true, 'v', 'jsonb', 0,
      array['47d0f0d3803e4411a4ab72f88710da2c',
            '8d6c669dd740a64a1df872b3a6359944']),
    ('public.start_ranked_match_v2(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamptz,text,text)',
      'public', 'start_ranked_match_v2', 'plpgsql', true, 'v', 'jsonb', 0,
      array['a774ada104b131c0eefdc840d5a026d3']),
    ('private.finalize_rune_trial_locked(uuid,boolean)', 'private',
      'finalize_rune_trial_locked', 'plpgsql', true, 'v', 'public.matches', 1,
      array['9a692011627169211f21317324015650']),
    ('private.rune_trial_payload(uuid,uuid)', 'private',
      'rune_trial_payload', 'plpgsql', true, 's', 'jsonb', 0,
      array['589c07689e57ac2ca17d847a2f91a709']),
    ('public.rune_trial_state(uuid,uuid)', 'public',
      'rune_trial_state', 'plpgsql', true, 'v', 'jsonb', 0,
      array['f8d6ae222bb50b868d4d688f244da62e']),
    ('public.commit_rune_trial_choice(uuid,uuid,uuid,text,boolean)', 'public',
      'commit_rune_trial_choice', 'plpgsql', true, 'v', 'jsonb', 0,
      array['a622803213bf639775f8363a6c91c029']),
    ('public.settle_match(uuid,text,uuid,integer,integer,integer,integer,jsonb,jsonb,jsonb,jsonb)',
      'public', 'settle_match', 'plpgsql', true, 'v', 'jsonb', 0,
      array['2b34ae6429ae876839c20909e43cbf5a',
            '969ec904c8bce2bf1cfab78a90d8669b']),
    ('public.match_action_result(uuid,uuid,uuid,boolean,integer,jsonb)', 'public',
      'match_action_result', 'plpgsql', true, 's', 'jsonb', 0,
      array['d12d6153ad37b7f50b89b1d550e8ab39']),
    -- Re-pinned 2026-08-27 by 20260827160000_auto_forfeit_streak: the action
    -- commit now maintains p{1,2}_auto_streak and admits an own-turn auto with
    -- a null stall precondition.
    ('public.commit_match_action(uuid,uuid,uuid,boolean,integer,smallint,smallint,timestamptz,jsonb,jsonb,smallint,smallint,jsonb,jsonb)',
      'public', 'commit_match_action', 'plpgsql', true, 'v', 'jsonb', 1,
      array['223f4df6134ba6fbce4487143933f4e8',
            'cb197365655531053efedc039ed84380']),
    ('private.purge_expired_rune_trial_commands(timestamptz,integer)', 'private',
      'purge_expired_rune_trial_commands', 'plpgsql', false, 'v', 'integer', 1,
      array['89732767ac693a980498119d66e77c95'])
),
catalog as (
  select expected.*, p.oid, p.proowner, p.prosrc, p.proacl,
         p.prosecdef, p.provolatile, p.prokind, p.pronargdefaults,
         p.prorettype, p.proconfig, p.proname, namespace.nspname,
         language.lanname, owner_role.rolname as owner_name
    from expected
    left join pg_proc p on p.oid = to_regprocedure(expected.signature)
    left join pg_namespace namespace on namespace.oid = p.pronamespace
    left join pg_language language on language.oid = p.prolang
    left join pg_roles owner_role on owner_role.oid = p.proowner
),
access as (
  select catalog.signature, coalesce(role.rolname, 'PUBLIC') as role_name,
         acl.privilege_type, acl.is_grantable
    from catalog
    cross join lateral aclexplode(
      coalesce(catalog.proacl, acldefault('f', catalog.proowner))
    ) acl
    left join pg_roles role on role.oid = acl.grantee
   where catalog.oid is not null and acl.grantee <> catalog.proowner
)
select
  (
    select count(*) = 12
      and bool_and(
        oid is not null
        and owner_name = 'postgres'
        and nspname = schema_name
        and proname = function_name
        and lanname = language_name
        and prosecdef = security_definer
        and provolatile = volatility::"char"
        and prokind = 'f'
        and prorettype = to_regtype(return_type)
        and pronargdefaults = argument_defaults
        and proconfig = array['search_path=""']::text[]
      )
      from catalog
  ) and (
    select count(*) = 12
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where (namespace.nspname, procedure.proname) in (
       ('private', 'ranked_pool_tier_for_peak'),
       ('public', 'acknowledge_rune_reward'),
       ('public', 'enqueue_ranked_player_v2'),
       ('public', 'start_ranked_match_v2'),
       ('private', 'finalize_rune_trial_locked'),
       ('private', 'rune_trial_payload'),
       ('public', 'rune_trial_state'),
       ('public', 'commit_rune_trial_choice'),
       ('public', 'settle_match'),
       ('public', 'match_action_result'),
       ('public', 'commit_match_action'),
       ('private', 'purge_expired_rune_trial_commands')
     )
  ) as function_contracts,
  (select count(*) = 12 and bool_and(md5(prosrc) = any(body_md5s)) from catalog)
    as function_bodies,
  (
    select count(*) = 8
      and count(*) filter (
        where signature = 'public.acknowledge_rune_reward(text)'
          and role_name = 'authenticated'
          and privilege_type = 'EXECUTE' and not is_grantable
      ) = 1
      and count(*) filter (
        where signature in (
          'public.enqueue_ranked_player_v2(uuid,smallint,text[])',
          'public.start_ranked_match_v2(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamptz,text,text)',
          'public.rune_trial_state(uuid,uuid)',
          'public.commit_rune_trial_choice(uuid,uuid,uuid,text,boolean)',
          'public.settle_match(uuid,text,uuid,integer,integer,integer,integer,jsonb,jsonb,jsonb,jsonb)',
          'public.match_action_result(uuid,uuid,uuid,boolean,integer,jsonb)',
          'public.commit_match_action(uuid,uuid,uuid,boolean,integer,smallint,smallint,timestamptz,jsonb,jsonb,smallint,smallint,jsonb,jsonb)'
        )
          and role_name = 'service_role'
          and privilege_type = 'EXECUTE' and not is_grantable
      ) = 7
      from access
  ) as function_grants;
`;

export const RUNE_TRIAL_JOB = String.raw`
select
  count(*) = 1 as cron_job,
  count(*) filter (
    where active
      and schedule = '7 * * * *'
      and database = current_database()
      and username = 'postgres'
      and nodename = 'localhost'
      and nodeport = current_setting('port')::integer
      and btrim(regexp_replace(command, '[[:space:]]+', ' ', 'g')) =
        'select private.purge_expired_rune_trial_commands( clock_timestamp() - interval ''7 days'', 5000 );'
  ) = 1 as cron_job_contract
  from cron.job
 where jobname = 'purge-expired-rune-trial-commands';
`;

export const RUNE_TRIAL_POST_APPLY_DATA = String.raw`
with historical as (
  select player, max(peak)::integer as peak
    from public.season_ratings
   group by player
)
select
  not exists (
    select 1
      from public.profiles profile
      join historical on historical.player = profile.id
     where case profile.ranked_pool_tier
       when 'stone' then 0 when 'bone' then 1 when 'ivory' then 2 else -1
     end < case
       when historical.peak >= 720 then 2
       when historical.peak >= 300 then 1
       else 0
     end
  ) as profile_backfill,
  not exists (
    select 1
      from public.matches match
     where match.format is distinct from 'standard'
        or match.protocol_version is distinct from 1
        or match.rune_rules_version is not null
        or match.pool_tier is distinct from 'stone'
        or match.phase is distinct from 'playing'
        or match.trial_offer is not null
        or match.p1_rune is not null
        or match.p2_rune is not null
        or match.selection_deadline is not null
        or match.selection_version is distinct from 0
        or match.action_version is distinct from 0
        or match.pending_aim is not null
  ) as legacy_matches,
  not exists (
    select 1
      from public.matchmaking_queue queue
     where queue.protocol_version is distinct from 1
        or queue.capabilities is distinct from '{}'::text[]
        or queue.pool_tier is distinct from 'stone'
  ) as legacy_queue,
  (
    (select count(*) from public.player_runes) = 0
    and (select count(*) from public.match_actions) = 0
    and (select count(*) from private.rune_trial_choices) = 0
    and (select count(*) from private.rune_trial_selection_commands) = 0
    and (select count(*) from private.match_action_commands) = 0
  ) as new_tables_empty;
`;

export const EQUIPPED_RANKED_SCHEMA = String.raw`
with expected(
  signature, schema_name, function_name, language_name, security_definer,
  volatility, return_type, argument_defaults, body_md5, alternate_body_md5
) as (
  values
    ('public.enqueue_ranked_player_v2(uuid,smallint,text[])', 'public',
      'enqueue_ranked_player_v2', 'plpgsql', true, 'v', 'jsonb', 0,
      '8d6c669dd740a64a1df872b3a6359944', null),
    ('public.start_ranked_match_v3(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamptz,text,text,boolean)',
      'public', 'start_ranked_match_v3', 'plpgsql', true, 'v', 'jsonb', 0,
      'b7b1b9e7899045936f4d6a246f1c9eee',
      'e6986a11de9d9efbf89467626ae9fb8f'),
    ('private.bot_owned_rune_choice(uuid)', 'private',
      'bot_owned_rune_choice', 'sql', false, 's', 'text', 0,
      'b6cbfd6a8630c49653664bf554aa346a', null),
    ('public.settle_match(uuid,text,uuid,integer,integer,integer,integer,jsonb,jsonb,jsonb,jsonb)',
      'public', 'settle_match', 'plpgsql', true, 'v', 'jsonb', 0,
      '969ec904c8bce2bf1cfab78a90d8669b', null),
    ('public.commit_match_action(uuid,uuid,uuid,boolean,integer,smallint,smallint,timestamptz,jsonb,jsonb,smallint,smallint,jsonb,jsonb)',
      'public', 'commit_match_action', 'plpgsql', true, 'v', 'jsonb', 1,
      'cb197365655531053efedc039ed84380', null)
), catalog as (
  select expected.*, procedure.oid, procedure.proowner, procedure.prosrc,
         procedure.proacl, procedure.prosecdef, procedure.provolatile,
         procedure.prokind, procedure.pronargdefaults, procedure.prorettype,
         procedure.proconfig, procedure.proname, namespace.nspname,
         language.lanname, owner_role.rolname as owner_name
    from expected
    left join pg_proc procedure
      on procedure.oid = to_regprocedure(expected.signature)
    left join pg_namespace namespace on namespace.oid = procedure.pronamespace
    left join pg_language language on language.oid = procedure.prolang
    left join pg_roles owner_role on owner_role.oid = procedure.proowner
), access as (
  select catalog.signature, coalesce(role.rolname, 'PUBLIC') as role_name,
         privilege.privilege_type, privilege.is_grantable
    from catalog
    cross join lateral aclexplode(
      coalesce(catalog.proacl, acldefault('f', catalog.proowner))
    ) privilege
    left join pg_roles role on role.oid = privilege.grantee
   where catalog.oid is not null and privilege.grantee <> catalog.proowner
), random_expected(
  signature, schema_name, function_name, language_name, security_definer,
  volatility, return_type, strict, body_md5, comment_text
) as (
  values
    ('private.normalize_rune_equipment_update()', 'private',
      'normalize_rune_equipment_update', 'plpgsql', false, 'v', 'trigger', false,
      '56fd0f92d36cc00fccc496a437c251ae',
      'Compatibility trigger: authenticated direct equipped_rune writes and ownership SET NULL clear RANDOM; owner-executed equipment RPC preserves non-null one-statement v2 writes.'),
    ('private.random_owned_rune_for_match(uuid,text)', 'private',
      'random_owned_rune_for_match', 'sql', false, 's', 'text', true,
      '5cf88a87f3cb5df762537a59238d5d56',
      'Deterministic per-match choice from the participant current owned inventory; returns NULL for an empty inventory.'),
    ('public.set_rune_equipment(text,boolean)', 'public',
      'set_rune_equipment', 'plpgsql', true, 'v', 'jsonb', false,
      '3dcdc059bb6068e2aaa8e36181f9549d',
      'Authenticated-only atomic fixed, RANDOM, or empty equipment write for auth.uid(); RANDOM keeps an owned fallback and direct legacy equipped_rune writes remain fixed.'),
    ('public.start_ranked_match_v3(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamptz,text,text,boolean)',
      'public', 'start_ranked_match_v3', 'plpgsql', true, 'v', 'jsonb', false,
      'e6986a11de9d9efbf89467626ae9fb8f', null)
), random_catalog as (
  select expected.*, procedure.oid, procedure.proowner, procedure.prosrc,
         procedure.proacl, procedure.prosecdef, procedure.provolatile,
         procedure.prokind, procedure.pronargdefaults, procedure.prorettype,
         procedure.proconfig, procedure.proname, procedure.proisstrict,
         procedure.proretset, procedure.proleakproof, procedure.proparallel,
         namespace.nspname, language.lanname,
         owner_role.rolname as owner_name
    from random_expected expected
    left join pg_proc procedure
      on procedure.oid = to_regprocedure(expected.signature)
    left join pg_namespace namespace on namespace.oid = procedure.pronamespace
    left join pg_language language on language.oid = procedure.prolang
    left join pg_roles owner_role on owner_role.oid = procedure.proowner
), random_access as (
  select random_catalog.signature,
         coalesce(role.rolname, 'PUBLIC') as role_name,
         privilege.privilege_type, privilege.is_grantable
    from random_catalog
    cross join lateral aclexplode(
      coalesce(random_catalog.proacl, acldefault('f', random_catalog.proowner))
    ) privilege
    left join pg_roles role on role.oid = privilege.grantee
   where random_catalog.oid is not null
     and privilege.grantee <> random_catalog.proowner
)
select
  (
    select count(*) = 1 and bool_and(
      contype = 'c' and convalidated
      and md5(pg_get_constraintdef(oid, true)) =
        '81f60e7c70ee6080403a93229cd4205a'
    )
      from pg_constraint
     where conrelid = to_regclass('public.matchmaking_queue')
       and conname = 'matchmaking_queue_capabilities_check'
  ) as queue_capability_constraint,
  (
    select count(*) = 2 and bool_and(contype = 'c' and convalidated)
      and count(*) filter (
        where conname = 'matches_pending_aim_check'
          and md5(pg_get_constraintdef(oid, true)) =
            '3c1715e608652fbe8de401aeb31530dc'
      ) = 1
      and count(*) filter (
        where conname = 'matches_format_state_check'
          and md5(pg_get_constraintdef(oid, true)) =
            '09bc02d0fc04f5b7a311fe29246774dd'
      ) = 1
      from pg_constraint
     where conrelid = to_regclass('public.matches')
       and conname in ('matches_pending_aim_check', 'matches_format_state_check')
  ) as match_constraints,
  (
    select count(*) = 5 and bool_and(
      oid is not null
      and owner_name = 'postgres'
      and nspname = schema_name
      and proname = function_name
      and lanname = language_name
      and prosecdef = security_definer
      and provolatile = volatility::"char"
      and prokind = 'f'
      and prorettype = to_regtype(return_type)
      and pronargdefaults = argument_defaults
      and proconfig = array['search_path=""']::text[]
    )
      from catalog
  ) and (
    select count(*) = 5
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where (namespace.nspname, procedure.proname) in (
       ('public', 'enqueue_ranked_player_v2'),
       ('public', 'start_ranked_match_v3'),
       ('private', 'bot_owned_rune_choice'),
       ('public', 'settle_match'),
       ('public', 'commit_match_action')
     )
  ) as function_contracts,
  (
    select count(*) = 5 and bool_and(
      md5(prosrc) = body_md5
      or coalesce(md5(prosrc) = alternate_body_md5, false)
    )
      from catalog
  ) as function_bodies,
  (
    select count(*) = 4
      and count(*) filter (
        where signature in (
          'public.enqueue_ranked_player_v2(uuid,smallint,text[])',
          'public.start_ranked_match_v3(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamptz,text,text,boolean)',
          'public.settle_match(uuid,text,uuid,integer,integer,integer,integer,jsonb,jsonb,jsonb,jsonb)',
          'public.commit_match_action(uuid,uuid,uuid,boolean,integer,smallint,smallint,timestamptz,jsonb,jsonb,smallint,smallint,jsonb,jsonb)'
        )
          and role_name = 'service_role'
          and privilege_type = 'EXECUTE'
          and not is_grantable
      ) = 4
      and count(*) filter (
        where signature = 'private.bot_owned_rune_choice(uuid)'
      ) = 0
      from access
  ) as service_grants,
  coalesce((
    select not prosecdef
      and provolatile = 's'
      and lanname = 'sql'
      and proconfig = array['search_path=""']::text[]
      and obj_description(oid, 'pg_proc') =
        'Stable pseudorandom selection from one player inventory; used only to persist a bot equipped seat.'
      and not exists (
        select 1 from access
         where signature = 'private.bot_owned_rune_choice(uuid)'
      )
      from catalog
     where signature = 'private.bot_owned_rune_choice(uuid)'
       and oid is not null
  ), false) as helper_lockdown,
  (
    select count(*) = 1 and bool_and(
      data_type = 'boolean' and is_nullable = 'NO'
      and column_default = 'false'
      and is_identity = 'NO' and is_generated = 'NEVER'
    )
      from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'random_rune_mode'
  ) as random_mode_column,
  (
    select count(*) = 1 and bool_and(
      contype = 'c' and convalidated and not connoinherit
      and pg_get_constraintdef(oid, true) =
        'CHECK (NOT random_rune_mode OR equipped_rune IS NOT NULL)'
    )
      from pg_constraint
     where conrelid = to_regclass('public.profiles')
       and conname = 'profiles_random_rune_mode_has_fallback'
  ) as random_mode_constraint,
  coalesce((
    select col_description(to_regclass('public.profiles'), attribute.attnum) =
      'When true, ordinary ranked from SILVER snapshots a seed-derived random rune from the player collection. equipped_rune remains a concrete owned fallback for older clients. Rune Trial ignores both profile fields.'
      from pg_attribute attribute
     where attribute.attrelid = to_regclass('public.profiles')
       and attribute.attname = 'random_rune_mode'
       and attribute.attnum > 0 and not attribute.attisdropped
  ), false) as random_mode_comment,
  coalesce((
    select attribute.attacl is null
      from pg_attribute attribute
     where attribute.attrelid = to_regclass('public.profiles')
       and attribute.attname = 'random_rune_mode'
       and attribute.attnum > 0 and not attribute.attisdropped
  ), false) as random_mode_grant,
  (
    exists (
      select 1 from pg_constraint
       where conrelid = to_regclass('public.profiles')
         and conname = 'profiles_random_rune_mode_has_fallback'
         and contype = 'c' and convalidated
    )
    and (
      select count(*) = 2
        and count(*) filter (
          where conname = 'profiles_equipped_rune_known'
            and contype = 'c' and convalidated and not connoinherit
            and md5(pg_get_constraintdef(oid, true)) =
              'cadbea3be7238de9f895be698ccf9742'
        ) = 1
        and count(*) filter (
          where conname = 'profiles_equipped_rune_owned'
            and contype = 'f' and convalidated
            and confrelid = to_regclass('public.player_runes')
            and confupdtype = 'c' and confdeltype = 'n' and confmatchtype = 's'
            and md5(pg_get_constraintdef(oid, true)) =
              '5245e8c97f7710d59f9925987b2685c4'
        ) = 1
        from pg_constraint
       where conrelid = to_regclass('public.profiles')
         and conname in (
           'profiles_equipped_rune_known',
           'profiles_equipped_rune_owned'
         )
    )
  ) as equipment_integrity_constraints,
  (
    exists (
      select 1 from pg_attribute attribute
       where attribute.attrelid = to_regclass('public.profiles')
         and attribute.attname = 'random_rune_mode'
         and attribute.attnum > 0 and not attribute.attisdropped
    )
    and coalesce((
      select relation.relrowsecurity and not relation.relforcerowsecurity
        from pg_class relation
       where relation.oid = to_regclass('public.profiles')
    ), false)
    and (
      select count(*) = 1 and bool_and(
        policy.polname = 'profiles_update_own'
        and policy.polcmd = 'w' and policy.polpermissive
        and policy.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
        and md5(pg_get_expr(policy.polqual, policy.polrelid, true)) =
          '7035f36bb692789e5d2feb46291a7a86'
        and md5(pg_get_expr(policy.polwithcheck, policy.polrelid, true)) =
          '7035f36bb692789e5d2feb46291a7a86'
      )
        from pg_policy policy
       where policy.polrelid = to_regclass('public.profiles')
         and policy.polcmd in ('w', '*')
    )
    and (
      select count(*) = 1 and bool_and(
        policy.polname = 'profiles_select_own'
        and policy.polcmd = 'r' and policy.polpermissive
        and policy.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
        and md5(pg_get_expr(policy.polqual, policy.polrelid, true)) =
          '7035f36bb692789e5d2feb46291a7a86'
        and policy.polwithcheck is null
      )
        from pg_policy policy
       where policy.polrelid = to_regclass('public.profiles')
         and policy.polcmd in ('r', '*')
    )
    and not has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
    and not has_table_privilege('anon', 'public.profiles', 'UPDATE')
    and has_table_privilege('authenticated', 'public.profiles', 'SELECT')
    and not has_table_privilege('anon', 'public.profiles', 'SELECT')
    and (
      select coalesce(
               array_agg(
                 coalesce(role.rolname, 'PUBLIC') || ':' || privilege.privilege_type
                 || ':' || privilege.is_grantable::text
                 order by coalesce(role.rolname, 'PUBLIC'), privilege.privilege_type,
                          privilege.is_grantable
               ) filter (
                 where privilege.privilege_type = 'SELECT'
                   and (
                     privilege.grantee = 0
                     or role.rolname in ('anon', 'authenticated')
                   )
               ),
               array[]::text[]
             ) = array['authenticated:SELECT:false']::text[]
        from pg_class relation
        cross join lateral aclexplode(
          coalesce(relation.relacl, acldefault('r', relation.relowner))
        ) privilege
        left join pg_roles role on role.oid = privilege.grantee
       where relation.oid = to_regclass('public.profiles')
    )
    and not exists (
      select 1
        from pg_class relation
        cross join lateral aclexplode(
          coalesce(relation.relacl, acldefault('r', relation.relowner))
        ) privilege
        left join pg_roles role on role.oid = privilege.grantee
       where relation.oid = to_regclass('public.profiles')
         and privilege.privilege_type = 'UPDATE'
         and (
           privilege.grantee = 0
           or role.rolname in ('anon', 'authenticated')
         )
    )
    and coalesce((
      select coalesce(
               array_agg(
                 coalesce(role.rolname, 'PUBLIC') || ':' || privilege.privilege_type
                 || ':' || privilege.is_grantable::text
                 order by coalesce(role.rolname, 'PUBLIC'), privilege.privilege_type,
                          privilege.is_grantable
               ) filter (where privilege.privilege_type is not null),
               array[]::text[]
             ) = array['authenticated:UPDATE:false']::text[]
        from pg_attribute attribute
        left join lateral aclexplode(attribute.attacl) privilege on true
        left join pg_roles role on role.oid = privilege.grantee
       where attribute.attrelid = to_regclass('public.profiles')
         and attribute.attname = 'equipped_rune'
         and attribute.attnum > 0 and not attribute.attisdropped
    ), false)
    and coalesce((
      select attribute.attacl is null
        from pg_attribute attribute
       where attribute.attrelid = to_regclass('public.profiles')
         and attribute.attname = 'random_rune_mode'
         and attribute.attnum > 0 and not attribute.attisdropped
    ), false)
  ) as profile_security,
  (
    select count(*) = 1 and bool_and(
      not trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
      and trigger_row.tgtype = 19
      and trigger_row.tgfoid =
        to_regprocedure('private.normalize_rune_equipment_update()')
      and trigger_row.tgqual is null
      and encode(trigger_row.tgargs, 'hex') = ''
      and (
        select array_agg(attribute.attname order by numbered.ordinality)
          from unnest(trigger_row.tgattr::smallint[])
               with ordinality numbered(attnum, ordinality)
          join pg_attribute attribute
            on attribute.attrelid = trigger_row.tgrelid
           and attribute.attnum = numbered.attnum
      ) = array['equipped_rune', 'random_rune_mode']::name[]
    )
      from pg_trigger trigger_row
     where trigger_row.tgrelid = to_regclass('public.profiles')
       and trigger_row.tgname = 'profiles_normalize_rune_equipment_update'
  ) and (
    select count(*) = 1
      from pg_trigger trigger_row
     where not trigger_row.tgisinternal
       and trigger_row.tgfoid =
         to_regprocedure('private.normalize_rune_equipment_update()')
  ) as compatibility_trigger,
  coalesce((
    select oid is not null and owner_name = 'postgres'
      and nspname = schema_name and proname = function_name
      and lanname = language_name and prosecdef = security_definer
      and provolatile = volatility::"char" and prokind = 'f'
      and prorettype = to_regtype(return_type) and proisstrict = strict
      and not proretset and not proleakproof and proparallel = 'u'
      and pronargdefaults = 0 and proconfig = array['search_path=""']::text[]
      from random_catalog
     where signature = 'private.normalize_rune_equipment_update()'
  ), false) and (
    select count(*) = 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private'
       and procedure.proname = 'normalize_rune_equipment_update'
  ) as compatibility_function_contract,
  coalesce((
    select md5(prosrc) = body_md5
      from random_catalog
     where signature = 'private.normalize_rune_equipment_update()'
  ), false) as compatibility_function_body,
  coalesce((
    select oid is not null and obj_description(oid, 'pg_proc') = comment_text
      from random_catalog
     where signature = 'private.normalize_rune_equipment_update()'
  ), false) and not exists (
    select 1 from random_access
     where signature = 'private.normalize_rune_equipment_update()'
  ) as compatibility_function_lockdown,
  coalesce((
    select oid is not null and owner_name = 'postgres'
      and nspname = schema_name and proname = function_name
      and lanname = language_name and prosecdef = security_definer
      and provolatile = volatility::"char" and prokind = 'f'
      and prorettype = to_regtype(return_type) and proisstrict = strict
      and not proretset and not proleakproof and proparallel = 'u'
      and pronargdefaults = 0 and proconfig = array['search_path=""']::text[]
      from random_catalog
     where signature = 'private.random_owned_rune_for_match(uuid,text)'
  ), false) and (
    select count(*) = 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private'
       and procedure.proname = 'random_owned_rune_for_match'
  ) as random_helper_contract,
  coalesce((
    select md5(prosrc) = body_md5
      from random_catalog
     where signature = 'private.random_owned_rune_for_match(uuid,text)'
  ), false) as random_helper_body,
  coalesce((
    select oid is not null and obj_description(oid, 'pg_proc') = comment_text
      from random_catalog
     where signature = 'private.random_owned_rune_for_match(uuid,text)'
  ), false) and not exists (
    select 1 from random_access
     where signature = 'private.random_owned_rune_for_match(uuid,text)'
  ) as random_helper_lockdown,
  coalesce((
    select oid is not null and owner_name = 'postgres'
      and nspname = schema_name and proname = function_name
      and lanname = language_name and prosecdef = security_definer
      and provolatile = volatility::"char" and prokind = 'f'
      and prorettype = to_regtype(return_type) and proisstrict = strict
      and not proretset and not proleakproof and proparallel = 'u'
      and pronargdefaults = 0 and proconfig = array['search_path=""']::text[]
      and md5(prosrc) = body_md5
      from random_catalog
     where signature = 'public.start_ranked_match_v3(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamptz,text,text,boolean)'
  ), false) and (
    select count(*) = 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname = 'start_ranked_match_v3'
  ) as random_start_contract,
  coalesce((
    select md5(prosrc) = body_md5
      from random_catalog
     where signature = 'public.start_ranked_match_v3(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamptz,text,text,boolean)'
  ), false) as random_start_body,
  coalesce((
    select md5(prosrc) = body_md5
      from random_catalog
     where signature = 'public.start_ranked_match_v3(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamptz,text,text,boolean)'
  ), false) and (
    select coalesce(
             array_agg(
               role_name || ':' || privilege_type || ':' || is_grantable::text
               order by role_name, privilege_type, is_grantable
             ),
             array[]::text[]
           ) = array['service_role:EXECUTE:false']::text[]
      from random_access
     where signature = 'public.start_ranked_match_v3(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamptz,text,text,boolean)'
  ) as random_start_grant,
  coalesce((
    select oid is not null and owner_name = 'postgres'
      and nspname = schema_name and proname = function_name
      and lanname = language_name and prosecdef = security_definer
      and provolatile = volatility::"char" and prokind = 'f'
      and prorettype = to_regtype(return_type) and proisstrict = strict
      and not proretset and not proleakproof and proparallel = 'u'
      and pronargdefaults = 0 and proconfig = array['search_path=""']::text[]
      and obj_description(oid, 'pg_proc') = comment_text
      from random_catalog
     where signature = 'public.set_rune_equipment(text,boolean)'
  ), false) and (
    select count(*) = 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname = 'set_rune_equipment'
  ) as equipment_rpc_contract,
  coalesce((
    select md5(prosrc) = body_md5
      from random_catalog
     where signature = 'public.set_rune_equipment(text,boolean)'
  ), false) as equipment_rpc_body,
  coalesce((
    select oid is not null
      from random_catalog
     where signature = 'public.set_rune_equipment(text,boolean)'
  ), false) and (
    select coalesce(
             array_agg(
               role_name || ':' || privilege_type || ':' || is_grantable::text
               order by role_name, privilege_type, is_grantable
             ),
             array[]::text[]
           ) = array['authenticated:EXECUTE:false']::text[]
      from random_access
     where signature = 'public.set_rune_equipment(text,boolean)'
  ) as equipment_rpc_grant;
`;

export const EQUIPPED_RANKED_BOT_DATA = String.raw`
select
  (select count(*) from public.profiles where is_bot)::integer as bot_count,
  (select count(*) from public.profiles profile
    where profile.is_bot
      and exists (select 1 from public.player_runes owned
                   where owned.player_id = profile.id))::integer
    as bots_with_runes,
  (select count(*) from public.profiles
    where is_bot and equipped_rune is not null)::integer as bots_equipped,
  (select count(*) from public.profiles profile
    where profile.is_bot and profile.equipped_rune is null
      and exists (select 1 from public.player_runes owned
                   where owned.player_id = profile.id))::integer
    as bots_with_runes_without_seat,
  (select count(*) from public.profiles profile
    where profile.is_bot and profile.equipped_rune is not null
      and not exists (select 1 from public.player_runes owned
                       where owned.player_id = profile.id))::integer
    as bots_without_runes_with_seat,
  (select count(*) from public.profiles profile
    where profile.is_bot and profile.equipped_rune is not null
      and not exists (select 1 from public.player_runes owned
                       where owned.player_id = profile.id
                         and owned.rune_id = profile.equipped_rune))::integer
    as bot_seat_not_owned,
  (select count(*) from public.profiles profile
    where profile.is_bot
      and coalesce(
        (to_jsonb(profile)->>'random_rune_mode')::boolean,
        false
      ))::integer as bots_random_mode;
`;

export const EQUIPPED_RANKED_BOT_CONVERGENCE = String.raw`
select
  (select count(*) from public.profiles profile
    where profile.is_bot
      and exists (select 1 from public.player_runes owned
                   where owned.player_id = profile.id)
      and profile.equipped_rune is distinct from
            (select owned.rune_id
               from public.player_runes owned
              where owned.player_id = profile.id
              order by md5(profile.id::text || ':bot-equipped-v1:' || owned.rune_id),
                       owned.rune_id
              limit 1))::integer
    as bot_seat_not_canonical;
`;

export const EQUIPPED_RANKED_HUMAN_DATA = String.raw`
select
  count(*)::integer as human_count,
  md5(coalesce(
    string_agg(
      profile.id::text || ':' || coalesce(profile.equipped_rune, '<null>')
        || ':' || coalesce(to_jsonb(profile)->>'random_rune_mode', 'false'),
      '|' order by profile.id
    ),
    ''
  )) as equipped_rune_fingerprint
  from public.profiles profile
 where not profile.is_bot;
`;

export const LADDER_STREAK_BASELINES_SCHEMA = String.raw`
with baseline_table as (
  select c.oid, c.relowner, c.relacl, c.relkind, c.relpersistence,
         c.relispartition, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private'
     and c.relname = 'season_streak_baselines'
),
player_card as (
  select p.*, language.lanname, owner_role.rolname as owner_name
    from pg_proc p
    join pg_language language on language.oid = p.prolang
    join pg_roles owner_role on owner_role.oid = p.proowner
   where p.oid = to_regprocedure('public.player_card(text)')
),
player_card_access as (
  select coalesce(role.rolname, 'PUBLIC') as role_name,
         acl.privilege_type, acl.is_grantable
    from player_card p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    left join pg_roles role on role.oid = acl.grantee
   where acl.grantee <> p.proowner
),
best_streak as (
  select p.*, language.lanname, owner_role.rolname as owner_name
    from pg_proc p
    join pg_language language on language.oid = p.prolang
    join pg_roles owner_role on owner_role.oid = p.proowner
   where p.oid = to_regprocedure('public.best_streak()')
),
best_streak_access as (
  select coalesce(role.rolname, 'PUBLIC') as role_name,
         acl.privilege_type, acl.is_grantable
    from best_streak p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    left join pg_roles role on role.oid = acl.grantee
   where acl.grantee <> p.proowner
)
select
  exists (select 1 from baseline_table) as table_exists,
  exists (select 1 from baseline_table)
    and (
      select count(*) = 3
        and count(*) filter (
          where ordinal_position = 1 and column_name = 'season_id'
            and data_type = 'smallint' and udt_schema = 'pg_catalog'
            and udt_name = 'int2' and is_nullable = 'NO'
            and column_default is null and is_identity = 'NO'
            and is_generated = 'NEVER'
        ) = 1
        and count(*) filter (
          where ordinal_position = 2 and column_name = 'player'
            and data_type = 'uuid' and udt_schema = 'pg_catalog'
            and udt_name = 'uuid' and is_nullable = 'NO'
            and column_default is null and is_identity = 'NO'
            and is_generated = 'NEVER'
        ) = 1
        and count(*) filter (
          where ordinal_position = 3 and column_name = 'best_streak'
            and data_type = 'integer' and udt_schema = 'pg_catalog'
            and udt_name = 'int4' and is_nullable = 'NO'
            and column_default is null and is_identity = 'NO'
            and is_generated = 'NEVER'
        ) = 1
        from information_schema.columns
       where table_schema = 'private'
         and table_name = 'season_streak_baselines'
    ) as table_columns,
  exists (select 1 from baseline_table)
    and (
      select count(*) = 1
        from pg_constraint
       where conrelid = to_regclass('private.season_streak_baselines')
         and conname = 'season_streak_baselines_pkey'
         and contype = 'p' and convalidated
         and not condeferrable and not condeferred
         and conkey = array[1, 2]::smallint[]
    ) as table_primary_key,
  exists (select 1 from baseline_table)
    and (
      select count(*) = 1
        from pg_constraint
       where conrelid = to_regclass('private.season_streak_baselines')
         and conname = 'season_streak_baselines_rating_fkey'
         and contype = 'f' and convalidated
         and not condeferrable and not condeferred
         and confrelid = to_regclass('public.season_ratings')
         and conkey = array[1, 2]::smallint[]
         and confkey = array[1, 2]::smallint[]
         and confupdtype = 'a' and confdeltype = 'c' and confmatchtype = 's'
    ) as table_rating_foreign_key,
  exists (select 1 from baseline_table)
    and (
      select count(*) = 3
        and count(*) filter (
          where conname = 'season_streak_baselines_best_streak_check'
            and contype = 'c' and convalidated and not connoinherit
            and pg_get_constraintdef(oid, true) = 'CHECK (best_streak >= 0)'
        ) = 1
        from pg_constraint
       where conrelid = to_regclass('private.season_streak_baselines')
    ) as table_check,
  exists (select 1 from baseline_table)
    and obj_description(
      to_regclass('private.season_streak_baselines'), 'pg_class'
    ) = 'Imported per-season lower bound for the displayed best streak; absence means zero and no match history is implied.'
    as table_comment,
  coalesce((
    select relkind = 'r' and relpersistence = 'p' and not relispartition
           and not relrowsecurity and not relforcerowsecurity
           and pg_get_userbyid(relowner) = 'postgres'
      from baseline_table
  ), false) as table_owner,
  exists (select 1 from baseline_table)
    and not exists (
      select 1
        from baseline_table c
        cross join lateral aclexplode(
          coalesce(c.relacl, acldefault('r', c.relowner))
        ) acl
       where acl.grantee <> c.relowner
    )
    and not exists (
      select 1
        from baseline_table c
        join pg_attribute attribute on attribute.attrelid = c.oid
        cross join lateral aclexplode(attribute.attacl) acl
       where attribute.attnum > 0 and not attribute.attisdropped
         and attribute.attacl is not null
         and acl.grantee <> c.relowner
    ) as table_grants,
  exists (select 1 from baseline_table)
    and coalesce((
      select owner_name = 'postgres' and lanname = 'sql'
             and prosecdef and provolatile = 's' and prokind = 'f'
             and proretset and not proisstrict and not proleakproof
             and proparallel = 'u' and pronargdefaults = 0
             and proconfig = array['search_path=""']::text[]
             and pg_get_function_identity_arguments(oid) = 'nick text'
             and pg_get_function_result(oid) =
               'TABLE(streak integer, since timestamp with time zone, points integer, wins bigint, losses bigint, games bigint, rank bigint, apex boolean, peak integer)'
        from player_card
    ), false)
    and (
      select count(*) = 1
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public' and procedure.proname = 'player_card'
    ) as player_card_contract,
  exists (select 1 from baseline_table)
    and coalesce((select md5(prosrc) = '08b41fc75ee2fd8fd4cd0c463c438fbd'
                    from player_card), false)
    as player_card_body,
  exists (select 1 from baseline_table)
    and (
      select coalesce(
               array_agg(
                 role_name || ':' || privilege_type || ':' || is_grantable::text
                 order by role_name, privilege_type, is_grantable
               ),
               array[]::text[]
             ) = array[
               'anon:EXECUTE:false',
               'authenticated:EXECUTE:false'
             ]::text[]
        from player_card_access
    ) as player_card_grants,
  exists (select 1 from baseline_table)
    and coalesce((
      select owner_name = 'postgres' and lanname = 'sql'
             and prosecdef and provolatile = 's' and prokind = 'f'
             and not proretset and not proisstrict and not proleakproof
             and proparallel = 'u' and pronargdefaults = 0
             and proconfig = array['search_path=""']::text[]
             and pg_get_function_identity_arguments(oid) = ''
             and pg_get_function_result(oid) = 'integer'
             and md5(prosrc) = 'bf58986f9cd949e67012b9cd89d87d08'
        from best_streak
    ), false)
    and (
      select count(*) = 1
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public' and procedure.proname = 'best_streak'
    )
    and (
      select coalesce(
               array_agg(
                 role_name || ':' || privilege_type || ':' || is_grantable::text
                 order by role_name, privilege_type, is_grantable
               ),
               array[]::text[]
             ) = array['authenticated:EXECUTE:false']::text[]
        from best_streak_access
    ) as best_streak_delegate;
`;

export const LADDER_STREAK_BASELINES_DATA = String.raw`
select
  count(*)::bigint as baseline_count,
  not exists (
    select 1
      from private.season_streak_baselines baseline
      left join public.season_ratings rating
        on rating.season_id = baseline.season_id
       and rating.player = baseline.player
     where rating.player is null
        or baseline.best_streak < 0
        or baseline.best_streak > rating.wins
  ) as baselines_valid
  from private.season_streak_baselines;
`;

function usage(message, code = 64) {
  if (message) console.error(message);
  console.error('Usage: mise exec -- node --experimental-strip-types tools/database/production-rollout.mjs <settings-locale|match-command-retention|match-command-stall-check|rune-trial|ranked-runes|ladder-streak-baselines|apple-game-center> [--apply]');
  console.error(`Apply requires ${PROD_OPT_IN}=1.`);
  process.exitCode = code;
}

async function auditPlayerSettings(plan, rollout) {
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
    localeExpanded: row.locale_expanded === true,
    localeComment: row.locale_comment === true,
    localeValues: false,
  };
  if (plan.applied.length >= 2) {
    const values = await productionRead(VALID_LOCALE_VALUES);
    evidence.localeValues = values.length === 1 && Number(values[0].invalid_locale_count) === 0;
  }
  return {
    evidence,
    schemaStage: validatePlayerSettingsSchemaStage(evidence),
  };
}

async function auditMatchCommandRetention() {
  const rows = await productionRead(MATCH_COMMAND_RETENTION_SCHEMA);
  if (rows.length !== 1) {
    throw new Error('Production command-retention schema audit returned an unexpected shape.');
  }
  const row = rows[0];
  let cronJob = false;
  let cronJobContract = false;
  if (row.cron_extension === true) {
    const jobs = await productionRead(MATCH_COMMAND_RETENTION_JOB);
    if (jobs.length !== 1) {
      throw new Error('Production command-retention cron audit returned an unexpected shape.');
    }
    cronJob = jobs[0].cron_job === true;
    cronJobContract = jobs[0].cron_job_contract === true;
  }
  const evidence = {
    cronExtension: row.cron_extension === true,
    retentionIndex: row.retention_index === true,
    cleanupFunction: row.cleanup_function === true,
    cleanupFunctionLocked: row.cleanup_function_locked === true,
    cronJob,
    cronJobContract,
  };
  return {
    evidence,
    schemaStage: validateMatchCommandRetentionSchemaStage(evidence),
  };
}

/**
 * Audit the stall-check replacement of commit_match_command as one of two
 * exact states: 0 = the reviewed legacy 13-argument function, 1 = the
 * reviewed 14-argument replacement. Both require commit_match_command to be
 * a single function; every other combination fails closed.
 */
export async function auditMatchCommandStallCheck(readProduction = productionRead) {
  const rows = await readProduction(MATCH_COMMAND_STALL_CHECK_SCHEMA);
  if (rows.length !== 1) {
    throw new Error('Production match-command stall-check audit returned an unexpected shape.');
  }
  const row = rows[0];
  const evidence = {
    legacyCommandFunction: row.legacy_command_function === true,
    stallCommandFunction: row.stall_command_function === true,
    stallCommandBody: row.stall_command_body === true,
    stallCommandGrants: row.stall_command_grants === true,
    singleCommandFunction: row.single_command_function === true,
  };
  const stall = [
    evidence.stallCommandFunction,
    evidence.stallCommandBody,
    evidence.stallCommandGrants,
  ];
  let schemaStage;
  if (evidence.legacyCommandFunction && evidence.singleCommandFunction
      && stall.every(value => value === false)) {
    schemaStage = 0;
  } else if (!evidence.legacyCommandFunction && evidence.singleCommandFunction
      && stall.every(value => value === true)) {
    schemaStage = 1;
  } else {
    throw new Error('Production commit_match_command does not match either reviewed stall-check state.');
  }
  return { evidence, schemaStage };
}

export async function auditAppleGameCenter(readProduction = productionRead) {
  const rows = await readProduction(APPLE_GAME_CENTER_SCHEMA);
  if (rows.length !== 1) {
    throw new Error('Production Apple/Game Center schema audit returned an unexpected shape.');
  }
  const row = rows[0];
  const coreEvidence = {
    gameCenterTable: row.game_center_table === true,
    gameCenterServiceGrant: row.game_center_service_grant === true,
    appleCredentialTable: row.apple_credential_table === true,
    appleCredentialFunctions: row.apple_credential_functions === true,
    appleCredentialFunctionBodies: row.apple_credential_function_bodies === true,
    appleCredentialGrants: row.apple_credential_grants === true,
  };
  /* Stages 0-3 stay owned by the shared prefix validator over the original
     six booleans; the fourth migration's unstage RPC extends the ordered
     prefix to stage 4 here — with it, the audit expects all seven Apple
     credential functions. A present-but-divergent or out-of-order unstage
     function is never folded into a lower stage; it fails closed. */
  const coreStage = validateAppleGameCenterSchemaStage(coreEvidence);
  const unstageComplete = row.apple_unstage_function === true;
  if (row.apple_unstage_function_present === true && !unstageComplete) {
    throw new Error('Production unstage_apple_revocation does not match the reviewed contract.');
  }
  if (unstageComplete && coreStage !== 3) {
    throw new Error('Production unstage_apple_revocation was applied before its credential prefix.');
  }
  return {
    evidence: { ...coreEvidence, appleUnstageFunction: unstageComplete },
    schemaStage: unstageComplete ? 4 : coreStage,
  };
}

export async function auditRuneTrial(readProduction = productionRead) {
  const schemaRows = await readProduction(RUNE_TRIAL_SCHEMA);
  if (schemaRows.length !== 1) {
    throw new Error('Production Rune Trial schema audit returned an unexpected shape.');
  }
  const schema = schemaRows[0];
  if (schema.cron_extension !== true) {
    throw new Error('Rune Trial rollout requires the already-reviewed pg_cron extension.');
  }

  const functionRows = await readProduction(RUNE_TRIAL_FUNCTIONS);
  if (functionRows.length !== 1) {
    throw new Error('Production Rune Trial function audit returned an unexpected shape.');
  }
  const functions = functionRows[0];
  const jobRows = await readProduction(RUNE_TRIAL_JOB);
  if (jobRows.length !== 1) {
    throw new Error('Production Rune Trial cron audit returned an unexpected shape.');
  }
  const job = jobRows[0];
  const evidence = {
    profileProgression: schema.profile_progression === true,
    matchProtocol: schema.match_protocol === true,
    queueProtocol: schema.queue_protocol === true,
    playerRunesTable: schema.player_runes_table === true,
    matchActionsTable: schema.match_actions_table === true,
    privateTables: schema.private_tables === true,
    indexes: schema.indexes === true,
    policies: schema.policies === true,
    tableGrants: schema.table_grants === true,
    privateTablesLocked: schema.private_tables_locked === true,
    functionContracts: functions.function_contracts === true,
    functionBodies: functions.function_bodies === true,
    functionGrants: functions.function_grants === true,
    realtimePublication: schema.realtime_publication === true,
    cronJob: job.cron_job === true,
    cronJobContract: job.cron_job_contract === true,
  };
  return {
    evidence,
    schemaStage: validateRuneTrialSchemaStage(evidence),
  };
}

export async function auditRuneTrialPostApplyData(readProduction = productionRead) {
  const rows = await readProduction(RUNE_TRIAL_POST_APPLY_DATA);
  if (rows.length !== 1) {
    throw new Error('Production Rune Trial post-apply data audit returned an unexpected shape.');
  }
  const row = rows[0];
  const evidence = {
    profileBackfill: row.profile_backfill === true,
    legacyMatches: row.legacy_matches === true,
    legacyQueue: row.legacy_queue === true,
    newTablesEmpty: row.new_tables_empty === true,
  };
  if (Object.values(evidence).some(value => value !== true)) {
    throw new Error('Production Rune Trial post-apply data is not at the exact pre-function baseline.');
  }
  return evidence;
}

function rankedBotCount(row, field) {
  const value = row[field];
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Production equipped-ranked bot audit returned invalid ${field}.`);
  }
  return number;
}

export async function auditEquippedRankedBotData(
  readProduction = productionRead,
  { allowMissingSeats = false } = {},
) {
  const rows = await readProduction(EQUIPPED_RANKED_BOT_DATA);
  if (rows.length !== 1) {
    throw new Error('Production equipped-ranked bot audit returned an unexpected shape.');
  }
  const row = rows[0];
  const evidence = Object.freeze({
    botCount: rankedBotCount(row, 'bot_count'),
    botsWithRunes: rankedBotCount(row, 'bots_with_runes'),
    botsEquipped: rankedBotCount(row, 'bots_equipped'),
    botsWithRunesWithoutSeat: rankedBotCount(row, 'bots_with_runes_without_seat'),
    botsWithoutRunesWithSeat: rankedBotCount(row, 'bots_without_runes_with_seat'),
    botSeatNotOwned: rankedBotCount(row, 'bot_seat_not_owned'),
    botsRandomMode: rankedBotCount(row, 'bots_random_mode'),
  });
  if (evidence.botsRandomMode !== 0) {
    throw new Error('Production random mode is not allowed for bots; they require canonical fixed seats.');
  }
  const seatCoverageIsValid = allowMissingSeats
    ? evidence.botsEquipped + evidence.botsWithRunesWithoutSeat
        === evidence.botsWithRunes
    : evidence.botsWithRunes === evidence.botsEquipped
      && evidence.botsWithRunesWithoutSeat === 0;
  if (evidence.botsWithRunes > evidence.botCount
      || evidence.botsEquipped > evidence.botCount
      || !seatCoverageIsValid
      || evidence.botsWithoutRunesWithSeat !== 0
      || evidence.botSeatNotOwned !== 0) {
    throw new Error('Production equipped-ranked bot seats are missing, unowned, or attached without inventory.');
  }
  return evidence;
}

export async function auditEquippedRankedHumanData(readProduction = productionRead) {
  const rows = await readProduction(EQUIPPED_RANKED_HUMAN_DATA);
  if (rows.length !== 1) {
    throw new Error('Production equipped-ranked human audit returned an unexpected shape.');
  }
  const row = rows[0];
  const humanCount = rankedBotCount(row, 'human_count');
  if (typeof row.equipped_rune_fingerprint !== 'string'
      || !/^[0-9a-f]{32}$/u.test(row.equipped_rune_fingerprint)) {
    throw new Error('Production equipped-ranked human audit returned an invalid fingerprint.');
  }
  return Object.freeze({
    humanCount,
    equippedRuneFingerprint: row.equipped_rune_fingerprint,
  });
}

export function assertSameEquippedRankedHumanData(before, after) {
  if (!before || !after
      || !Number.isSafeInteger(before.humanCount)
      || !Number.isSafeInteger(after.humanCount)
      || typeof before.equippedRuneFingerprint !== 'string'
      || typeof after.equippedRuneFingerprint !== 'string'
      || before.humanCount !== after.humanCount
      || before.equippedRuneFingerprint !== after.equippedRuneFingerprint) {
    throw new Error('Production human equipped-rune rows changed during the bot-only ranked rollout.');
  }
  return after;
}

export async function auditEquippedRanked(readProduction = productionRead) {
  const foundation = await auditRuneTrial(readProduction);
  if (foundation.schemaStage !== 1) {
    throw new Error('Equipped-ranked rollout requires the complete Rune Trial foundation.');
  }

  const rows = await readProduction(EQUIPPED_RANKED_SCHEMA);
  if (rows.length !== 1) {
    throw new Error('Production equipped-ranked schema audit returned an unexpected shape.');
  }
  const row = rows[0];
  const evidence = {
    queueCapabilityConstraint: row.queue_capability_constraint === true,
    matchConstraints: row.match_constraints === true,
    functionContracts: row.function_contracts === true,
    functionBodies: row.function_bodies === true,
    serviceGrants: row.service_grants === true,
    helperLockdown: row.helper_lockdown === true,
    randomModeColumn: row.random_mode_column === true,
    randomModeConstraint: row.random_mode_constraint === true,
    randomModeComment: row.random_mode_comment === true,
    randomModeGrant: row.random_mode_grant === true,
    equipmentIntegrityConstraints: row.equipment_integrity_constraints === true,
    profileSecurity: row.profile_security === true,
    compatibilityTrigger: row.compatibility_trigger === true,
    compatibilityFunctionContract: row.compatibility_function_contract === true,
    compatibilityFunctionBody: row.compatibility_function_body === true,
    compatibilityFunctionLockdown: row.compatibility_function_lockdown === true,
    randomHelperContract: row.random_helper_contract === true,
    randomHelperBody: row.random_helper_body === true,
    randomHelperLockdown: row.random_helper_lockdown === true,
    randomStartContract: row.random_start_contract === true,
    randomStartBody: row.random_start_body === true,
    randomStartGrant: row.random_start_grant === true,
    equipmentRpcContract: row.equipment_rpc_contract === true,
    equipmentRpcBody: row.equipment_rpc_body === true,
    equipmentRpcGrant: row.equipment_rpc_grant === true,
  };
  const schemaStage = validateEquippedRankedSchemaStage(evidence);
  /* This query deliberately does not call the migration-owned helper, so the
     pre-migration stage audits existing bot ownership without pretending the
     new canonical choice function already exists. */
  const data = await auditEquippedRankedBotData(readProduction, {
    /* Empty owned seats are the exact data this migration backfills. Once any
       schema byte is present, partial state is already rejected above; a
       complete schema must therefore satisfy the durable post-migration seat
       invariant before Edge Functions may deploy. */
    allowMissingSeats: schemaStage === 0,
  });
  return { evidence, schemaStage, data };
}

export async function auditEquippedRankedPostApplyData(
  readProduction = productionRead,
  { requireCanonicalBotSeats = true } = {},
) {
  const durable = await auditEquippedRankedBotData(readProduction);
  /* The fixed-seat migration backfills an empty bot seat with its reviewed
     stable choice, so that specific apply may prove convergence. RANDOM adds
     no bot write and deliberately preserves any existing owned fixed seat. A
     bot can have won another rune since the first migration, making a fresh
     stable-choice calculation different without making its seat invalid. */
  if (!requireCanonicalBotSeats) return durable;
  const rows = await readProduction(EQUIPPED_RANKED_BOT_CONVERGENCE);
  if (rows.length !== 1) {
    throw new Error('Production equipped-ranked bot convergence audit returned an unexpected shape.');
  }
  const botSeatNotCanonical = rankedBotCount(rows[0], 'bot_seat_not_canonical');
  if (botSeatNotCanonical !== 0) {
    throw new Error('Production equipped-ranked bot seats did not converge to the reviewed stable choice.');
  }
  return Object.freeze({ ...durable, botSeatNotCanonical });
}

/** Only the stage-one migration writes the reviewed initial bot-seat choice.
 * A later suffix must preserve any still-owned seat after inventory growth. */
export function requiresCanonicalEquippedBotSeats(pendingMigrations) {
  return pendingMigrations.some(
    migration => migration.version === RANKED_RUNES_MIGRATIONS[0].version,
  );
}

export async function auditLadderStreakBaselineData(readProduction = productionRead) {
  const rows = await readProduction(LADDER_STREAK_BASELINES_DATA);
  if (rows.length !== 1) {
    throw new Error('Production ladder-streak baseline data audit returned an unexpected shape.');
  }
  const row = rows[0];
  const countText = typeof row.baseline_count === 'string'
    ? row.baseline_count
    : String(row.baseline_count);
  if (!/^(0|[1-9][0-9]*)$/u.test(countText)) {
    throw new Error('Production ladder-streak baseline count is invalid.');
  }
  const baselineCount = Number(countText);
  if (!Number.isSafeInteger(baselineCount) || row.baselines_valid !== true) {
    throw new Error('Production ladder-streak baseline rows are invalid.');
  }
  return Object.freeze({
    baselinesValid: true,
    baselineCount,
  });
}

export async function auditLadderStreakBaselines(readProduction = productionRead) {
  const rows = await readProduction(LADDER_STREAK_BASELINES_SCHEMA);
  if (rows.length !== 1) {
    throw new Error('Production ladder-streak baseline schema audit returned an unexpected shape.');
  }
  const row = rows[0];
  const tableExists = row.table_exists === true;
  const evidence = {
    tableColumns: tableExists && row.table_columns === true,
    tablePrimaryKey: tableExists && row.table_primary_key === true,
    tableRatingForeignKey: tableExists && row.table_rating_foreign_key === true,
    tableCheck: tableExists && row.table_check === true,
    tableComment: tableExists && row.table_comment === true,
    tableOwner: tableExists && row.table_owner === true,
    tableGrants: tableExists && row.table_grants === true,
    playerCardContract: tableExists && row.player_card_contract === true,
    playerCardBody: tableExists && row.player_card_body === true,
    playerCardGrants: tableExists && row.player_card_grants === true,
    bestStreakDelegate: tableExists && row.best_streak_delegate === true,
  };
  const schemaStage = validateLadderStreakBaselineSchemaStage(evidence);
  const data = schemaStage === 1
    ? await auditLadderStreakBaselineData(readProduction)
    : undefined;
  return { evidence, schemaStage, data };
}

export async function auditLadderStreakBaselinesPostApplyData(
  readProduction = productionRead,
) {
  const evidence = await auditLadderStreakBaselineData(readProduction);
  if (evidence.baselineCount !== 0) {
    throw new Error('New ladder-streak baseline table was not empty after migration.');
  }
  return evidence;
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
    throw new Error('The lockfile-pinned Supabase CLI is missing; run mise exec -- npm ci.');
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
  let audited;
  if (rollout.audit === 'settings-locale') {
    audited = await auditPlayerSettings(plan, rollout);
  } else if (rollout.audit === 'match-command-retention') {
    audited = await auditMatchCommandRetention();
  } else if (rollout.audit === 'match-command-stall-check') {
    audited = await auditMatchCommandStallCheck();
  } else if (rollout.audit === 'rune-trial') {
    audited = await auditRuneTrial();
  } else if (rollout.audit === 'equipped-ranked') {
    audited = await auditEquippedRanked();
  } else if (rollout.audit === 'ladder-streak-baselines') {
    audited = await auditLadderStreakBaselines();
  } else if (rollout.audit === 'apple-game-center') {
    audited = await auditAppleGameCenter();
  } else {
    throw new Error(`Unknown production schema audit: ${String(rollout.audit)}.`);
  }
  const { evidence, schemaStage, data } = audited;
  if (schemaStage !== plan.stage) {
    throw new Error(`Production schema stage ${schemaStage} does not match migration stage ${plan.stage}.`);
  }
  return {
    history,
    plan,
    evidence: data ? { ...evidence, data } : evidence,
  };
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
      const humanBefore = rollout.audit === 'equipped-ranked'
        ? await auditEquippedRankedHumanData()
        : undefined;
      apply(temp, immediatelyBefore.plan.pending);

      const after = await auditProduction(rollout);
      if (after.plan.pending.length) {
        throw new Error('Production still reports pending rollout migrations.');
      }
      const postApplyData = rollout.audit === 'rune-trial'
        ? await auditRuneTrialPostApplyData()
        : rollout.audit === 'equipped-ranked'
          ? await auditEquippedRankedPostApplyData(productionRead, {
              requireCanonicalBotSeats: requiresCanonicalEquippedBotSeats(
                immediatelyBefore.plan.pending,
              ),
            })
          : rollout.audit === 'ladder-streak-baselines'
            ? await auditLadderStreakBaselinesPostApplyData()
            : undefined;
      const humanAfter = humanBefore
        ? assertSameEquippedRankedHumanData(
          humanBefore,
          await auditEquippedRankedHumanData(),
        )
        : undefined;
      process.stdout.write(JSON.stringify({
        rollout: rolloutName,
        status: 'applied',
        migrations: immediatelyBefore.plan.pending.map(({ file }) => path.basename(file)),
        checks: after.evidence,
        ...(postApplyData ? { postApplyData } : {}),
        ...(humanAfter ? { humanRowsPreserved: humanAfter.humanCount } : {}),
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
