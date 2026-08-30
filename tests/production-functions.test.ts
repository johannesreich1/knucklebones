import assert from 'node:assert/strict';
import { rmSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FUNCTION_CLI_VERSION,
  FUNCTION_DEPLOY_OPT_IN,
  FUNCTION_ROLLOUT_SLUGS,
  GAME_CENTER_ROLLOUT_SELECTOR,
  PRODUCTION_PROJECT_REF,
  assertActiveFunctionMetadata,
  assertExactDownloadedClosure,
  assertFunctionDeployOptIn,
  assertPinnedSupabaseLock,
  functionDeployArgs,
  functionDownloadArgs,
  functionListArgs,
  materializeFunctionProject,
  requireNode24,
  rolloutPlan,
  rolloutProductionFunctions,
  supabaseReadbackOmissionPaths,
} from '../tools/functions/production-rollout.mjs';
import {
  CLI,
  cleanupTemps,
  makeRunner,
  metadata,
  payloads,
  temp,
} from './support/production-functions-cases.ts';
import {
  assertGameCenterPlanContract,
  assertIdentityPlanContract,
} from './support/production-identity-cases.ts';
import {
  assertDistinctPlanOptIns,
  assertPlanEntryPoints,
} from './support/production-plan-cases.ts';
import { assertRankedRunesPlanContract } from './support/production-rune-trial-cases.ts';

