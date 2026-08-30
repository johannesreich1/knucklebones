import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  parseMigrationFilename,
  validateEquippedRankedSchemaStage,
} from '../../tools/database/production-rollout-core.mjs';
import {
  EQUIPPED_RANKED_BOT_DATA,
  EQUIPPED_RANKED_BOT_CONVERGENCE,
  EQUIPPED_RANKED_HUMAN_DATA,
  EQUIPPED_RANKED_MIGRATION_SHA256,
  EQUIPPED_RANKED_SCHEMA,
  RUNE_TRIAL_FUNCTIONS,
  RUNE_TRIAL_JOB,
  RUNE_TRIAL_SCHEMA,
  auditEquippedRanked,
  auditEquippedRankedBotData,
  auditEquippedRankedPostApplyData,
  auditEquippedRankedHumanData,
  assertSameEquippedRankedHumanData,
} from '../../tools/database/production-rollout.mjs';

type Check = (name: string, run: () => void) => void;
type CheckAsync = (name: string, run: () => Promise<void>) => Promise<void>;
type Guarded = (run: () => unknown, pattern: RegExp) => void;

const ABSENT = Object.freeze({
  queueCapabilityConstraint: false,
  matchConstraints: false,
  functionContracts: false,
  functionBodies: false,
  serviceGrants: false,
  helperLockdown: false,
});

const FOUNDATION_SCHEMA = Object.freeze({
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
  cron_extension: true,
});
const FOUNDATION_FUNCTIONS = Object.freeze({
  function_contracts: true,
  function_bodies: true,
  function_grants: true,
});
const FOUNDATION_JOB = Object.freeze({ cron_job: true, cron_job_contract: true });
const COMPLETE_SCHEMA = Object.freeze({
  queue_capability_constraint: true,
  match_constraints: true,
  function_contracts: true,
  function_bodies: true,
  service_grants: true,
  helper_lockdown: true,
});
const BOT_DATA = Object.freeze({
  bot_count: 200,
  bots_with_runes: 155,
  bots_equipped: 155,
  bots_with_runes_without_seat: 0,
  bots_without_runes_with_seat: 0,
  bot_seat_not_owned: 0,
});

function productionRead(overrides: {
  schema?: Record<string, unknown>;
  bots?: Record<string, unknown>;
  convergence?: Record<string, unknown>;
  humans?: Record<string, unknown>;
} = {}) {
  return async (query: string, parameters: unknown[] = []) => {
    assert.deepEqual(parameters, []);
    if (query === RUNE_TRIAL_SCHEMA) return [FOUNDATION_SCHEMA];
    if (query === RUNE_TRIAL_FUNCTIONS) return [FOUNDATION_FUNCTIONS];
    if (query === RUNE_TRIAL_JOB) return [FOUNDATION_JOB];
    if (query === EQUIPPED_RANKED_SCHEMA) {
      return [{ ...COMPLETE_SCHEMA, ...overrides.schema }];
    }
    if (query === EQUIPPED_RANKED_BOT_DATA) {
      return [{ ...BOT_DATA, ...overrides.bots }];
    }
    if (query === EQUIPPED_RANKED_BOT_CONVERGENCE) {
      return [{ bot_seat_not_canonical: 0, ...overrides.convergence }];
    }
    if (query === EQUIPPED_RANKED_HUMAN_DATA) {
      return [{
        human_count: 3,
        equipped_rune_fingerprint: '0123456789abcdef0123456789abcdef',
        ...overrides.humans,
      }];
    }
    return assert.fail('equipped-ranked audit read an unreviewed query');
  };
}

