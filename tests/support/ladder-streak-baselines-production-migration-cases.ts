import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  parseMigrationFilename,
  validateLadderStreakBaselineSchemaStage,
} from '../../tools/database/production-rollout-core.mjs';
import {
  LADDER_STREAK_BASELINES_DATA,
  LADDER_STREAK_BASELINES_MIGRATION_SHA256,
  LADDER_STREAK_BASELINES_SCHEMA,
  auditLadderStreakBaselineData,
  auditLadderStreakBaselines,
  auditLadderStreakBaselinesPostApplyData,
} from '../../tools/database/production-rollout.mjs';

type Check = (name: string, run: () => void) => void;
type CheckAsync = (name: string, run: () => Promise<void>) => Promise<void>;
type Guarded = (run: () => unknown, pattern: RegExp) => void;

const ABSENT = Object.freeze({
  tableColumns: false,
  tablePrimaryKey: false,
  tableRatingForeignKey: false,
  tableCheck: false,
  tableComment: false,
  tableOwner: false,
  tableGrants: false,
  playerCardContract: false,
  playerCardBody: false,
  playerCardGrants: false,
  bestStreakDelegate: false,
});

const COMPLETE_SCHEMA_ROW = Object.freeze({
  table_exists: true,
  table_columns: true,
  table_primary_key: true,
  table_rating_foreign_key: true,
  table_check: true,
  table_comment: true,
  table_owner: true,
  table_grants: true,
  player_card_contract: true,
  player_card_body: true,
  player_card_grants: true,
  best_streak_delegate: true,
});

