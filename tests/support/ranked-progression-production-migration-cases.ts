import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  parseMigrationFilename,
  validateRankedProgressionSchemaStage,
} from '../../tools/database/production-rollout-core.mjs';
import {
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
  tableConstraints: false,
  tableIndexes: false,
  tableComments: false,
  tableRlsPolicy: false,
  tableGrants: false,
  ackFunctionContract: false,
  ackFunctionBody: false,
  ackFunctionGrants: false,
  settleMatchEventBody: false,
});

const ABSENT_SCHEMA_ROW = Object.freeze({
  table_contract: false,
  table_columns: false,
  table_constraints: false,
  table_indexes: false,
  table_comments: false,
  table_rls_policy: false,
  table_grants: false,
  ack_function_contract: false,
  ack_function_body: false,
  ack_function_grants: false,
  settle_match_event_body: false,
  settle_match_contract: true,
});

const COMPLETE_SCHEMA_ROW = Object.freeze(
  Object.fromEntries(Object.keys(ABSENT_SCHEMA_ROW).map(key => [key, true])),
);

export async function runRankedProgressionProductionMigrationCases(options: {
  readonly check: Check;
  readonly checkAsync: CheckAsync;
  readonly guarded: Guarded;
}): Promise<void> {
  const { check, checkAsync, guarded } = options;
  const migration = '20260830182406_ranked_progression_events.sql';

  check('ranked-progression rollout pins the one committed migration byte-for-byte', () => {
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
    assert.deepEqual(RANKED_PROGRESSION_MIGRATIONS, [{
      version: '20260830182406',
      name: 'ranked_progression_events',
      file: 'supabase/migrations/20260830182406_ranked_progression_events.sql',
      sha256: RANKED_PROGRESSION_MIGRATION_SHA256,
    }]);
  });

  check('ranked-progression metadata accepts only absent or complete state', () => {
    assert.equal(validateRankedProgressionSchemaStage(ABSENT), 0);
    const complete = Object.fromEntries(Object.keys(ABSENT).map(key => [key, true]));
    assert.equal(validateRankedProgressionSchemaStage(complete), 1);
    guarded(
      () => validateRankedProgressionSchemaStage({
        ...ABSENT,
        tableColumns: true,
      }),
      /partial/,
    );
    guarded(
      () => validateRankedProgressionSchemaStage({
        ...complete,
        ackFunctionGrants: false,
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
      "'ranked_progression_events_player_created_idx'",
      "'ranked_progression_events_season_idx'",
      'One owner-only before/after snapshot per settled human participant',
      'Historical private.ladder_board apex result immediately before this settlement',
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
    ]) {
      assert.ok(
        RANKED_PROGRESSION_SCHEMA.includes(marker),
        'missing settlement audit marker ' + marker,
      );
    }
  });

  await checkAsync('ranked-progression audit distinguishes absent and complete states', async () => {
    const absent = await auditRankedProgression(async (sql) => {
      assert.equal(sql, RANKED_PROGRESSION_SCHEMA);
      return [ABSENT_SCHEMA_ROW];
    });
    assert.deepEqual(absent, { evidence: ABSENT, schemaStage: 0 });

    const complete = await auditRankedProgression(async (sql) => {
      assert.equal(sql, RANKED_PROGRESSION_SCHEMA);
      return [COMPLETE_SCHEMA_ROW];
    });
    assert.equal(complete.schemaStage, 1);
    assert.ok(Object.values(complete.evidence).every(value => value === true));
  });

  await checkAsync('ranked-progression audit fails closed on partial or changed settlement state', async () => {
    await assert.rejects(
      auditRankedProgression(async () => [{
        ...COMPLETE_SCHEMA_ROW,
        table_rls_policy: false,
      }]),
      /partial/,
    );
    await assert.rejects(
      auditRankedProgression(async () => [{
        ...ABSENT_SCHEMA_ROW,
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
