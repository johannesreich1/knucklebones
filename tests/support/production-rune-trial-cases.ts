// EVERYTHING THE RANKED-RUNES ROLLOUT PLAN PROMISES THAT THE OTHER TWO DO NOT.
//
// Same shape as its two siblings in ./production-identity-cases.ts: the
// production evidence this plan's preflight demands before a single function
// may be deployed, then the guarded flows the driver runs over its slug set.
//
// Unlike those two it still drives that lifecycle through its own makeRunner
// fixture rather than the shared assertPlanRolloutFlows, and deliberately so:
// every call below passes NO `selector`, which is the only coverage that
// DEFAULT_FUNCTION_ROLLOUT is still 'ranked-runes' — the plan a programmatic
// caller gets
// when they name none. assertPlanRolloutFlows always names one.
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import {
  FUNCTION_ROLLOUT_SLUGS,
  RANKED_RUNES_PRODUCTION_PREREQUISITE,
  assertRankedRunesProductionPrerequisite,
  rolloutPlan,
  rolloutProductionFunctions,
} from '../../tools/functions/production-rollout.mjs';
import {
  CLI,
  makeRunner,
  readyProductionRead,
  temp,
} from './production-functions-cases.ts';

export async function assertRankedRunesPlanContract() {
  const plan = rolloutPlan('ranked-runes');
  assert.deepEqual(
    plan.controlFiles.filter((file: string) => file.startsWith('supabase/migrations/')),
    [
      'supabase/migrations/20260825205241_rune_trial_ranked_v2.sql',
      'supabase/migrations/20260830155543_equipped_runes_ranked.sql',
      'supabase/migrations/20260830160000_random_rune_mode.sql',
      'supabase/migrations/20260830182406_ranked_progression_events.sql',
      'supabase/migrations/20260831133000_historical_silver_ranked_runes.sql',
    ],
    'ranked-runes function rollout did not pin its exact ordered migration controls',
  );
  assert.match(RANKED_RUNES_PRODUCTION_PREREQUISITE, /select count\(\*\) = 4/);
  assert.match(RANKED_RUNES_PRODUCTION_PREREQUISITE,
    /version = \$1::text and name = \$2::text/);
  assert.match(RANKED_RUNES_PRODUCTION_PREREQUISITE,
    /version = \$3::text and name = \$4::text/);
  assert.match(RANKED_RUNES_PRODUCTION_PREREQUISITE,
    /version = \$5::text and name = \$6::text/);
  assert.match(RANKED_RUNES_PRODUCTION_PREREQUISITE,
    /version = \$7::text and name = \$8::text/);
  /* What production must already prove before any ranked function is
     deployed: the ordered equipment and progression migrations applied exactly
     once, the Rune Trial foundation remains complete, both final historical-
     SILVER stages agree, and bot seats are fixed, present, and owned. */
  assert.deepEqual(
    await assertRankedRunesProductionPrerequisite(readyProductionRead()),
    {
      migrationHistory: true,
      schemaStage: 3,
      evidence: {
        queueCapabilityConstraint: true,
        matchConstraints: true,
        functionContracts: true,
        functionBodies: true,
        serviceGrants: true,
        helperLockdown: true,
        randomModeColumn: true,
        randomModeConstraint: true,
        randomModeComment: true,
        randomModeGrant: true,
        equipmentIntegrityConstraints: true,
        profileSecurity: true,
        compatibilityTrigger: true,
        compatibilityFunctionContract: true,
        compatibilityFunctionBody: true,
        compatibilityFunctionLockdown: true,
        randomHelperContract: true,
        randomHelperBody: true,
        randomHelperLockdown: true,
        randomStartContract: true,
        randomStartBody: true,
        randomStartGrant: true,
        equipmentRpcContract: true,
        equipmentRpcBody: true,
        equipmentRpcGrant: true,
        historicalSilverPolicy: true,
      },
      data: {
        botCount: 200,
        botsWithRunes: 155,
        botsEquipped: 155,
        botsWithRunesWithoutSeat: 0,
        botsWithoutRunesWithSeat: 0,
        botSeatNotOwned: 0,
        botsRandomMode: 0,
      },
    },
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, { history: false }),
    ),
    /migrations must be exactly/,
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, { schema: { policies: false } }),
    ),
    /security boundary.*partial/,
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, { functions: { function_bodies: false } }),
    ),
    /function contract.*partial/,
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, { job: { cron_job_contract: false } }),
    ),
    /cron job.*partial/,
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, { schema: { cron_extension: false } }),
    ),
    /reviewed pg_cron extension/,
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, { equipped: { helper_lockdown: false } }),
    ),
    /Equipped-ranked.*partial/,
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, { equipped: { random_start_body: false } }),
    ),
    /Equipped-ranked.*partial/,
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, {
        equipped: { historical_silver_policy: false },
      }),
    ),
    /out of order/,
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, {
        progression: { historical_rune_comments: false },
      }),
    ),
    /Ranked-progression.*partial/,
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, {
        bots: { bots_equipped: 154, bots_with_runes_without_seat: 1 },
      }),
    ),
    /missing, unowned, or attached without inventory/,
  );
  await assert.rejects(
    () => assertRankedRunesProductionPrerequisite(
      readyProductionRead(undefined, { bots: { bots_random_mode: 1 } }),
    ),
    /random mode is not allowed for bots/,
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
      selector: 'ranked-runes',
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
      'prerequisite:ranked-history',
      'prerequisite:schema',
      'prerequisite:functions',
      'prerequisite:cron',
      'prerequisite:equipped-schema',
      'prerequisite:progression-schema',
      'prerequisite:bot-data',
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
