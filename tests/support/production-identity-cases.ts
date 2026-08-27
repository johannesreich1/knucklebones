// The two guarded rollouts built on the Apple/Game Center database surface:
// identity-hardening, and game-center — which carries gc-auth, the auth
// boundary, and carries nothing else.
//
// What is here is what each plan promises that the OTHER one does not: the
// catalog stages its preflight accepts, the functions it is allowed to carry,
// and its auth posture. The guarded lifecycle both share is one implementation
// in ./production-plan-cases.ts, and both contracts end by running it.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { APPLE_GAME_CENTER_SCHEMA } from '../../tools/database/production-rollout.mjs';
import {
  FUNCTION_DEPLOY_OPT_IN,
  GAME_CENTER_FUNCTION_DEPLOY_OPT_IN,
  GAME_CENTER_ROLLOUT_SELECTOR,
  GAME_CENTER_ROLLOUT_SLUGS,
  IDENTITY_FUNCTION_DEPLOY_OPT_IN,
  IDENTITY_ROLLOUT_SLUGS,
  assertActiveFunctionMetadata,
  assertAppleIdentityProductionPrerequisite,
  assertGameCenterProductionPrerequisite,
  rolloutProductionFunctions,
  supabaseReadbackOmissionPaths,
} from '../../tools/functions/production-rollout.mjs';
import { CLI, metadata, temp } from './production-functions-cases.ts';
import {
  assertPlanRolloutFlows,
  configuredVerifyJwt,
  makePlanRunner,
  plansCarrying,
  verifyJwt,
} from './production-plan-cases.ts';

type Plan = { optIn: string; selector: string; slugs: readonly string[] };

/**
 * A production reader for the Apple/Game Center prerequisite. The default row
 * is the fully applied lifecycle including account-delete's unstage RPC
 * (stage 4); overrides express every partial state worth failing on.
 */
export function appleIdentityRead(
  events?: string[],
  overrides: Record<string, unknown> = {},
) {
  const row = {
    game_center_table: true,
    game_center_service_grant: true,
    apple_credential_table: true,
    apple_credential_functions: true,
    apple_credential_function_bodies: true,
    apple_credential_grants: true,
    apple_unstage_function: true,
    apple_unstage_function_present: true,
    ...overrides,
  };
  return async (query: string, parameters: unknown[] = []) => {
    assert.equal(query, APPLE_GAME_CENTER_SCHEMA, 'identity rollout read an unreviewed query');
    assert.deepEqual(parameters, []);
    events?.push('prerequisite:apple');
    return [row];
  };
}

/**
 * Everything the identity-hardening plan promises: the exported constants it is
 * built from, the auth posture supabase/config.toml commits to (including the
 * cron worker that must stay JWT-less), the Apple credential lifecycle stages
 * its preflight accepts and rejects, and then the full guarded lifecycle.
 */
export async function assertIdentityPlanContract(plan: Plan) {
  assert.equal(plan.optIn, IDENTITY_FUNCTION_DEPLOY_OPT_IN);
  assert.equal(plan.slugs, IDENTITY_ROLLOUT_SLUGS);
  assert.deepEqual(
    Object.fromEntries(plan.slugs.map(slug => [slug, verifyJwt[slug]])),
    configuredVerifyJwt(plan.slugs),
    'the rollout asserts an auth posture supabase/config.toml does not commit to',
  );
  assert.equal(assertActiveFunctionMetadata(
    JSON.stringify([metadata('apple-revocation-retry', { verify_jwt: false })]),
    'apple-revocation-retry',
  ).version, 7);
  assert.throws(
    () => assertActiveFunctionMetadata(
      JSON.stringify([metadata('apple-revocation-retry')]),
      'apple-revocation-retry',
    ),
    /verify_jwt=false/,
    'a cron worker deployed behind a user JWT was accepted',
  );

  // Stage 4 is the credential lifecycle plus account-delete's unstage RPC;
  // stage 3 is the lifecycle alone. Both run these functions; a partial apply
  // of either must not.
  const staged = { apple_unstage_function: false, apple_unstage_function_present: false };
  assert.equal(
    (await assertAppleIdentityProductionPrerequisite(appleIdentityRead())).schemaStage, 4,
  );
  assert.equal(
    (await assertAppleIdentityProductionPrerequisite(
      appleIdentityRead(undefined, staged),
    )).schemaStage, 3,
  );
  await assert.rejects(
    () => assertAppleIdentityProductionPrerequisite(
      appleIdentityRead(undefined, { ...staged, apple_credential_grants: false }),
    ),
    /partial or out of order/,
  );

  return assertPlanRolloutFlows(plan, {
    makeReadProduction: events => appleIdentityRead(events),
    prerequisiteEvents: ['prerequisite:apple'],
    foreignOptIns: [FUNCTION_DEPLOY_OPT_IN, GAME_CENTER_FUNCTION_DEPLOY_OPT_IN],
    corruptSlug: 'apple-token-register',
  });
}

/* The Apple/Game Center catalog stages, as rows: stage 2 is the Game Center
   mapping and its service grants alone — everything gc-auth touches, and
   nothing the identity set needs. */
const STAGE_2_ROW = Object.freeze({
  apple_credential_table: false,
  apple_credential_functions: false,
  apple_credential_function_bodies: false,
  apple_credential_grants: false,
  apple_unstage_function: false,
  apple_unstage_function_present: false,
});
const STAGE_1_ROW = Object.freeze({ ...STAGE_2_ROW, game_center_service_grant: false });
const STAGE_0_ROW = Object.freeze({ ...STAGE_1_ROW, game_center_table: false });

