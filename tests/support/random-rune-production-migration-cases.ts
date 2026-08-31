import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  parseMigrationFilename,
  validateEquippedRankedSchemaStage,
} from '../../tools/database/production-rollout-core.mjs';
import {
  EQUIPPED_RANKED_BOT_DATA,
  EQUIPPED_RANKED_HUMAN_DATA,
  EQUIPPED_RANKED_MIGRATION_SHA256,
  EQUIPPED_RANKED_SCHEMA,
  HISTORICAL_SILVER_RANKED_RUNES_MIGRATION_SHA256,
  RANDOM_RUNE_MODE_MIGRATION_SHA256,
  RANKED_RUNES_MIGRATIONS,
  auditEquippedRankedBotData,
} from '../../tools/database/production-rollout.mjs';

type Check = (name: string, run: () => void) => void;
type CheckAsync = (name: string, run: () => Promise<void>) => Promise<void>;
type Guarded = (run: () => unknown, pattern: RegExp) => void;

export const EQUIPPED_RANKED_ABSENT = Object.freeze({
  queueCapabilityConstraint: false,
  matchConstraints: false,
  functionContracts: false,
  functionBodies: false,
  serviceGrants: false,
  helperLockdown: false,
  randomModeColumn: false,
  randomModeConstraint: false,
  randomModeComment: false,
  randomModeGrant: false,
  equipmentIntegrityConstraints: false,
  profileSecurity: false,
  compatibilityTrigger: false,
  compatibilityFunctionContract: false,
  compatibilityFunctionBody: false,
  compatibilityFunctionLockdown: false,
  randomHelperContract: false,
  randomHelperBody: false,
  randomHelperLockdown: false,
  randomStartContract: false,
  randomStartBody: false,
  randomStartGrant: false,
  equipmentRpcContract: false,
  equipmentRpcBody: false,
  equipmentRpcGrant: false,
  historicalSilverPolicy: false,
});

export const EQUIPPED_RANKED_STAGE_ONE = Object.freeze({
  ...EQUIPPED_RANKED_ABSENT,
  queueCapabilityConstraint: true,
  matchConstraints: true,
  functionContracts: true,
  functionBodies: true,
  serviceGrants: true,
  helperLockdown: true,
});

export const EQUIPPED_RANKED_STAGE_TWO = Object.freeze({
  ...Object.fromEntries(
    Object.keys(EQUIPPED_RANKED_ABSENT).map(key => [key, true]),
  ),
  historicalSilverPolicy: false,
});