export async function runEquippedRankedProductionMigrationCases(options: {
  readonly check: Check;
  readonly checkAsync: CheckAsync;
  readonly guarded: Guarded;
}): Promise<void> {
  const { check, checkAsync, guarded } = options;
  const migration = '20260830155543_equipped_runes_ranked.sql';

  check('equipped-ranked rollout pins the committed forward migration byte-for-byte', () => {
    assert.deepEqual(parseMigrationFilename(migration), {
      filename: migration,
      version: '20260830155543',
      name: 'equipped_runes_ranked',
    });
    const bytes = readFileSync(
      new URL('../../supabase/migrations/' + migration, import.meta.url),
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      EQUIPPED_RANKED_MIGRATION_SHA256,
    );
    assert.equal(
      EQUIPPED_RANKED_MIGRATION_SHA256,
      'c41d5051fc1d6bbf522233ecaa469f83b12ee3efbdcfd237ff8841ed963d6f15',
    );
  });

  check('equipped-ranked schema metadata accepts only absent or complete state', () => {
    assert.equal(validateEquippedRankedSchemaStage(ABSENT), 0);
    const complete = Object.fromEntries(Object.keys(ABSENT).map(key => [key, true]));
    assert.equal(validateEquippedRankedSchemaStage(complete), 1);
    guarded(
      () => validateEquippedRankedSchemaStage({
        ...ABSENT,
        queueCapabilityConstraint: true,
      }),
      /partial/,
    );
    guarded(
      () => validateEquippedRankedSchemaStage({ ...complete, helperLockdown: false }),
      /partial/,
    );
    guarded(
      () => validateEquippedRankedSchemaStage({ ...ABSENT, unexpected: false } as never),
      /unexpected shape/,
    );
    guarded(
      () => validateEquippedRankedSchemaStage({
        ...ABSENT,
        functionBodies: 'false',
      } as never),
      /must be boolean/,
    );
  });

  check('equipped-ranked catalog audit pins constraints, bodies, grants, and helper lockdown', () => {
    for (const marker of [
      '81f60e7c70ee6080403a93229cd4205a',
      '3c1715e608652fbe8de401aeb31530dc',
      '09bc02d0fc04f5b7a311fe29246774dd',
      'public.start_ranked_match_v3',
      'private.bot_owned_rune_choice(uuid)',
      '8d6c669dd740a64a1df872b3a6359944',
      'b7b1b9e7899045936f4d6a246f1c9eee',
      'b6cbfd6a8630c49653664bf554aa346a',
      '969ec904c8bce2bf1cfab78a90d8669b',
      'cb197365655531053efedc039ed84380',
      "role_name = 'service_role'",
      "proconfig = array['search_path=\"\"']::text[]",
      'Stable pseudorandom selection from one player inventory',
    ]) {
      assert.ok(EQUIPPED_RANKED_SCHEMA.includes(marker), 'missing audit marker ' + marker);
    }
    assert.match(RUNE_TRIAL_SCHEMA, /81f60e7c70ee6080403a93229cd4205a/,
      'the durable Rune Trial audit did not admit the reviewed widened constraint');
    for (const body of [
      '8d6c669dd740a64a1df872b3a6359944',
      '969ec904c8bce2bf1cfab78a90d8669b',
      'cb197365655531053efedc039ed84380',
    ]) {
      assert.ok(RUNE_TRIAL_FUNCTIONS.includes(body),
        'the durable Rune Trial audit did not admit upgraded body ' + body);
    }
  });

  check('equipped-ranked data audit measures bot seat coverage, ownership, and convergence', () => {
    for (const marker of [
      'bots_with_runes_without_seat',
      'bots_without_runes_with_seat',
      'bot_seat_not_owned',
      'owned.rune_id = profile.equipped_rune',
    ]) {
      assert.ok(EQUIPPED_RANKED_BOT_DATA.includes(marker),
        'missing bot audit marker ' + marker);
    }
    assert.match(EQUIPPED_RANKED_BOT_CONVERGENCE,
      /:bot-equipped-v1:/);
    assert.doesNotMatch(EQUIPPED_RANKED_BOT_CONVERGENCE,
      /private\.bot_owned_rune_choice/,
      'the read-only post-apply audit cannot EXECUTE the deliberately locked helper');
  });

  await checkAsync('equipped-ranked audit composes the complete Rune Trial foundation', async () => {
    const complete = await auditEquippedRanked(productionRead());
    assert.equal(complete.schemaStage, 1);
    assert.ok(Object.values(complete.evidence).every(value => value === true));
    assert.deepEqual(complete.data, {
      botCount: 200,
      botsWithRunes: 155,
      botsEquipped: 155,
      botsWithRunesWithoutSeat: 0,
      botsWithoutRunesWithSeat: 0,
      botSeatNotOwned: 0,
    });

    const absent = await auditEquippedRanked(async (query, parameters = []) => {
      if (query === EQUIPPED_RANKED_SCHEMA) {
        assert.deepEqual(parameters, []);
        return [Object.fromEntries(Object.keys(COMPLETE_SCHEMA).map(key => [key, false]))];
      }
      if (query === EQUIPPED_RANKED_BOT_DATA) {
        assert.deepEqual(parameters, []);
        return [{
          ...BOT_DATA,
          bots_equipped: 154,
          bots_with_runes_without_seat: 1,
        }];
      }
      return productionRead()(query, parameters);
    });
    assert.deepEqual(absent, {
      evidence: ABSENT,
      schemaStage: 0,
      data: {
        botCount: 200,
        botsWithRunes: 155,
        botsEquipped: 154,
        botsWithRunesWithoutSeat: 1,
        botsWithoutRunesWithSeat: 0,
        botSeatNotOwned: 0,
      },
    });

    await assert.rejects(
      auditEquippedRanked(productionRead({ schema: { helper_lockdown: false } })),
      /partial/,
    );
    await assert.rejects(
      auditEquippedRanked(async (query, parameters = []) => (
        query === RUNE_TRIAL_FUNCTIONS
          ? [{ ...FOUNDATION_FUNCTIONS, function_bodies: false }]
          : productionRead()(query, parameters)
      )),
      /function contract.*partial/,
    );
  });

  await checkAsync('equipped-ranked bot audits reject missing and unowned seats', async () => {
    assert.deepEqual(
      await auditEquippedRankedBotData(productionRead()),
      {
        botCount: 200,
        botsWithRunes: 155,
        botsEquipped: 155,
        botsWithRunesWithoutSeat: 0,
        botsWithoutRunesWithSeat: 0,
        botSeatNotOwned: 0,
      },
    );
    await assert.rejects(
      auditEquippedRankedBotData(productionRead({
        bots: { bots_equipped: 154, bots_with_runes_without_seat: 1 },
      })),
      /missing, unowned, or attached without inventory/,
    );
    assert.deepEqual(
      await auditEquippedRankedBotData(productionRead({
        bots: { bots_equipped: 154, bots_with_runes_without_seat: 1 },
      }), { allowMissingSeats: true }),
      {
        botCount: 200,
        botsWithRunes: 155,
        botsEquipped: 154,
        botsWithRunesWithoutSeat: 1,
        botsWithoutRunesWithSeat: 0,
        botSeatNotOwned: 0,
      },
    );
    await assert.rejects(
      auditEquippedRankedBotData(productionRead({ bots: { bot_seat_not_owned: 1 } })),
      /missing, unowned, or attached without inventory/,
    );
    await assert.rejects(
      auditEquippedRankedBotData(productionRead({ bots: { bot_count: 'NaN' } })),
      /invalid bot_count/,
    );
  });

  await checkAsync('immediate equipped-ranked post-apply audit requires canonical bot choices', async () => {
    assert.equal(
      (await auditEquippedRankedPostApplyData(productionRead())).botSeatNotCanonical,
      0,
    );
    await assert.rejects(
      auditEquippedRankedPostApplyData(productionRead({
        convergence: { bot_seat_not_canonical: 1 },
      })),
      /did not converge/,
    );
  });

  await checkAsync('equipped-ranked apply fingerprints human seats before and after', async () => {
    const before = await auditEquippedRankedHumanData(productionRead());
    assert.deepEqual(before, {
      humanCount: 3,
      equippedRuneFingerprint: '0123456789abcdef0123456789abcdef',
    });
    assert.deepEqual(assertSameEquippedRankedHumanData(before, { ...before }), before);
    assert.throws(
      () => assertSameEquippedRankedHumanData(before, {
        ...before,
        equippedRuneFingerprint: 'fedcba9876543210fedcba9876543210',
      }),
      /human equipped-rune rows changed/,
    );
    await assert.rejects(
      auditEquippedRankedHumanData(productionRead({
        humans: { equipped_rune_fingerprint: 'not-a-fingerprint' },
      })),
      /invalid fingerprint/,
    );
    assert.match(EQUIPPED_RANKED_HUMAN_DATA, /where not profile\.is_bot/);
  });

  check('ranked-runes has one explicit database CLI and package selector', () => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      'tools/database/production-rollout.mjs',
      '--help',
    ], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /ranked-runes/);

    const packageJson = JSON.parse(readFileSync(
      new URL('../../package.json', import.meta.url),
      'utf8',
    ));
    assert.equal(
      packageJson.scripts['db:production:ranked-runes'],
      'node --experimental-strip-types tools/database/production-rollout.mjs ranked-runes',
    );
  });
}
