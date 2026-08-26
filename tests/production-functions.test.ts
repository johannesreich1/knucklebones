import assert from 'node:assert/strict';
import { rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FUNCTION_CLI_VERSION,
  FUNCTION_DEPLOY_OPT_IN,
  FUNCTION_ROLLOUT_SLUGS,
  PRODUCTION_PROJECT_REF,
  SUPABASE_TYPE_ONLY_READBACK_OMISSIONS,
  assertActiveFunctionMetadata,
  assertExactDownloadedClosure,
  assertFunctionDeployOptIn,
  assertPinnedSupabaseLock,
  assertRuneTrialProductionPrerequisite,
  functionDeployArgs,
  functionDownloadArgs,
  functionListArgs,
  materializeFunctionProject,
  requireNode24,
  rolloutProductionFunctions,
} from '../tools/functions/production-rollout.mjs';
import {
  CLI,
  cleanupTemps,
  makeRunner,
  metadata,
  payloads,
  prerequisite,
  readyProductionRead,
  temp,
} from './support/production-functions-cases.ts';

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

  assert.deepEqual(
    await assertRuneTrialProductionPrerequisite(readyProductionRead()),
    { migrationHistory: true, schemaStage: 1, evidence: prerequisite() },
  );
  await assert.rejects(
    () => assertRuneTrialProductionPrerequisite(
      readyProductionRead(undefined, { history: false }),
    ),
    /migration must be exactly/,
  );
  await assert.rejects(
    () => assertRuneTrialProductionPrerequisite(
      readyProductionRead(undefined, { schema: { policies: false } }),
    ),
    /security boundary.*partial/,
  );
  await assert.rejects(
    () => assertRuneTrialProductionPrerequisite(
      readyProductionRead(undefined, { functions: { function_bodies: false } }),
    ),
    /function contract.*partial/,
  );
  await assert.rejects(
    () => assertRuneTrialProductionPrerequisite(
      readyProductionRead(undefined, { job: { cron_job_contract: false } }),
    ),
    /cron job.*partial/,
  );
  await assert.rejects(
    () => assertRuneTrialProductionPrerequisite(
      readyProductionRead(undefined, { schema: { cron_extension: false } }),
    ),
    /reviewed pg_cron extension/,
  );

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
  assert.throws(() => functionDeployArgs('gc-auth', '/tmp/deploy'), /allow-list/);
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
    for (const name of Object.keys(SUPABASE_TYPE_ONLY_READBACK_OMISSIONS)) {
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

  {
    const root = temp('knucklebones-production-functions-preview-');
    const removed: string[] = [];
    const { events, runner } = makeRunner();
    const result = await rolloutProductionFunctions({
      apply: false,
      runner,
      cli: CLI,
      nodeVersion: '24.8.0',
      createTemp: () => root,
      removeTemp: value => { removed.push(value); rmSync(value, { recursive: true, force: true }); },
      readProduction: async () => assert.fail('preview performed a production read'),
      log: () => {},
    });
    assert.deepEqual(result, { applied: false, slugs: FUNCTION_ROLLOUT_SLUGS });
    assert.deepEqual(events, []);
    assert.deepEqual(removed, [root]);
    assert.equal(existsSync(root), false);
  }

  {
    const { events, runner } = makeRunner();
    let created = false;
    await assert.rejects(
      () => rolloutProductionFunctions({
        apply: true,
        optIn: '1',
        runner,
        cli: CLI,
        nodeVersion: '24.8.0',
        readProduction: readyProductionRead(undefined, {
          functions: { function_grants: false },
        }),
        createTemp: () => { created = true; return os.tmpdir(); },
        log: () => {},
      }),
      /function contract.*partial/,
    );
    assert.equal(created, false, 'failed production prerequisite created a temporary project');
    assert.deepEqual(events, [], 'failed production prerequisite reached Supabase function commands');
  }

  {
    const root = temp('knucklebones-production-functions-apply-');
    const removed: string[] = [];
    const { events, readbackRoots, runner } = makeRunner();
    const result = await rolloutProductionFunctions({
      apply: true,
      optIn: '1',
      runner,
      cli: CLI,
      nodeVersion: '24.8.0',
      readProduction: readyProductionRead(events),
      createTemp: () => { events.push('create-temp'); return root; },
      removeTemp: value => { removed.push(value); rmSync(value, { recursive: true, force: true }); },
      log: () => {},
    });
    assert.equal(result.applied, true);
    assert.deepEqual(events, [
      'prerequisite:history',
      'prerequisite:schema',
      'prerequisite:functions',
      'prerequisite:cron',
      'create-temp',
      ...FUNCTION_ROLLOUT_SLUGS.flatMap(slug => [
        `deploy:${slug}`, `list:${slug}`, `download:${slug}`,
      ]),
    ]);
    assert.equal(new Set(readbackRoots).size, FUNCTION_ROLLOUT_SLUGS.length);
    assert.deepEqual(removed, [root]);
    assert.equal(existsSync(root), false);
  }

  {
    const root = temp('knucklebones-production-functions-corrupt-');
    const { events, runner } = makeRunner({ corruptSlug: 'pvp-action' });
    await assert.rejects(
      () => rolloutProductionFunctions({
        apply: true,
        optIn: '1',
        runner,
        cli: CLI,
        nodeVersion: '24.8.0',
        readProduction: readyProductionRead(),
        createTemp: () => root,
        removeTemp: value => rmSync(value, { recursive: true, force: true }),
        log: () => {},
      }),
      /downloaded bytes differ/,
    );
    assert.deepEqual(events, [
      'deploy:pvp-rune-select', 'list:pvp-rune-select', 'download:pvp-rune-select',
      'deploy:pvp-action', 'list:pvp-action', 'download:pvp-action',
    ]);
    assert.equal(events.includes('deploy:pvp-join'), false);
    assert.equal(existsSync(root), false);
  }
} finally {
  cleanupTemps();
}

console.log(JSON.stringify({
  out: { productionFunctionRolloutSafety: true },
  problems: [],
  errs: [],
}, null, 2));