const snakeCaseMetadata = (metadata: Readonly<Record<string, boolean>>) => Object.freeze(
  Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`),
    value,
  ])),
);

export const EQUIPPED_RANKED_COMPLETE_SCHEMA_ROW = snakeCaseMetadata(
  Object.freeze(Object.fromEntries(
    Object.keys(EQUIPPED_RANKED_ABSENT).map(key => [key, true]),
  )),
);
export const EQUIPPED_RANKED_STAGE_ONE_SCHEMA_ROW = snakeCaseMetadata(
  EQUIPPED_RANKED_STAGE_ONE,
);
export const EQUIPPED_RANKED_STAGE_TWO_SCHEMA_ROW = snakeCaseMetadata(
  EQUIPPED_RANKED_STAGE_TWO,
);

export async function runRandomRuneProductionMigrationCases(options: {
  readonly check: Check;
  readonly checkAsync: CheckAsync;
  readonly guarded: Guarded;
}): Promise<void> {
  const { check, checkAsync, guarded } = options;

  check('ranked-runes stages 2 and 3 pin both forward migrations byte-for-byte', () => {
    const randomMigration = '20260830160000_random_rune_mode.sql';
    assert.deepEqual(parseMigrationFilename(randomMigration), {
      filename: randomMigration,
      version: '20260830160000',
      name: 'random_rune_mode',
    });
    const randomBytes = readFileSync(
      new URL('../../supabase/migrations/' + randomMigration, import.meta.url),
    );
    assert.equal(createHash('sha256').update(randomBytes).digest('hex'),
      RANDOM_RUNE_MODE_MIGRATION_SHA256);
    assert.equal(RANDOM_RUNE_MODE_MIGRATION_SHA256,
      'd27232fcf61165b4a0334e185b69818d0dd7c0cc172b9cc35e6d3360781d915f');
    const historicalMigration = '20260831133000_historical_silver_ranked_runes.sql';
    assert.deepEqual(parseMigrationFilename(historicalMigration), {
      filename: historicalMigration,
      version: '20260831133000',
      name: 'historical_silver_ranked_runes',
    });
    const historicalBytes = readFileSync(
      new URL('../../supabase/migrations/' + historicalMigration, import.meta.url),
    );
    assert.equal(createHash('sha256').update(historicalBytes).digest('hex'),
      HISTORICAL_SILVER_RANKED_RUNES_MIGRATION_SHA256);
    assert.equal(HISTORICAL_SILVER_RANKED_RUNES_MIGRATION_SHA256,
      '95b3cdfc1e584e3a5e3ea66d237a1a54e4d3eb78ac394a86850c98db39471e2a');
    assert.deepEqual(RANKED_RUNES_MIGRATIONS, [
      {
        version: '20260830155543',
        name: 'equipped_runes_ranked',
        file: 'supabase/migrations/20260830155543_equipped_runes_ranked.sql',
        sha256: EQUIPPED_RANKED_MIGRATION_SHA256,
      },
      {
        version: '20260830160000',
        name: 'random_rune_mode',
        file: 'supabase/migrations/20260830160000_random_rune_mode.sql',
        sha256: RANDOM_RUNE_MODE_MIGRATION_SHA256,
      },
      {
        version: '20260831133000',
        name: 'historical_silver_ranked_runes',
        file: 'supabase/migrations/20260831133000_historical_silver_ranked_runes.sql',
        sha256: HISTORICAL_SILVER_RANKED_RUNES_MIGRATION_SHA256,
      },
    ], 'ranked-runes must retain its prefixes and add an ordered stage 3');
  });

  check('equipped-ranked metadata accepts only its four ordered stages', () => {
    const complete = Object.fromEntries(
      Object.keys(EQUIPPED_RANKED_ABSENT).map(key => [key, true]),
    );
    assert.equal(validateEquippedRankedSchemaStage(EQUIPPED_RANKED_ABSENT), 0);
    assert.equal(validateEquippedRankedSchemaStage(EQUIPPED_RANKED_STAGE_ONE), 1);
    assert.equal(validateEquippedRankedSchemaStage(EQUIPPED_RANKED_STAGE_TWO), 2);
    assert.equal(validateEquippedRankedSchemaStage(complete), 3);
    guarded(() => validateEquippedRankedSchemaStage({
      ...EQUIPPED_RANKED_ABSENT,
      queueCapabilityConstraint: true,
    }), /partial/);
    guarded(() => validateEquippedRankedSchemaStage({
      ...complete,
      randomStartGrant: false,
    }), /partial/);
    guarded(() => validateEquippedRankedSchemaStage({
      ...EQUIPPED_RANKED_STAGE_ONE,
      historicalSilverPolicy: true,
    }), /partial/);
    for (const field of [
      'equipmentIntegrityConstraints',
      'profileSecurity',
      'equipmentRpcContract',
      'equipmentRpcBody',
      'equipmentRpcGrant',
    ]) {
      guarded(() => validateEquippedRankedSchemaStage({
        ...complete,
        [field]: false,
      }), /partial/);
    }
    guarded(() => validateEquippedRankedSchemaStage({
      ...EQUIPPED_RANKED_ABSENT,
      unexpected: false,
    } as never), /unexpected shape/);
    guarded(() => validateEquippedRankedSchemaStage({
      ...EQUIPPED_RANKED_ABSENT,
      functionBodies: 'false',
    } as never), /must be boolean/);
  });

  check('RANDOM catalog audit pins its complete database and security surface', () => {
    for (const marker of [
      "column_name = 'random_rune_mode'",
      "column_default = 'false'",
      "conname = 'profiles_random_rune_mode_has_fallback'",
      "conname = 'profiles_equipped_rune_owned'",
      "conname = 'profiles_equipped_rune_known'",
      'cadbea3be7238de9f895be698ccf9742',
      '5245e8c97f7710d59f9925987b2685c4',
      'When true, ordinary ranked from SILVER snapshots a seed-derived random rune',
      'When true, ordinary ranked after SILVER has been reached once snapshots a seed-derived random rune from the player collection. equipped_rune remains a concrete owned fallback for older clients. Rune Trial ignores both profile fields.',
      'The one collected rune carried into ordinary ranked after SILVER has been reached once. NULL means nothing equipped, which is a deliberate choice and not an error. Rune Trial ignores this and never overwrites it.',
      'attribute.attacl',
      "'authenticated:UPDATE:false'",
      "'authenticated:SELECT:false'",
      "'authenticated:EXECUTE:false'",
      'profiles_update_own',
      'profiles_select_own',
      '7035f36bb692789e5d2feb46291a7a86',
      'relrowsecurity',
      'has_table_privilege',
      'aclexplode(',
      "trigger_row.tgname = 'profiles_normalize_rune_equipment_update'",
      'trigger_row.tgtype = 19',
      'private.normalize_rune_equipment_update()',
      '56fd0f92d36cc00fccc496a437c251ae',
      'private.random_owned_rune_for_match(uuid,text)',
      'public.set_rune_equipment(text,boolean)',
      '3dcdc059bb6068e2aaa8e36181f9549d',
      '5cf88a87f3cb5df762537a59238d5d56',
      'e6986a11de9d9efbf89467626ae9fb8f',
      '3fc7bb43af43ded3f11ec0f6d7b3dd96',
      'historical_silver_policy',
      'Compatibility trigger: authenticated direct equipped_rune writes and ownership SET NULL clear RANDOM',
      'Deterministic per-match choice from the participant current owned inventory',
    ]) {
      assert.ok(EQUIPPED_RANKED_SCHEMA.includes(marker), 'missing audit marker ' + marker);
    }
    const randomCommentAlternatives = EQUIPPED_RANKED_SCHEMA.match(
      /select col_description\(to_regclass\('public\.profiles'\), attribute\.attnum\) in \(([\s\S]*?)\)\n      from pg_attribute attribute\n     where attribute\.attrelid = to_regclass\('public\.profiles'\)\n       and attribute\.attname = 'random_rune_mode'/,
    );
    assert.ok(randomCommentAlternatives,
      'the RANDOM comment audit must expose its exact ordered alternatives');
    assert.deepEqual(
      [...randomCommentAlternatives[1].matchAll(/'([^']*)'/g)].map(match => match[1]),
      [
        'When true, ordinary ranked from SILVER snapshots a seed-derived random rune from the player collection. equipped_rune remains a concrete owned fallback for older clients. Rune Trial ignores both profile fields.',
        'When true, ordinary ranked after SILVER has been reached once snapshots a seed-derived random rune from the player collection. equipped_rune remains a concrete owned fallback for older clients. Rune Trial ignores both profile fields.',
      ],
      'the RANDOM comment audit admitted an unreviewed stage or rejected a valid prefix',
    );
    assert.match(
      EQUIPPED_RANKED_SCHEMA,
      /select md5\(prosrc\) = alternate_body_md5[\s\S]+attribute\.attname = 'equipped_rune'[\s\S]+attribute\.attname = 'random_rune_mode'[\s\S]+as historical_silver_policy/,
      'the stage-3 marker must require the historical-Silver postcondition',
    );
    for (const marker of [
      'bots_random_mode',
      "to_jsonb(profile)->>'random_rune_mode'",
    ]) {
      assert.ok(EQUIPPED_RANKED_BOT_DATA.includes(marker),
        'missing bot audit marker ' + marker);
    }
    assert.match(EQUIPPED_RANKED_HUMAN_DATA, /random_rune_mode/,
      'the preservation fingerprint must cover fixed and random equipment');
  });

  await checkAsync('ranked bot audit rejects RANDOM even with a valid fixed seat', async () => {
    await assert.rejects(auditEquippedRankedBotData(async (query, parameters = []) => {
      assert.equal(query, EQUIPPED_RANKED_BOT_DATA);
      assert.deepEqual(parameters, []);
      return [{
        bot_count: 1,
        bots_with_runes: 1,
        bots_equipped: 1,
        bots_with_runes_without_seat: 0,
        bots_without_runes_with_seat: 0,
        bot_seat_not_owned: 0,
        bots_random_mode: 1,
      }];
    }), /random mode is not allowed for bots/);
  });
}
