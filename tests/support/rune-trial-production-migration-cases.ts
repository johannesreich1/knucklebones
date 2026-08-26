import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  parseMigrationFilename,
  validateRuneTrialSchemaStage,
} from '../../tools/database/production-rollout-core.mjs';
import {
  RUNE_TRIAL_FUNCTIONS,
  RUNE_TRIAL_JOB,
  RUNE_TRIAL_MIGRATION_SHA256,
  RUNE_TRIAL_POST_APPLY_DATA,
  RUNE_TRIAL_SCHEMA,
} from '../../tools/database/production-rollout.mjs';

type Check = (name: string, run: () => void) => void;
type Guarded = (run: () => unknown, pattern: RegExp) => void;

export function runRuneTrialProductionMigrationCases(options: {
  readonly check: Check;
  readonly guarded: Guarded;
}): void {
  const { check, guarded } = options;
  const migration = '20260825205241_rune_trial_ranked_v2.sql';

  check('Rune Trial rollout pins the one committed migration byte-for-byte', () => {
    assert.deepEqual(parseMigrationFilename(migration), {
      filename: migration,
      version: '20260825205241',
      name: 'rune_trial_ranked_v2',
    });
    const bytes = readFileSync(
      new URL('../../supabase/migrations/' + migration, import.meta.url),
    );
    assert.equal(createHash('sha256').update(bytes).digest('hex'), RUNE_TRIAL_MIGRATION_SHA256);
    assert.equal(
      RUNE_TRIAL_MIGRATION_SHA256,
      '930c4c52979df8e94bb0e59e033203c3973401f433f1d7ac3594cac20291cc33',
    );
  });

  check('Rune Trial schema metadata accepts only absent or complete state', () => {
    const absent = {
      profileProgression: false,
      matchProtocol: false,
      queueProtocol: false,
      playerRunesTable: false,
      matchActionsTable: false,
      privateTables: false,
      indexes: false,
      policies: false,
      tableGrants: false,
      privateTablesLocked: false,
      functionContracts: false,
      functionBodies: false,
      functionGrants: false,
      realtimePublication: false,
      cronJob: false,
      cronJobContract: false,
    };
    assert.equal(validateRuneTrialSchemaStage(absent), 0);
    const complete = Object.fromEntries(Object.keys(absent).map(key => [key, true]));
    assert.equal(validateRuneTrialSchemaStage(complete), 1);
    guarded(
      () => validateRuneTrialSchemaStage({ ...absent, profileProgression: true }),
      /partial/,
    );
    guarded(
      () => validateRuneTrialSchemaStage({ ...absent, unexpected: false } as never),
      /unexpected shape/,
    );
    guarded(
      () => validateRuneTrialSchemaStage({ ...complete, cronJobContract: false }),
      /partial/,
    );
  });

  check('Rune Trial audit pins schema, security, functions, and baseline data', () => {
    for (const marker of [
      'profiles_ranked_pool_tier_check',
      'matches_format_state_check',
      'matchmaking_queue_capabilities_check',
      'public.player_runes',
      'public.match_actions',
      'private.rune_trial_choices',
      'private.rune_trial_selection_commands',
      'private.match_action_commands',
      'player_runes_select_own',
      'match_actions_select_participant',
      "pg_get_userbyid(c.relowner) = 'postgres'",
      'aclexplode',
      'supabase_realtime',
    ]) {
      assert.ok(RUNE_TRIAL_SCHEMA.includes(marker), 'missing schema marker ' + marker);
    }
    for (const marker of [
      'private.ranked_pool_tier_for_peak(integer)',
      'public.acknowledge_rune_reward(text)',
      'public.enqueue_ranked_player_v2(uuid,smallint,text[])',
      'public.start_ranked_match_v2',
      'private.finalize_rune_trial_locked',
      'private.rune_trial_payload',
      'public.rune_trial_state',
      'public.commit_rune_trial_choice',
      'public.settle_match',
      'public.match_action_result',
      'public.commit_match_action',
      'private.purge_expired_rune_trial_commands',
      'array[\'search_path=""\']',
      "owner_name = 'postgres'",
      'md5(prosrc)',
      'service_role',
      'authenticated',
    ]) {
      assert.ok(RUNE_TRIAL_FUNCTIONS.includes(marker), 'missing function marker ' + marker);
    }
    assert.match(RUNE_TRIAL_JOB, /purge-expired-rune-trial-commands/);
    assert.match(RUNE_TRIAL_JOB, /'7 \* \* \* \*'/);
    assert.match(RUNE_TRIAL_JOB, /database = current_database\(\)/);
    assert.match(RUNE_TRIAL_JOB, /username = 'postgres'/);
    assert.match(RUNE_TRIAL_JOB, /nodename = 'localhost'/);
    assert.match(RUNE_TRIAL_JOB, /nodeport = current_setting\('port'\)::integer/);
    assert.match(RUNE_TRIAL_JOB, /interval ''7 days''/);
    assert.match(RUNE_TRIAL_JOB, /5000/);
    assert.match(RUNE_TRIAL_POST_APPLY_DATA, /ranked_pool_tier/);
    assert.match(RUNE_TRIAL_POST_APPLY_DATA, /protocol_version is distinct from 1/);
    assert.match(
      RUNE_TRIAL_POST_APPLY_DATA,
      /queue\.capabilities is distinct from '\{\}'::text\[\]/,
    );
    assert.match(
      RUNE_TRIAL_POST_APPLY_DATA,
      /select count\(\*\) from public\.player_runes/,
    );
  });

  check('Rune Trial is an explicit CLI selection and help remains read-only', () => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      'tools/database/production-rollout.mjs',
      '--help',
    ], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /settings-locale\|match-command-retention\|rune-trial/);
    assert.match(result.stderr, /KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1/);
  });
}