/**
 * Everything the game-center plan promises. gc-auth is the auth boundary, so
 * the contract is deliberately narrower and stricter than the identity set's:
 * it deploys alone, on its own opt-in, behind its own database gate, and its
 * JWT-less posture is the one supabase/config.toml commits to.
 */
export async function assertGameCenterPlanContract(plan: Plan) {
  assert.equal(plan.selector, GAME_CENTER_ROLLOUT_SELECTOR);
  assert.equal(plan.optIn, GAME_CENTER_FUNCTION_DEPLOY_OPT_IN);
  assert.equal(plan.optIn, 'KB_ALLOW_PRODUCTION_GAME_CENTER_FUNCTIONS');
  assert.equal(plan.slugs, GAME_CENTER_ROLLOUT_SLUGS);
  assert.deepEqual([...plan.slugs], ['gc-auth'], 'the auth boundary must deploy alone');
  assert.deepEqual(plansCarrying('gc-auth'), [GAME_CENTER_ROLLOUT_SELECTOR],
    'gc-auth must belong to exactly one plan, and that plan must be game-center');
  assert.deepEqual(supabaseReadbackOmissionPaths('gc-auth'), [],
    'the auth boundary must read back complete; nothing in its closure may be omitted');
  assert.deepEqual(
    Object.fromEntries(plan.slugs.map(slug => [slug, verifyJwt[slug]])),
    configuredVerifyJwt(plan.slugs),
    'the rollout asserts an auth posture supabase/config.toml does not commit to',
  );
  assert.equal(verifyJwt['gc-auth'], false, 'gc-auth may not require the session it issues');
  assert.equal(assertActiveFunctionMetadata(
    JSON.stringify([metadata('gc-auth', { verify_jwt: false })]),
    'gc-auth',
  ).version, 7);
  assert.throws(
    () => assertActiveFunctionMetadata(JSON.stringify([metadata('gc-auth')]), 'gc-auth'),
    /verify_jwt=false/,
    'gc-auth was accepted with a posture supabase/config.toml does not declare',
  );

  /* gc-auth reads and writes public.game_center_ids and nothing else, so its
     gate is the mapping plus its service grants (stage 2) and every additive
     stage above it — and that gate is genuinely its own: the identity set's
     prerequisite rejects the very stage this one accepts. */
  for (const stage of [2, 3, 4] as const) {
    const overrides = stage === 2 ? STAGE_2_ROW
      : stage === 3 ? { apple_unstage_function: false, apple_unstage_function_present: false }
        : {};
    assert.equal(
      (await assertGameCenterProductionPrerequisite(
        appleIdentityRead(undefined, overrides),
      )).schemaStage,
      stage,
    );
  }
  for (const [stage, overrides] of [[1, STAGE_1_ROW], [0, STAGE_0_ROW]] as const) {
    await assert.rejects(
      () => assertGameCenterProductionPrerequisite(appleIdentityRead(undefined, overrides)),
      new RegExp(`Game Center identity mapping must be fully applied at stage 2 or 3 or 4 \\(found stage ${stage}\\)`),
      `gc-auth accepted a production without the mapping it writes (stage ${stage})`,
    );
  }
  await assert.rejects(
    () => assertAppleIdentityProductionPrerequisite(appleIdentityRead(undefined, STAGE_2_ROW)),
    /Apple identity credential lifecycle must be fully applied at stage 3 or 4/,
    'the game-center gate is the identity gate wearing a different name',
  );

  /* gc-auth's actual state before its first rollout: production has never run
     it. A readable listing that simply has no such row must report that, not
     blame the read — an operator who cannot tell "never deployed" from "I could
     not look" has no way to know whether this apply is the first one. */
  const firstRoot = temp(`knucklebones-production-functions-${plan.selector}-first-`);
  const first = makePlanRunner(plan);
  const listed = first.runner.capture.bind(first.runner);
  first.runner.capture = (command: string, args: string[]) => (
    args[0] === 'functions' && args[1] === 'list' ? '[]' : listed(command, args)
  );
  const lines: string[] = [];
  assert.deepEqual(
    await rolloutProductionFunctions({
      selector: plan.selector,
      cli: CLI,
      nodeVersion: '24.8.0',
      apply: false,
      runner: first.runner,
      createTemp: () => firstRoot,
      removeTemp: (value: string) => rmSync(value, { recursive: true, force: true }),
      readProduction: async () => assert.fail('preview performed a production read'),
      log: (message: string) => lines.push(message),
    }),
    {
      applied: false,
      selector: plan.selector,
      slugs: plan.slugs,
      current: [{ slug: 'gc-auth', version: null }],
    },
  );
  assert.match(lines[0], /would deploy gc-auth \(\d+ files, not deployed yet\)/);
  assert.equal(lines.some(line => /unavailable/.test(line)), false,
    'a readable listing with no gc-auth row was reported as an unreadable listing');
  assert.ok(lines.some(line => line.includes(GAME_CENTER_FUNCTION_DEPLOY_OPT_IN)),
    'preview did not name the opt-in this plan actually requires');

  return assertPlanRolloutFlows(plan, {
    makeReadProduction: events => appleIdentityRead(events),
    prerequisiteEvents: ['prerequisite:apple'],
    foreignOptIns: [FUNCTION_DEPLOY_OPT_IN, IDENTITY_FUNCTION_DEPLOY_OPT_IN],
    corruptSlug: 'gc-auth',
  });
}
