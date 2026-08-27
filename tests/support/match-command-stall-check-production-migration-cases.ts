import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  parseMigrationFilename,
} from '../../tools/database/production-rollout-core.mjs';
import {
  MATCH_COMMAND_STALL_CHECK_MIGRATION_SHA256,
  MATCH_COMMAND_STALL_CHECK_SCHEMA,
  auditMatchCommandStallCheck,
} from '../../tools/database/production-rollout.mjs';

type Check = (name: string, run: () => void) => void;
type CheckAsync = (name: string, run: () => Promise<void>) => Promise<void>;

const MIGRATION = '20260826181500_match_command_stall_check.sql';

/** One raw audit row the way MATCH_COMMAND_STALL_CHECK_SCHEMA returns it. */
const stallAuditRow = (
  state: 'legacy' | 'replaced',
  overrides: Record<string, boolean> = {},
) => ({
  legacy_command_function: state === 'legacy',
  stall_command_function: state === 'replaced',
  stall_command_body: state === 'replaced',
  stall_command_grants: state === 'replaced',
  single_command_function: true,
  ...overrides,
});

export async function runMatchCommandStallCheckProductionMigrationCases(options: {
  readonly check: Check;
  readonly checkAsync: CheckAsync;
}): Promise<void> {
  const { check, checkAsync } = options;

  check('stall-check rollout pins the one committed migration byte-for-byte', () => {
    assert.deepEqual(parseMigrationFilename(MIGRATION), {
      filename: MIGRATION,
      version: '20260826181500',
      name: 'match_command_stall_check',
    });
    const bytes = readFileSync(
      new URL('../../supabase/migrations/' + MIGRATION, import.meta.url),
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      MATCH_COMMAND_STALL_CHECK_MIGRATION_SHA256,
    );
    assert.equal(
      MATCH_COMMAND_STALL_CHECK_MIGRATION_SHA256,
      'ea067e3e3f63e94bed0ae4370317017b9530327697860f2fe961b52a42d295cd',
    );
  });

  check('stall-check audit pins both exact commit_match_command signatures and bodies', () => {
    for (const marker of [
      'public.commit_match_command(uuid,uuid,uuid,smallint,boolean,integer,smallint,smallint,jsonb,smallint,smallint,jsonb,jsonb)',
      'public.commit_match_command(uuid,uuid,uuid,smallint,boolean,integer,smallint,smallint,jsonb,smallint,smallint,jsonb,jsonb,timestamptz)',
      '7b0d24c0fcb9457c2233c092d4087878',
      // Stage 1's body, re-pinned by 20260827160000_auto_forfeit_streak, which
      // replaces this same signature in place to maintain the away allowance.
      'e3fd9a2600e539dfcbf796c6717993fd',
      'pronargdefaults = 2',
      'prosecdef',
      'search_path=""',
      'aclexplode',
      "proname = 'commit_match_command'",
    ]) {
      assert.ok(MATCH_COMMAND_STALL_CHECK_SCHEMA.includes(marker), 'missing audit marker ' + marker);
    }
  });

  await checkAsync('stall-check audit accepts only the exact legacy or replaced function state', async () => {
    const read = (row: Record<string, boolean>) => async () => [row];
    assert.deepEqual(await auditMatchCommandStallCheck(read(stallAuditRow('legacy'))), {
      evidence: {
        legacyCommandFunction: true,
        stallCommandFunction: false,
        stallCommandBody: false,
        stallCommandGrants: false,
        singleCommandFunction: true,
      },
      schemaStage: 0,
    });
    assert.deepEqual(await auditMatchCommandStallCheck(read(stallAuditRow('replaced'))), {
      evidence: {
        legacyCommandFunction: false,
        stallCommandFunction: true,
        stallCommandBody: true,
        stallCommandGrants: true,
        singleCommandFunction: true,
      },
      schemaStage: 1,
    });
    // Both signatures at once, a divergent replacement body or grant set, a
    // lingering overload, and a fully absent function all fail closed.
    const partials = [
      stallAuditRow('replaced', { legacy_command_function: true, single_command_function: false }),
      stallAuditRow('replaced', { stall_command_body: false }),
      stallAuditRow('replaced', { stall_command_grants: false }),
      stallAuditRow('legacy', { single_command_function: false }),
      stallAuditRow('legacy', { legacy_command_function: false }),
    ];
    for (const partial of partials) {
      await assert.rejects(
        () => auditMatchCommandStallCheck(read(partial)),
        /does not match either reviewed stall-check state/,
      );
    }
    await assert.rejects(
      () => auditMatchCommandStallCheck(async () => []),
      /unexpected shape/,
    );
  });
}
