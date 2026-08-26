import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  parseMigrationFilename,
  validateAppleGameCenterSchemaStage,
  validateMigrationFilenames,
} from '../../tools/database/production-rollout-core.mjs';
import {
  APPLE_GAME_CENTER_MIGRATION_SHA256,
  APPLE_GAME_CENTER_SCHEMA,
} from '../../tools/database/production-rollout.mjs';

type Check = (name: string, run: () => void) => void;
type Guarded = (run: () => unknown, pattern: RegExp) => void;

const MIGRATIONS = Object.freeze([
  '20260826102600_game_center_ids.sql',
  '20260826102601_game_center_service_grants.sql',
  '20260826102602_apple_identity_credentials.sql',
]);

export function runAppleGameCenterProductionMigrationCases(options: {
  readonly check: Check;
  readonly guarded: Guarded;
}): void {
  const { check, guarded } = options;

  check('Apple/Game Center rollout pins three post-Rune-Trial migrations byte-for-byte', () => {
    const parsed = validateMigrationFilenames(MIGRATIONS);
    assert.deepEqual(parsed.map(({ version, name }) => [version, name]), [
      ['20260826102600', 'game_center_ids'],
      ['20260826102601', 'game_center_service_grants'],
      ['20260826102602', 'apple_identity_credentials'],
    ]);
    assert.ok(parsed.every(({ version }) => version > '20260825205241'));

    const expectedHashes = [
      APPLE_GAME_CENTER_MIGRATION_SHA256.gameCenterIds,
      APPLE_GAME_CENTER_MIGRATION_SHA256.gameCenterServiceGrants,
      APPLE_GAME_CENTER_MIGRATION_SHA256.appleIdentityCredentials,
    ];
    for (const [index, migration] of MIGRATIONS.entries()) {
      assert.deepEqual(parseMigrationFilename(migration), parsed[index]);
      const bytes = readFileSync(
        new URL('../../supabase/migrations/' + migration, import.meta.url),
      );
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHashes[index]);
    }
  });

  check('Apple/Game Center schema metadata accepts only the ordered stages zero through three', () => {
    const absent = {
      gameCenterTable: false,
      gameCenterServiceGrant: false,
      appleCredentialTable: false,
      appleCredentialFunctions: false,
      appleCredentialFunctionBodies: false,
      appleCredentialGrants: false,
    };
    assert.equal(validateAppleGameCenterSchemaStage(absent), 0);
    assert.equal(validateAppleGameCenterSchemaStage({
      ...absent,
      gameCenterTable: true,
    }), 1);
    assert.equal(validateAppleGameCenterSchemaStage({
      ...absent,
      gameCenterTable: true,
      gameCenterServiceGrant: true,
    }), 2);
    assert.equal(validateAppleGameCenterSchemaStage({
      gameCenterTable: true,
      gameCenterServiceGrant: true,
      appleCredentialTable: true,
      appleCredentialFunctions: true,
      appleCredentialFunctionBodies: true,
      appleCredentialGrants: true,
    }), 3);
    guarded(
      () => validateAppleGameCenterSchemaStage({
        ...absent,
        gameCenterServiceGrant: true,
      }),
      /partial or out of order/,
    );
    guarded(
      () => validateAppleGameCenterSchemaStage({
        ...absent,
        gameCenterTable: true,
        gameCenterServiceGrant: true,
        appleCredentialTable: true,
      }),
      /partial or out of order/,
    );
    guarded(
      () => validateAppleGameCenterSchemaStage({ ...absent, unexpected: false } as never),
      /unexpected shape/,
    );
  });

  check('Apple/Game Center production audit pins identity and revocation security boundaries', () => {
    for (const marker of [
      'public.game_center_ids',
      'game_center_ids_user_id_fkey',
      "array['INSERT', 'SELECT']",
      'private.apple_revocation_credentials',
      'apple_revocation_credentials_user_client_idx',
      'apple_revocation_credentials_due_idx',
      'supabase_vault',
      'vault.decrypted_secrets',
      'public.store_apple_revocation_credential(uuid,text,text)',
      'public.apple_revocation_ready(uuid)',
      'public.stage_apple_revocation(uuid)',
      'public.take_apple_revocation(bigint)',
      'public.claim_apple_revocations(integer)',
      'public.finish_apple_revocation(bigint,text)',
      'md5(prosrc)',
      'aclexplode',
      "'anon', 'authenticated'",
      'search_path=""',
    ]) {
      assert.ok(APPLE_GAME_CENTER_SCHEMA.includes(marker), 'missing audit marker ' + marker);
    }
  });

  check('Apple/Game Center is an explicit CLI and package-script selection', () => {
    const packageJson = JSON.parse(readFileSync(
      new URL('../../package.json', import.meta.url),
      'utf8',
    ));
    assert.equal(
      packageJson.scripts?.['db:production:apple-game-center'],
      'node --experimental-strip-types tools/database/production-rollout.mjs apple-game-center',
    );

    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      'tools/database/production-rollout.mjs',
      '--help',
    ], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /rune-trial\|apple-game-center/);
    assert.match(result.stderr, /KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1/);
  });
}