try {
  requireNode24('24.8.0');
  assert.throws(() => requireNode24('23.9.0'), /Node 24 is required/);
  assert.deepEqual(FUNCTION_ROLLOUT_SLUGS, [
    'pvp-rune-select', 'pvp-action', 'account-delete', 'pvp-claim', 'pvp-move', 'pvp-join',
  ]);
  assert.equal(FUNCTION_ROLLOUT_SLUGS.at(-1), 'pvp-join');

  assert.equal(assertFunctionDeployOptIn(false, undefined), false);
  assert.equal(assertFunctionDeployOptIn(true, '1'), true);
  assert.throws(
    () => assertFunctionDeployOptIn(true, undefined),
    new RegExp(`${FUNCTION_DEPLOY_OPT_IN}=1`),
  );

  {
    const packageJson = { devDependencies: { supabase: FUNCTION_CLI_VERSION } };
    const lock = {
      packages: {
        '': { devDependencies: { supabase: FUNCTION_CLI_VERSION } },
        'node_modules/supabase': {
          version: FUNCTION_CLI_VERSION,
          integrity: 'sha512-focused-test-integrity',
        },
      },
    };
    assert.equal(
      assertPinnedSupabaseLock(packageJson, lock),
      'sha512-focused-test-integrity',
    );
    assert.throws(
      () => assertPinnedSupabaseLock(packageJson, {
        ...lock,
        packages: {
          ...lock.packages,
          'node_modules/supabase': {
            ...lock.packages['node_modules/supabase'],
            integrity: '  ',
          },
        },
      }),
      /non-empty integrity/,
    );
  }

  const deployArgs = functionDeployArgs('pvp-action', '/tmp/deploy');
  assert.deepEqual(deployArgs, [
    'functions', 'deploy', 'pvp-action', '--project-ref', PRODUCTION_PROJECT_REF,
    '--use-api', '--jobs', '1', '--workdir', '/tmp/deploy', '--yes',
  ]);
  assert.deepEqual(functionDownloadArgs('pvp-action', '/tmp/readback'), [
    'functions', 'download', 'pvp-action', '--project-ref', PRODUCTION_PROJECT_REF,
    '--use-api', '--workdir', '/tmp/readback',
  ]);
  assert.deepEqual(functionListArgs('/tmp/deploy'), [
    'functions', 'list', '--project-ref', PRODUCTION_PROJECT_REF,
    '--output', 'json', '--workdir', '/tmp/deploy',
  ]);
  assert.equal(deployArgs.includes('--prune'), false);
  assert.equal(deployArgs.includes('--no-verify-jwt'), false);
  assert.throws(() => functionDeployArgs('_shared', '/tmp/deploy'), /not in any production rollout allow-list/);
  assert.throws(
    () => functionDeployArgs('pvp-action', '/tmp/deploy', 'abcdefghijklmnopqrst'),
    /target must be/,
  );

  assert.deepEqual(
    assertActiveFunctionMetadata(JSON.stringify([metadata('pvp-action')]), 'pvp-action'),
    { slug: 'pvp-action', version: 7, updatedAt: 1_777_000_001_000 },
  );
  assert.throws(
    () => assertActiveFunctionMetadata(JSON.stringify([metadata('pvp-action', { status: 'REMOVED' })]), 'pvp-action'),
    /not ACTIVE/,
  );
  assert.throws(
    () => assertActiveFunctionMetadata(JSON.stringify([metadata('pvp-action', { verify_jwt: false })]), 'pvp-action'),
    /verify_jwt=true/,
  );
  assert.throws(
    () => assertActiveFunctionMetadata(JSON.stringify([metadata('pvp-action'), metadata('pvp-action')]), 'pvp-action'),
    /exactly one/,
  );

  {
    const root = temp('kb-production-functions-materialize-');
    materializeFunctionProject(root, payloads);
    assert.deepEqual(
      readdirSync(path.join(root, 'supabase', 'functions')).sort(),
      [...FUNCTION_ROLLOUT_SLUGS].sort(),
    );
    for (const slug of FUNCTION_ROLLOUT_SLUGS) {
      assertExactDownloadedClosure(
        path.join(root, 'supabase', 'functions', slug), slug, payloads.get(slug),
      );
    }
    for (const name of supabaseReadbackOmissionPaths('pvp-action')) {
      rmSync(path.join(root, 'supabase', 'functions', 'pvp-action', ...name.split('/')));
    }
    assert.equal(assertExactDownloadedClosure(
      path.join(root, 'supabase', 'functions', 'pvp-action'),
      'pvp-action',
      payloads.get('pvp-action'),
    ), true);
    const changedTypePayload = payloads.get('pvp-action')!.map(file => file.name === 'core/spell-types.ts'
      ? { ...file, content: `${file.content}\nexport const runtimeValue = true;\n` }
      : file);
    assert.throws(
      () => assertExactDownloadedClosure(
        path.join(root, 'supabase', 'functions', 'pvp-action'),
        'pvp-action',
        changedTypePayload,
      ),
      /downloaded paths differ/,
    );
    writeFileSync(path.join(root, 'supabase', 'functions', 'pvp-action', 'extra.ts'), 'extra');
    assert.throws(
      () => assertExactDownloadedClosure(
        path.join(root, 'supabase', 'functions', 'pvp-action'),
        'pvp-action',
        payloads.get('pvp-action'),
      ),
      /downloaded paths differ/,
    );
  }

  {
    const base = makeRunner();
    const capture = base.runner.capture.bind(base.runner);
    base.runner.capture = (command: string, args: string[]) =>
      command === 'git' && args[0] === 'status'
        ? ' M tools/fnfiles.mjs'
        : capture(command, args);
    let created = false;
    await assert.rejects(
      () => rolloutProductionFunctions({
        apply: false,
        runner: base.runner,
        cli: CLI,
        nodeVersion: '24.8.0',
        createTemp: () => { created = true; return os.tmpdir(); },
        log: () => {},
      }),
      /rollout inputs must match committed HEAD/,
    );
    assert.equal(created, false, 'dirty rollout inputs reached temporary materialization');
  }

  {
    const { runner } = makeRunner();
    let removed = false;
    await assert.rejects(
      () => rolloutProductionFunctions({
        apply: false,
        runner,
        cli: CLI,
        nodeVersion: '24.8.0',
        createTemp: () => os.tmpdir(),
        removeTemp: () => { removed = true; },
        log: () => {},
      }),
      /Refusing unsafe temporary/,
    );
    assert.equal(removed, false, 'an unvalidated broad path was recursively removed');
  }

  // The default plan, by name: what ranked-runes demands of production
  // before it deploys, and the guarded flows it then runs.
  await assertRankedRunesPlanContract();

  // Every plan rolls out on its own selector, its own opt-in and its own
  // package.json entry point, so an operator who exports one variable can only
  // ever deploy the one set that variable names.
  assertDistinctPlanOptIns();
  assert.equal(
    assertPlanEntryPoints().get(GAME_CENTER_ROLLOUT_SELECTOR),
    'functions:production:game-center',
  );
  const identity = rolloutPlan('identity-hardening');
  assert.deepEqual(identity.slugs, [
    'identity-status', 'apple-token-register', 'apple-revocation-retry',
  ]);
  assert.equal(identity.optIn, 'KB_ALLOW_PRODUCTION_IDENTITY_FUNCTIONS');

  // gc-auth is the auth boundary, so it is its own plan and nothing else is in
  // it: deploying it is always a deliberate, single act. It is no longer held —
  // the signed-device pass is the ACCEPTANCE step that runs after this deploy,
  // because the device exercises the deployed function. Every readback check
  // the other plans get, it gets too.
  const gameCenter = rolloutPlan(GAME_CENTER_ROLLOUT_SELECTOR);
  assert.equal(GAME_CENTER_ROLLOUT_SELECTOR, 'game-center');
  assert.deepEqual(functionDownloadArgs('gc-auth', '/tmp/readback'), [
    'functions', 'download', 'gc-auth', '--project-ref', PRODUCTION_PROJECT_REF,
    '--use-api', '--workdir', '/tmp/readback',
  ]);

  assert.equal((await assertIdentityPlanContract(identity)).prerequisite.schemaStage, 4);
  assert.equal((await assertGameCenterPlanContract(gameCenter)).prerequisite.schemaStage, 4);
} finally {
  cleanupTemps();
}

console.log(JSON.stringify({
  out: { productionFunctionRolloutSafety: true },
  problems: [],
  errs: [],
}, null, 2));
