import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  parseMigrationFilename,
  validateRankedProgressionSchemaStage,
} from '../../tools/database/production-rollout-core.mjs';
import {
  HISTORICAL_SILVER_RANKED_RUNES_MIGRATION_SHA256,
  RANKED_PROGRESSION_MIGRATION_SHA256,
  RANKED_PROGRESSION_MIGRATIONS,
  RANKED_PROGRESSION_SCHEMA,
  auditRankedProgression,
} from '../../tools/database/production-rollout.mjs';

type Check = (name: string, run: () => void) => void;
type CheckAsync = (name: string, run: () => Promise<void>) => Promise<void>;
type Guarded = (run: () => unknown, pattern: RegExp) => void;

const ABSENT = Object.freeze({
  tableContract: false,
  tableColumns: false,
  tableIndexes: false,
  baseTableComments: false,
  tableRlsPolicy: false,
  tableGrants: false,
  ackFunctionContract: false,
  ackFunctionBody: false,
  ackFunctionGrants: false,
  legacyTableConstraints: false,
  legacyRuneComments: false,
  legacySettleMatchEventBody: false,
  historicalTableConstraints: false,
  historicalRuneComments: false,
  historicalRuneMatchStartPolicy: false,
  historicalSettleMatchEventBody: false,
});

const BASE_COMPLETE = Object.freeze({
  ...ABSENT,
  tableContract: true,
  tableColumns: true,
  tableIndexes: true,
  baseTableComments: true,
  tableRlsPolicy: true,
  tableGrants: true,
  ackFunctionContract: true,
  ackFunctionBody: true,
  ackFunctionGrants: true,
});

const LEGACY = Object.freeze({
  ...BASE_COMPLETE,
  legacyTableConstraints: true,
  legacyRuneComments: true,
  legacySettleMatchEventBody: true,
});

const COMPLETE = Object.freeze({
  ...BASE_COMPLETE,
  historicalTableConstraints: true,
  historicalRuneComments: true,
  historicalRuneMatchStartPolicy: true,
  historicalSettleMatchEventBody: true,
});

export const RANKED_PROGRESSION_ABSENT_SCHEMA_ROW = Object.freeze({
  table_contract: false,
  table_columns: false,
  table_indexes: false,
  base_table_comments: false,
  table_rls_policy: false,
  table_grants: false,
  ack_function_contract: false,
  ack_function_body: false,
  ack_function_grants: false,
  legacy_table_constraints: false,
  legacy_rune_comments: false,
  legacy_settle_match_event_body: false,
  historical_table_constraints: false,
  historical_rune_comments: false,
  historical_rune_match_start_policy: false,
  historical_settle_match_event_body: false,
  settle_match_contract: true,
});

