// EVERYTHING THE RUNE TRIAL ROLLOUT PLAN PROMISES THAT THE OTHER TWO DO NOT.
//
// Same shape as its two siblings in ./production-identity-cases.ts: the
// production evidence this plan's preflight demands before a single function
// may be deployed, then the guarded flows the driver runs over its slug set.
//
// Unlike those two it still drives that lifecycle through its own makeRunner
// fixture rather than the shared assertPlanRolloutFlows, and deliberately so:
// every call below passes NO `selector`, which is the only coverage that
// DEFAULT_FUNCTION_ROLLOUT is still 'rune-trial' — the plan an operator gets
// when they name none. assertPlanRolloutFlows always names one.
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import {
  FUNCTION_ROLLOUT_SLUGS,
  assertRuneTrialProductionPrerequisite,
  rolloutProductionFunctions,
} from '../../tools/functions/production-rollout.mjs';
import {
  CLI,
  makeRunner,
  prerequisite,
  readyProductionRead,
  temp,
} from './production-functions-cases.ts';

export async function assertRuneTrialPlanContract() {
  /* What production must already prove before any rune-trial function is
     deployed: the pinned migration applied exactly once, and four all-or-
     nothing evidence groups — a partial apply of any one of them is a refusal,
     never a warning. */
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
    assert.deepEqual(result, {
      applied: false,
      selector: 'rune-trial',
      slugs: FUNCTION_ROLLOUT_SLUGS,
      current: FUNCTION_ROLLOUT_SLUGS.map(slug => ({ slug, version: 7 })),
    });
    assert.deepEqual(events, ['list:'], 'preview did more than probe deployed versions');
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
}
