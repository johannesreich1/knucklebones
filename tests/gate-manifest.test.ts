import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  CI_SHARDS,
  CI_SHARD_NAMES,
  GATE_SUITES,
  createGatePlan,
  executeGatePlan,
  parseGateArgs,
  validateGateManifest,
} from './support/gate-manifest.mjs';

const problems: string[] = [];
const errs: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) problems.push(message);
};
const expectInvalid = (
  label: string,
  suites: typeof GATE_SUITES,
  shards: Record<string, readonly string[]>,
  pattern: RegExp,
) => {
  try {
    validateGateManifest(suites, shards as typeof CI_SHARDS);
    problems.push(`${label} was accepted`);
  } catch (error) {
    check(pattern.test(String(error)), `${label} failed for the wrong reason: ${error}`);
  }
};
const mutableShards = () => Object.fromEntries(Object.entries(CI_SHARDS)
  .map(([name, suites]) => [name, [...suites]]));

try {
  validateGateManifest();
  check(new Set(GATE_SUITES.map(suite => suite.name)).size === GATE_SUITES.length,
    'the real manifest contains duplicate suite ids');
  check(GATE_SUITES.every(suite => existsSync(suite.file)),
    'the real manifest references a missing suite file');
  check(GATE_SUITES.every(suite => ['node', 'suite', 'benchmark'].includes(suite.runner)),
    'the real manifest contains an unknown runner');

  const full = createGatePlan({});
  check(full.pooled.length + full.final.length === GATE_SUITES.length,
    'the complete plan dropped a registered suite');
  check(JSON.stringify([...full.pooled, ...full.final].map(suite => suite.name))
    === JSON.stringify(GATE_SUITES.map(suite => suite.name)),
  'the complete plan changed the registered suite identities or order');
  check(full.final.length === 1 && full.final[0].name === 'pwa-update',
    'the complete plan does not isolate pwa-update as its final batch');
  for (const shard of CI_SHARD_NAMES) {
    const selected = createGatePlan({ ciShard: shard });
    const actual = [...selected.pooled, ...selected.final].map(suite => suite.name);
    check(JSON.stringify(actual) === JSON.stringify(CI_SHARDS[shard as keyof typeof CI_SHARDS]),
      `${shard} selection changed its declared order or membership`);
    check(selected.final.length === 0 || selected.final[0].name === 'pwa-update',
      `${shard} selected a non-update suite as exclusive-final`);
  }
  const focused = createGatePlan({
    suiteNames: ['production-test-data', 'architecture', 'pwa-update'],
  });
  assert.deepEqual(focused.pooled.map((suite: { name: string }) => suite.name),
    ['production-test-data', 'architecture']);
  assert.deepEqual(focused.final.map((suite: { name: string }) => suite.name), ['pwa-update']);
  assert.throws(() => createGatePlan({ suiteNames: ['not-a-suite'] }), /Unknown gate suite/);
  assert.throws(() => createGatePlan({ suiteNames: ['architecture', 'architecture'] }),
    /Duplicate gate suite/);

  const duplicateId = [...GATE_SUITES, GATE_SUITES[0]];
  expectInvalid('duplicate suite id', duplicateId as typeof GATE_SUITES,
    CI_SHARDS, /duplicate suite id/);

  const duplicateInvocation = {
    ...GATE_SUITES[0],
    name: 'duplicate-invocation-probe',
  };
  const invocationShards = mutableShards();
  invocationShards['ci-1'].push(duplicateInvocation.name);
  expectInvalid('duplicate invocation', [...GATE_SUITES, duplicateInvocation] as typeof GATE_SUITES,
    invocationShards, /duplicate invocation/);

  const missingFile = GATE_SUITES.map(suite => suite.name === 'duo-pass-and-play'
    ? { ...suite, file: 'tests/definitely-missing-gate-probe.mjs' } : suite);
  expectInvalid('missing suite file', missingFile as typeof GATE_SUITES,
    CI_SHARDS, /references missing file/);
  assert.throws(
    () => createGatePlan(
      { suiteNames: ['architecture'] },
      missingFile as typeof GATE_SUITES,
      CI_SHARDS,
    ),
    /references missing file/,
    'focused selection concealed an invalid unselected manifest owner',
  );

  const unknownShards = mutableShards();
  unknownShards['ci-1'].push('unknown-probe');
  expectInvalid('unknown suite assignment', GATE_SUITES, unknownShards, /unknown suite/);

  const missingShards = mutableShards();
  missingShards['ci-1'] = missingShards['ci-1'].slice(1);
  expectInvalid('missing suite assignment', GATE_SUITES, missingShards, /belongs to 0 CI shards/);

  const repeatedShards = mutableShards();
  repeatedShards['ci-2'].push(CI_SHARDS['ci-1'][0]);
  expectInvalid('repeated suite assignment', GATE_SUITES, repeatedShards, /belongs to 2 CI shards/);

  const noFinal = GATE_SUITES.map(suite => suite.name === 'pwa-update'
    ? { ...suite, exclusiveFinal: false } : suite);
  expectInvalid('missing exclusive-final update', noFinal as typeof GATE_SUITES,
    CI_SHARDS, /one server-backed exclusive-final/);
  const unservedFinal = GATE_SUITES.map(suite => suite.name === 'pwa-update'
    ? { ...suite, needsServer: false } : suite);
  expectInvalid('unserved exclusive-final update', unservedFinal as typeof GATE_SUITES,
    CI_SHARDS, /one server-backed exclusive-final/);
  const secondFinal = GATE_SUITES.map(suite => suite.name === 'duo-pass-and-play'
    ? { ...suite, exclusiveFinal: true } : suite);
  expectInvalid('second exclusive-final suite', secondFinal as typeof GATE_SUITES,
    CI_SHARDS, /one server-backed exclusive-final/);

  assert.deepEqual(parseGateArgs([], {}),
    { jobs: 4, ciShard: undefined, suiteNames: undefined });
  assert.deepEqual(parseGateArgs([], { CI: 'true' }),
    { jobs: 1, ciShard: undefined, suiteNames: undefined });
  assert.deepEqual(parseGateArgs(['--jobs', '3', '--ci-shard', 'ci-2'], {}),
    { jobs: 3, ciShard: 'ci-2', suiteNames: undefined });
  assert.deepEqual(parseGateArgs(['--jobs', '3'], { KB_JOBS: 'invalid' }),
    { jobs: 3, ciShard: undefined, suiteNames: undefined });
  assert.deepEqual(parseGateArgs(['--ci-shard', 'ci-4', '--jobs', '2'], {}),
    { jobs: 2, ciShard: 'ci-4', suiteNames: undefined });
  assert.deepEqual(parseGateArgs([
    '--suite', 'production-test-data', '--jobs', '2', '--suite', 'typecheck-tests',
  ], {}), {
    jobs: 2,
    ciShard: undefined,
    suiteNames: ['production-test-data', 'typecheck-tests'],
  });
  for (const args of [
    ['--jobs'], ['--jobs', '0'], ['--jobs', '2', '--jobs', '3'],
    ['--ci-shard'], ['--ci-shard', 'nope'], ['--ci-shard', 'ci-1', '--ci-shard', 'ci-2'],
    ['--suite'], ['--suite', 'not-a-suite'],
    ['--suite', 'architecture', '--suite', 'architecture'],
    ['--ci-shard', 'ci-1', '--suite', 'architecture'],
    ['stray'],
  ]) {
    assert.throws(() => parseGateArgs(args, {}), /Usage:/,
      `invalid CLI was accepted: ${args.join(' ')}`);
  }

  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const matrix = workflow.match(/shard:\s*\[([^\]]+)\]/)?.[1]
    .split(',').map(value => value.trim()) ?? [];
  check(JSON.stringify(matrix) === JSON.stringify(CI_SHARD_NAMES),
    'CI workflow shard matrix differs from the coverage-checked manifest');
  check(/\n  manifest:\n[\s\S]*?tests\/gate-manifest\.test\.ts/.test(workflow)
    && /\n  test_shard:\n[\s\S]*?needs:\s*manifest/.test(workflow),
  'CI shards are not guarded by the independent manifest preflight');
  check(/\n  test:\n[\s\S]*?name:\s*test\n[\s\S]*?if:\s*\$\{\{ !cancelled\(\) \}\}\n[\s\S]*?needs:\s*\[manifest, test_shard\]/.test(workflow),
    'CI lost the stable aggregate test check used by branch protection');
  check(/fail-fast:\s*false/.test(workflow)
    && /npm test -- --ci-shard "\$\{\{ matrix\.shard \}\}"/.test(workflow),
  'CI does not run every selected manifest shard without fail-fast cancellation');
  check(workflow.includes('group: ${{ github.workflow }}-${{ github.ref }}')
    && /concurrency:\s*\n\s*group:[^\n]+\n\s*cancel-in-progress:\s*true/.test(workflow),
  'CI does not cancel a superseded run for the same branch or pull request');

  const invalidCli = spawnSync(process.execPath, ['tests/run-all.mjs', '--not-a-gate-option'], {
    encoding: 'utf8',
  });
  check(invalidCli.status === 2 && /Unknown gate option/.test(invalidCli.stderr)
    && !/Building|gate complete/.test(invalidCli.stdout + invalidCli.stderr),
  'the public gate CLI did not reject an invalid option before lock/build work');
  const invalidSuiteCli = spawnSync(process.execPath, [
    'tests/run-all.mjs', '--suite', 'not-a-suite',
  ], { encoding: 'utf8' });
  check(invalidSuiteCli.status === 2 && /Unknown gate suite/.test(invalidSuiteCli.stderr)
    && !/Building|gate complete/.test(invalidSuiteCli.stdout + invalidSuiteCli.stderr),
  'the public gate CLI did not reject an unknown focused suite before lock/build work');

  let active = 0;
  const events: string[] = [];
  await executeGatePlan({
    pooled: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    final: [{ name: 'pwa-update', exclusiveFinal: true }],
  }, async (suite: { name: string; exclusiveFinal?: boolean }) => {
    if (suite.exclusiveFinal) {
      check(active === 0, 'pwa-update started while a pooled suite was active');
      events.push(suite.name);
      return;
    }
    active++;
    events.push(`start-${suite.name}`);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    events.push(`end-${suite.name}`);
  }, 2);
  check(events.at(-1) === 'pwa-update', 'a suite started after the exclusive-final update');
} catch (error) {
  errs.push(error instanceof Error ? error.stack ?? error.message : String(error));
}

console.log(JSON.stringify({
  suites: GATE_SUITES.length,
  shards: CI_SHARD_NAMES,
  problems,
  errs,
}, null, 2));

process.exitCode = problems.length || errs.length ? 1 : 0;