export async function runLadderStreakBaselineProductionMigrationCases(options: {
  readonly check: Check;
  readonly checkAsync: CheckAsync;
  readonly guarded: Guarded;
}): Promise<void> {
  const { check, checkAsync, guarded } = options;
  const migration = '20260826153000_ladder_streak_baselines.sql';

  check('ladder-streak rollout pins the one committed migration byte-for-byte', () => {
    assert.deepEqual(parseMigrationFilename(migration), {
      filename: migration,
      version: '20260826153000',
      name: 'ladder_streak_baselines',
    });
    const bytes = readFileSync(
      new URL('../../supabase/migrations/' + migration, import.meta.url),
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      LADDER_STREAK_BASELINES_MIGRATION_SHA256,
    );
    assert.equal(
      LADDER_STREAK_BASELINES_MIGRATION_SHA256,
      '1b132572fde4df5f451e0c1780077c0e07156300fbd91b24833614a8d2e6c827',
    );
  });

  check('ladder-streak schema metadata accepts only absent or complete state', () => {
    assert.equal(validateLadderStreakBaselineSchemaStage(ABSENT), 0);
    const complete = Object.fromEntries(Object.keys(ABSENT).map(key => [key, true]));
    assert.equal(validateLadderStreakBaselineSchemaStage(complete), 1);
    guarded(
      () => validateLadderStreakBaselineSchemaStage({
        ...ABSENT,
        tableColumns: true,
      }),
      /partial/,
    );
    guarded(
      () => validateLadderStreakBaselineSchemaStage({
        ...complete,
        playerCardBody: false,
      }),
      /partial/,
    );
    guarded(
      () => validateLadderStreakBaselineSchemaStage({
        ...ABSENT,
        unexpected: false,
      } as never),
      /unexpected shape/,
    );
    guarded(
      () => validateLadderStreakBaselineSchemaStage({
        ...ABSENT,
        tableColumns: 'false',
      } as never),
      /must be boolean/,
    );
  });

  check('ladder-streak catalog audit pins the complete private-table boundary', () => {
    for (const marker of [
      "'private'",
      "'season_streak_baselines'",
      "column_name = 'season_id'",
      "column_name = 'player'",
      "column_name = 'best_streak'",
      "conname = 'season_streak_baselines_pkey'",
      "conkey = array[1, 2]::smallint[]",
      "conname = 'season_streak_baselines_rating_fkey'",
      "confrelid = to_regclass('public.season_ratings')",
      "confkey = array[1, 2]::smallint[]",
      "confdeltype = 'c'",
      "conname = 'season_streak_baselines_best_streak_check'",
      "CHECK (best_streak >= 0)",
      'Imported per-season lower bound for the displayed best streak',
      "pg_get_userbyid(relowner) = 'postgres'",
      'aclexplode(',
      'attribute.attacl',
    ]) {
      assert.ok(
        LADDER_STREAK_BASELINES_SCHEMA.includes(marker),
        'missing table audit marker ' + marker,
      );
    }
  });

  check('ladder-streak audit pins player-card and delegate contracts exactly', () => {
    for (const marker of [
      "to_regprocedure('public.player_card(text)')",
      "pg_get_function_identity_arguments(oid) = 'nick text'",
      'TABLE(streak integer, since timestamp with time zone, points integer, wins bigint, losses bigint, games bigint, rank bigint, apex boolean, peak integer)',
      "md5(prosrc) = '08b41fc75ee2fd8fd4cd0c463c438fbd'",
      "'anon:EXECUTE:false'",
      "'authenticated:EXECUTE:false'",
      "to_regprocedure('public.best_streak()')",
      "md5(prosrc) = 'bf58986f9cd949e67012b9cd89d87d08'",
      "proconfig = array['search_path=\"\"']::text[]",
    ]) {
      assert.ok(
        LADDER_STREAK_BASELINES_SCHEMA.includes(marker),
        'missing function audit marker ' + marker,
      );
    }
  });

  check('ladder-streak data audit rejects orphan, negative, and impossible rows', () => {
    assert.match(LADDER_STREAK_BASELINES_DATA, /rating\.player is null/);
    assert.match(LADDER_STREAK_BASELINES_DATA, /baseline\.best_streak < 0/);
    assert.match(LADDER_STREAK_BASELINES_DATA, /baseline\.best_streak > rating\.wins/);
    assert.match(LADDER_STREAK_BASELINES_DATA, /count\(\*\)::bigint as baseline_count/);
  });

  await checkAsync('ladder-streak schema audit distinguishes absence from valid non-empty state', async () => {
    let absentReads = 0;
    const absent = await auditLadderStreakBaselines(async (sql) => {
      absentReads += 1;
      assert.equal(sql, LADDER_STREAK_BASELINES_SCHEMA);
      return [{
        ...COMPLETE_SCHEMA_ROW,
        table_exists: false,
      }];
    });
    assert.equal(absentReads, 1);
    assert.deepEqual(absent, {
      evidence: ABSENT,
      schemaStage: 0,
      data: undefined,
    });

    const complete = await auditLadderStreakBaselines(async (sql) => {
      if (sql === LADDER_STREAK_BASELINES_SCHEMA) return [COMPLETE_SCHEMA_ROW];
      assert.equal(sql, LADDER_STREAK_BASELINES_DATA);
      return [{ baseline_count: '150', baselines_valid: true }];
    });
    assert.equal(complete.schemaStage, 1);
    assert.deepEqual(complete.data, { baselinesValid: true, baselineCount: 150 });
    assert.ok(Object.values(complete.evidence).every(value => value === true));
  });

  await checkAsync('ladder-streak audits fail closed on partial schema or invalid data', async () => {
    await assert.rejects(
      auditLadderStreakBaselines(async () => [{
        ...COMPLETE_SCHEMA_ROW,
        table_comment: false,
      }]),
      /partial/,
    );
    await assert.rejects(
      auditLadderStreakBaselineData(async () => [{
        baseline_count: '1',
        baselines_valid: false,
      }]),
      /rows are invalid/,
    );
    await assert.rejects(
      auditLadderStreakBaselineData(async () => [{
        baseline_count: '9007199254740992',
        baselines_valid: true,
      }]),
      /rows are invalid/,
    );
  });

  await checkAsync('immediate post-apply ladder-streak audit requires an empty table', async () => {
    assert.deepEqual(
      await auditLadderStreakBaselinesPostApplyData(async () => [{
        baseline_count: 0,
        baselines_valid: true,
      }]),
      { baselinesValid: true, baselineCount: 0 },
    );
    await assert.rejects(
      auditLadderStreakBaselinesPostApplyData(async () => [{
        baseline_count: 1,
        baselines_valid: true,
      }]),
      /was not empty/,
    );
  });

  check('ladder-streak rollout has one explicit CLI and package selector', () => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      'tools/database/production-rollout.mjs',
      '--help',
    ], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /ladder-streak-baselines/);

    const packageJson = JSON.parse(readFileSync(
      new URL('../../package.json', import.meta.url),
      'utf8',
    ));
    assert.equal(
      packageJson.scripts['db:production:streak-baselines'],
      'node --experimental-strip-types tools/database/production-rollout.mjs ladder-streak-baselines',
    );
  });
}