const schemaRow = (metadata: Readonly<Record<string, boolean>>) => Object.freeze({
  ...Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`),
    value,
  ])),
  settle_match_contract: true,
});

export const RANKED_PROGRESSION_LEGACY_SCHEMA_ROW = schemaRow(LEGACY);
export const RANKED_PROGRESSION_COMPLETE_SCHEMA_ROW = schemaRow(COMPLETE);

export async function runRankedProgressionProductionMigrationCases(options: {
  readonly check: Check;
  readonly checkAsync: CheckAsync;
  readonly guarded: Guarded;
}): Promise<void> {
  const { check, checkAsync, guarded } = options;
  const migration = '20260830182406_ranked_progression_events.sql';

  check('ranked-progression rollout preserves the applied migration and pins the forward correction', () => {
    assert.deepEqual(parseMigrationFilename(migration), {
      filename: migration,
      version: '20260830182406',
      name: 'ranked_progression_events',
    });
    const bytes = readFileSync(
      new URL('../../supabase/migrations/' + migration, import.meta.url),
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      RANKED_PROGRESSION_MIGRATION_SHA256,
    );
    assert.equal(
      RANKED_PROGRESSION_MIGRATION_SHA256,
      'b8364a0926261036a3623ddaa7ba5c1d0465ca3bf2214bc9622b2d763ab849f1',
    );
    const correction = '20260831133000_historical_silver_ranked_runes.sql';
    assert.deepEqual(parseMigrationFilename(correction), {
      filename: correction,
      version: '20260831133000',
      name: 'historical_silver_ranked_runes',
    });
    const correctionBytes = readFileSync(
      new URL('../../supabase/migrations/' + correction, import.meta.url),
    );
    assert.equal(
      createHash('sha256').update(correctionBytes).digest('hex'),
      HISTORICAL_SILVER_RANKED_RUNES_MIGRATION_SHA256,
    );
    assert.equal(
      HISTORICAL_SILVER_RANKED_RUNES_MIGRATION_SHA256,
      '95b3cdfc1e584e3a5e3ea66d237a1a54e4d3eb78ac394a86850c98db39471e2a',
    );
    const correctionSql = correctionBytes.toString('utf8');
    for (const marker of [
      'with historical_unlocks as materialized',
      'bool_or(event.rune_seat_active_before',
      'rating.peak >= 1260',
      'set rune_seat_active_before = unlock.unlocked',
      'check (not rune_seat_active_before or rune_seat_active_after) not valid',
      'validate constraint ranked_progression_events_rune_unlock_monotonic_check',
      'stale or duplicate unlock screen',
    ]) {
      assert.ok(correctionSql.includes(marker),
        'historical-Silver upgrade lost backfill marker ' + marker);
    }
    assert.deepEqual(RANKED_PROGRESSION_MIGRATIONS, [
      {
        version: '20260830182406',
        name: 'ranked_progression_events',
        file: 'supabase/migrations/20260830182406_ranked_progression_events.sql',
        sha256: RANKED_PROGRESSION_MIGRATION_SHA256,
      },
      {
        version: '20260831133000',
        name: 'historical_silver_ranked_runes',
        file: 'supabase/migrations/20260831133000_historical_silver_ranked_runes.sql',
        sha256: HISTORICAL_SILVER_RANKED_RUNES_MIGRATION_SHA256,
      },
    ]);
  });

  check('ranked-progression metadata accepts only absent, applied, or corrected state', () => {
    assert.equal(validateRankedProgressionSchemaStage(ABSENT), 0);
    assert.equal(validateRankedProgressionSchemaStage(LEGACY), 1);
    assert.equal(validateRankedProgressionSchemaStage(COMPLETE), 2);
    guarded(
      () => validateRankedProgressionSchemaStage({
        ...ABSENT,
        tableColumns: true,
      }),
      /partial/,
    );
    guarded(
      () => validateRankedProgressionSchemaStage({
        ...COMPLETE,
        ackFunctionGrants: false,
      }),
      /partial/,
    );
    guarded(
      () => validateRankedProgressionSchemaStage({
        ...LEGACY,
        historicalRuneComments: true,
      }),
      /partial/,
    );
    guarded(
      () => validateRankedProgressionSchemaStage({
        ...LEGACY,
        legacyRuneComments: false,
      }),
      /partial/,
    );
    guarded(
      () => validateRankedProgressionSchemaStage({
        ...ABSENT,
        unexpected: false,
      } as never),
      /unexpected shape/,
    );
    guarded(
      () => validateRankedProgressionSchemaStage({
        ...ABSENT,
        tableContract: 'false',
      } as never),
      /must be boolean/,
    );
  });

  check('ranked-progression catalog audit pins the exact durable table', () => {
    for (const marker of [
      "c.relname = 'ranked_progression_events'",
      "(1, 'id', 'uuid'",
      "(18, 'seen_at', 'timestamp with time zone'",
      "'ranked_progression_events_match_player_key'",
      "'ranked_progression_events_player_id_fkey'",
      "'ranked_progression_events_rune_live_before_check'",
      "'ranked_progression_events_rune_live_after_check'",
      "'ranked_progression_events_rune_unlock_monotonic_check'",
      "'ranked_progression_events_player_created_idx'",
      "'ranked_progression_events_season_idx'",
      'One owner-only before/after snapshot per settled human participant',
      'Historical private.ladder_board apex result immediately before this settlement',
      'Whether the player had ever reached SILVER before settlement',
      'once true this permanent unlock never becomes false',
      'Stamped only by acknowledge_ranked_progression',
    ]) {
      assert.ok(
        RANKED_PROGRESSION_SCHEMA.includes(marker),
        'missing table audit marker ' + marker,
      );
    }
  });

  check('ranked-progression audit pins owner-only RLS, ACL, and acknowledgement', () => {
    for (const marker of [
      "policy.polname = 'ranked_progression_events_select_own'",
      "policy.polcmd = 'r'",
      "rolname = 'authenticated'",
      "'c73f233b1e589b1bf262b92e38619649'",
      "array['authenticated:SELECT:false']::text[]",
      "to_regprocedure(\n     'public.acknowledge_ranked_progression(uuid)'",
      "pg_get_function_identity_arguments(oid) = 'p_event_id uuid'",
      "'3ed9e015de54a82049255e4cecc312ec'",
      "array['authenticated:EXECUTE:false']::text[]",
    ]) {
      assert.ok(
        RANKED_PROGRESSION_SCHEMA.includes(marker),
        'missing owner-boundary audit marker ' + marker,
      );
    }
  });

  check('ranked-progression audit preserves the exact settle_match service contract', () => {
    for (const marker of [
      'public.settle_match(uuid,text,uuid,integer,integer,integer,integer,jsonb,jsonb,jsonb,jsonb)',
      'p_match_id uuid, p_status text, p_winner uuid, p_p1_score integer, p_p2_score integer, p_p1_delta integer, p_p2_delta integer, p_expected_p1 jsonb, p_expected_p2 jsonb, p_next_p1 jsonb, p_next_p2 jsonb',
      "pg_get_function_result(oid) = 'jsonb'",
      "array['service_role:EXECUTE:false']::text[]",
      "'ec865febe67e1370a877459e4b89ec65'",
      "'2aabcbcd3ba8231de00843f4350924c9'",
    ]) {
      assert.ok(
        RANKED_PROGRESSION_SCHEMA.includes(marker),
        'missing settlement audit marker ' + marker,
      );
    }
  });

  await checkAsync('ranked-progression audit distinguishes absent, applied, and corrected states', async () => {
    const absent = await auditRankedProgression(async (sql) => {
      assert.equal(sql, RANKED_PROGRESSION_SCHEMA);
      return [RANKED_PROGRESSION_ABSENT_SCHEMA_ROW];
    });
    assert.deepEqual(absent, { evidence: ABSENT, schemaStage: 0 });

    const legacy = await auditRankedProgression(async (sql) => {
      assert.equal(sql, RANKED_PROGRESSION_SCHEMA);
      return [RANKED_PROGRESSION_LEGACY_SCHEMA_ROW];
    });
    assert.deepEqual(legacy, { evidence: LEGACY, schemaStage: 1 });

    const complete = await auditRankedProgression(async (sql) => {
      assert.equal(sql, RANKED_PROGRESSION_SCHEMA);
      return [RANKED_PROGRESSION_COMPLETE_SCHEMA_ROW];
    });
    assert.equal(complete.schemaStage, 2);
    assert.deepEqual(complete.evidence, COMPLETE);
  });

  await checkAsync('ranked-progression audit fails closed on partial or changed settlement state', async () => {
    await assert.rejects(
      auditRankedProgression(async () => [{
        ...RANKED_PROGRESSION_COMPLETE_SCHEMA_ROW,
        table_rls_policy: false,
      }]),
      /partial/,
    );
    await assert.rejects(
      auditRankedProgression(async () => [{
        ...RANKED_PROGRESSION_ABSENT_SCHEMA_ROW,
        settle_match_contract: false,
      }]),
      /eleven-argument service contract/,
    );
    await assert.rejects(
      auditRankedProgression(async () => []),
      /unexpected shape/,
    );
  });

  check('ranked-progression rollout has one explicit CLI and package selector', () => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      'tools/database/production-rollout.mjs',
      '--help',
    ], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /ranked-progression-events/);

    const packageJson = JSON.parse(readFileSync(
      new URL('../../package.json', import.meta.url),
      'utf8',
    ));
    assert.equal(
      packageJson.scripts['db:production:ranked-progression-events'],
      'node --experimental-strip-types tools/database/production-rollout.mjs ranked-progression-events',
    );
  });
}
