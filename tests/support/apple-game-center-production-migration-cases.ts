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
  auditAppleGameCenter,
} from '../../tools/database/production-rollout.mjs';

type Check = (name: string, run: () => void) => void;
type CheckAsync = (name: string, run: () => Promise<void>) => Promise<void>;
type Guarded = (run: () => unknown, pattern: RegExp) => void;

const MIGRATIONS = Object.freeze([
  '20260826153100_game_center_ids.sql',
  '20260826153101_game_center_service_grants.sql',
  '20260826153102_apple_identity_credentials.sql',
  '20260826181000_apple_revocation_unstage.sql',
]);

/** One raw audit row the way APPLE_GAME_CENTER_SCHEMA returns it. */
const appleAuditRow = (overrides: Record<string, boolean> = {}) => ({
  game_center_table: false,
  game_center_service_grant: false,
  apple_credential_table: false,
  apple_credential_functions: false,
  apple_credential_function_bodies: false,
  apple_credential_grants: false,
  apple_unstage_function_present: false,
  apple_unstage_function: false,
  ...overrides,
});

const credentialPrefixRow = (overrides: Record<string, boolean> = {}) => appleAuditRow({
  game_center_table: true,
  game_center_service_grant: true,
  apple_credential_table: true,
  apple_credential_functions: true,
  apple_credential_function_bodies: true,
  apple_credential_grants: true,
  ...overrides,
});

export async function runAppleGameCenterProductionMigrationCases(options: {
  readonly check: Check;
  readonly checkAsync: CheckAsync;
  readonly guarded: Guarded;
}): Promise<void> {
  const { check, checkAsync, guarded } = options;

  check('Apple/Game Center rollout pins four post-ladder migrations byte-for-byte', () => {
    const parsed = validateMigrationFilenames(MIGRATIONS);
    assert.deepEqual(parsed.map(({ version, name }: { version: string; name: string }) => [version, name]), [
      ['20260826153100', 'game_center_ids'],
      ['20260826153101', 'game_center_service_grants'],
      ['20260826153102', 'apple_identity_credentials'],
      ['20260826181000', 'apple_revocation_unstage'],
    ]);
    assert.ok(parsed.every(({ version }: { version: string }) => version > '20260826153000'));

    const expectedHashes = [
      APPLE_GAME_CENTER_MIGRATION_SHA256.gameCenterIds,
      APPLE_GAME_CENTER_MIGRATION_SHA256.gameCenterServiceGrants,
      APPLE_GAME_CENTER_MIGRATION_SHA256.appleIdentityCredentials,
      APPLE_GAME_CENTER_MIGRATION_SHA256.appleRevocationUnstage,
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

  await checkAsync('Apple/Game Center audit extends the prefix to the exact stage-four unstage function', async () => {
    const read = (row: Record<string, boolean>) => async () => [row];
    assert.deepEqual(await auditAppleGameCenter(read(appleAuditRow())), {
      evidence: {
        gameCenterTable: false,
        gameCenterServiceGrant: false,
        appleCredentialTable: false,
        appleCredentialFunctions: false,
        appleCredentialFunctionBodies: false,
        appleCredentialGrants: false,
        appleUnstageFunction: false,
      },
      schemaStage: 0,
    });
    const staged = await auditAppleGameCenter(read(credentialPrefixRow()));
    assert.equal(staged.schemaStage, 3);
    assert.equal(staged.evidence.appleUnstageFunction, false);
    const complete = await auditAppleGameCenter(read(credentialPrefixRow({
      apple_unstage_function_present: true,
      apple_unstage_function: true,
    })));
    assert.equal(complete.schemaStage, 4);
    assert.equal(complete.evidence.appleUnstageFunction, true);
    await assert.rejects(
      () => auditAppleGameCenter(read(credentialPrefixRow({
        apple_unstage_function_present: true,
      }))),
      /does not match the reviewed contract/,
    );
    await assert.rejects(
      () => auditAppleGameCenter(read(appleAuditRow({
        game_center_table: true,
        game_center_service_grant: true,
        apple_unstage_function_present: true,
        apple_unstage_function: true,
      }))),
      /before its credential prefix/,
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
      'public.unstage_apple_revocation(uuid)',
      'a7277a021de3892315a3204c70295ef4',
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
    assert.match(result.stderr, /ladder-streak-baselines\|apple-game-center/);
    assert.match(result.stderr, /KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1/);
  });
}
