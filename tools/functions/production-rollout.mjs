#!/usr/bin/env node

// Fail-closed Edge Function rollouts — one guarded plan per deployable set.
//
// The repository's raw function directories are not deployable by the CLI:
// their synthetic ./core imports resolve to root src/. Materialize the exact
// normalized closure that tools/fnfiles.mjs gates, deploy one function at a
// time through the pinned API bundler, then download and compare every runtime
// byte. Supabase omits known per-function type-only inputs from readback; their
// expected source hashes are pinned per plan so a future runtime change fails
// closed.
//
// Three plans exist and they never mix:
//   ranked-runes        the ranked PvP set, gated on both ranked-rune migrations
//   identity-hardening  the account identity set, gated on the Apple/Game
//                       Center credential lifecycle those functions call
//   game-center         gc-auth alone, gated on the Game Center identity
//                       mapping it reads and writes
//
// Each plan carries its own environment opt-in, its own database prerequisite,
// its own slug order, and its own readback omissions, so the opt-in for one can
// never deploy another:
//
//   mise exec -- npm run functions:production:ranked-runes
//   mise exec -- npm run functions:production:identity
//   mise exec -- npm run functions:production:game-center
//
// gc-auth deploys ALONE — see GAME_CENTER_ROLLOUT_SLUGS.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPABASE_PROJECT_REF } from '../../src/config.ts';
import { createCliRunner, readJson } from '../database/cli-runner.mjs';
import {
  auditAppleGameCenter,
  auditEquippedRanked,
  auditRuneTrial,
} from '../database/production-rollout.mjs';
import { productionRead } from '../debug/production-read.mjs';
import { fnFiles, uploadPayload } from '../fnfiles.mjs';

export const FUNCTION_ROLLOUT_SLUGS = Object.freeze([
  'pvp-rune-select',
  'pvp-action',
  'account-delete',
  'pvp-claim',
  'pvp-move',
  'pvp-join',
]);
// Read-only status first, then the write path that stores a revocation
// credential, then the cron worker last: a retry sweep can never run against a
// half-updated registration path.
export const IDENTITY_ROLLOUT_SLUGS = Object.freeze([
  'identity-status',
  'apple-token-register',
  'apple-revocation-retry',
]);
/*
 * gc-auth deploys ALONE, and that is the point.
 *
 * gc-auth is the auth boundary itself (`verify_jwt = false`): a bad deploy is
 * not a degraded feature, it is an open door. So it gets a plan of its own —
 * its own selector, its own environment opt-in, its own database prerequisite —
 * and no other plan can sweep it in. The guard below refuses to load a plan set
 * in which gc-auth travels with another function or is claimed by anything but
 * the game-center plan, so deploying the auth boundary is always one explicit,
 * single act rather than a side effect of shipping an identity feature.
 *
 * The signed-device pass in docs/IDENTITY.md is gc-auth's ACCEPTANCE step,
 * immediately after this plan applies — not a precondition. It cannot be a
 * precondition: the device exercises the *deployed* function, so demanding the
 * pass first is a requirement no rollout could ever satisfy.
 */
export const GAME_CENTER_ROLLOUT_SELECTOR = 'game-center';
export const GAME_CENTER_ROLLOUT_SLUGS = Object.freeze(['gc-auth']);
export const FUNCTION_CLI_VERSION = '2.115.0';
export const FUNCTION_DEPLOY_OPT_IN = 'KB_ALLOW_PRODUCTION_RANKED_RUNE_FUNCTIONS';
export const IDENTITY_FUNCTION_DEPLOY_OPT_IN = 'KB_ALLOW_PRODUCTION_IDENTITY_FUNCTIONS';
export const GAME_CENTER_FUNCTION_DEPLOY_OPT_IN = 'KB_ALLOW_PRODUCTION_GAME_CENTER_FUNCTIONS';
export const PRODUCTION_PROJECT_REF = 'euzjcejbkxvqfrttgaxu';
export const RUNE_TRIAL_MIGRATION_VERSION = '20260825205241';
export const RUNE_TRIAL_MIGRATION_NAME = 'rune_trial_ranked_v2';
export const RANKED_RUNES_MIGRATION_VERSION = '20260830155543';
export const RANKED_RUNES_MIGRATION_NAME = 'equipped_runes_ranked';
export const RANDOM_RUNE_MODE_MIGRATION_VERSION = '20260830160000';
export const RANDOM_RUNE_MODE_MIGRATION_NAME = 'random_rune_mode';
export const SUPABASE_READBACK_OMISSION_HASHES = Object.freeze({
  '*:core/ranked-action-types.ts': 'add8dc5a605e30a7ad0be9a30655863c960acf25769f1a57412b15e329c99420',
  // Re-pinned 2026-08-29 for SpellSpec.drawsFromSupply — the flag ranked reads
  // to decide whether it may paint a cast at tap time. Still two interfaces
  // and no runtime export, so Supabase keeps pruning it from the readback.
  '*:core/spell-types.ts': 'e0e61775ffd9f33e163ff13c16602a3ab397fbaeba6c5caa302a956ab879f367',
  // Re-pinned 2026-08-30 for nullable equipped-rune snapshots on MatchRow.
  'account-delete:_shared/types.ts': 'aff87e0c31d8e66606763525936eea845b66a2b837bf27fc1cd670b5fbe69d86',
});
// Every identity closure file carries runtime code (tools/fnfiles.mjs prints
// them), so Supabase prunes nothing on readback and an absent path is drift.
export const IDENTITY_READBACK_OMISSION_HASHES = Object.freeze({});
// gc-auth's closure is index/handler/operation/verify plus _shared/http.ts and
// _shared/secret-equal.ts — runtime code end to end, with no type-only input
// for Supabase to prune. An absent readback path is therefore drift, not a
// bundler artifact, and the auth boundary is exactly where that must fail.
export const GAME_CENTER_READBACK_OMISSION_HASHES = Object.freeze({});
/*
 * The reviewed auth posture of every deployable function, mirroring
 * supabase/config.toml — which is a rollout control file, and which
 * tests/production-functions.test.ts compares against this map. The rollout
 * writes these values into the materialized project AND re-asserts them on the
 * deployed row, so no plan can quietly flip a function's auth boundary.
 */
export const FUNCTION_VERIFY_JWT = Object.freeze({
  'pvp-rune-select': true,
  'pvp-action': true,
  'account-delete': true,
  'pvp-claim': true,
  'pvp-move': true,
  'pvp-join': true,
  'identity-status': true,
  'apple-token-register': true,
  // Invoked by cron with a constant-time shared secret, never a user JWT.
  'apple-revocation-retry': false,
  // The auth boundary: it is how a player gets a session in the first place,
  // so it cannot require one. Its own gate is the Game Center signature plus
  // the gateway's shared GC_AUTH_ORIGIN_SECRET, not Supabase's JWT check.
  'gc-auth': false,
});

const REQUIRED_NODE_MAJOR = 24;
const TEMP_PREFIX = 'knucklebones-production-functions-';
const SHARED_CONTROL_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'supabase/config.toml',
  'tools/database/cli-runner.mjs',
  'tools/database/production-rollout-core.mjs',
  'tools/database/production-rollout.mjs',
  'tools/debug/production-read.mjs',
  'tools/fnfiles.mjs',
  'tools/functions/production-rollout.mjs',
]);
export const RUNE_TRIAL_PREREQUISITE_FIELDS = Object.freeze([
  'profileProgression',
  'matchProtocol',
  'queueProtocol',
  'playerRunesTable',
  'matchActionsTable',
  'privateTables',
  'indexes',
  'policies',
  'tableGrants',
  'privateTablesLocked',
  'functionContracts',
  'functionBodies',
  'functionGrants',
  'realtimePublication',
  'cronJob',
  'cronJobContract',
]);
export const RUNE_TRIAL_PRODUCTION_PREREQUISITE = String.raw`
select count(*) = 1 and bool_and(name = $2::text) as migration_history
  from supabase_migrations.schema_migrations
 where version = $1::text;
`;
export const RANKED_RUNES_PRODUCTION_PREREQUISITE = String.raw`
-- ranked-runes forward-migration identity
select count(*) = 2
       and count(*) filter (
         where version = $1::text and name = $2::text
       ) = 1
       and count(*) filter (
         where version = $3::text and name = $4::text
       ) = 1 as migration_history
  from supabase_migrations.schema_migrations
 where version in ($1::text, $3::text);
`;
// identity-status, apple-token-register and apple-revocation-retry call
// apple_revocation_ready, store_apple_revocation_credential,
// claim_apple_revocations and finish_apple_revocation, and read
// public.game_center_ids. Stage 3 is the credential lifecycle fully applied;
// stage 4 adds account-delete's unstage RPC on top and is equally valid here.
export const APPLE_IDENTITY_PREREQUISITE_STAGES = Object.freeze([3, 4]);
// gc-auth reads and writes exactly one table, public.game_center_ids, through
// the service role. Stage 2 is that table plus its service grants — the whole
// durable contract gc-auth has. Stages 3 and 4 add the Apple credential
// lifecycle on top and are strictly additive, so they run it just as well.
export const GAME_CENTER_PREREQUISITE_STAGES = Object.freeze([2, 3, 4]);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const CLI = path.join(
  REPOSITORY_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
);

const fail = message => { throw new Error(message); };
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

export function requireNode24(version = process.versions.node) {
  if (Number.parseInt(version.split('.')[0], 10) !== REQUIRED_NODE_MAJOR) {
    fail(`Node 24 is required (received ${version}); run this helper through mise exec --.`);
  }
}

export function assertFunctionDeployOptIn(apply, value, optIn = FUNCTION_DEPLOY_OPT_IN) {
  if (typeof apply !== 'boolean') fail('Function rollout apply intent must be boolean.');
  if (apply && value !== '1') {
    fail(`Production deployment requires ${optIn}=1 and --apply.`);
  }
  return apply;
}

export async function assertRuneTrialProductionPrerequisite(
  readProduction = productionRead,
) {
  if (typeof readProduction !== 'function') {
    fail('Rune Trial production prerequisite reader must be a function.');
  }
  const historyRows = await readProduction(RUNE_TRIAL_PRODUCTION_PREREQUISITE, [
    RUNE_TRIAL_MIGRATION_VERSION,
    RUNE_TRIAL_MIGRATION_NAME,
  ]);
  if (!Array.isArray(historyRows) || historyRows.length !== 1
      || !isObject(historyRows[0])
      || Object.keys(historyRows[0]).length !== 1
      || historyRows[0].migration_history !== true) {
    fail(`Production migration must be exactly ${RUNE_TRIAL_MIGRATION_VERSION}/${RUNE_TRIAL_MIGRATION_NAME}.`);
  }

  // Reuse the database rollout's one exact durable contract. Its separate
  // post-apply data audit is intentionally omitted: new_tables_empty is a
  // one-time migration invariant that becomes false after legitimate play.
  const { evidence, schemaStage } = await auditRuneTrial(readProduction);
  if (schemaStage !== 1) {
    fail('Production Rune Trial schema prerequisite must be fully applied at stage 1.');
  }
  return Object.freeze({ migrationHistory: true, schemaStage, evidence });
}

/**
 * The durable database gate for every ranked Edge Function closure. The
 * ranked-rune audit composes the complete Rune Trial foundation with both
 * ordered forward migrations, exact constraints/triggers/function bodies,
 * ACLs, and bot-seat invariants. Pinning both history identities additionally
 * proves that state arrived through the reviewed migrations rather than an
 * ad-hoc catalog edit.
 */
export async function assertRankedRunesProductionPrerequisite(
  readProduction = productionRead,
) {
  if (typeof readProduction !== 'function') {
    fail('Ranked-runes production prerequisite reader must be a function.');
  }
  const historyRows = await readProduction(RANKED_RUNES_PRODUCTION_PREREQUISITE, [
    RANKED_RUNES_MIGRATION_VERSION,
    RANKED_RUNES_MIGRATION_NAME,
    RANDOM_RUNE_MODE_MIGRATION_VERSION,
    RANDOM_RUNE_MODE_MIGRATION_NAME,
  ]);
  if (!Array.isArray(historyRows) || historyRows.length !== 1
      || !isObject(historyRows[0])
      || Object.keys(historyRows[0]).length !== 1
      || historyRows[0].migration_history !== true) {
    fail('Production migrations must be exactly '
      + `${RANKED_RUNES_MIGRATION_VERSION}/${RANKED_RUNES_MIGRATION_NAME} and `
      + `${RANDOM_RUNE_MODE_MIGRATION_VERSION}/${RANDOM_RUNE_MODE_MIGRATION_NAME}.`);
  }

  const { evidence, schemaStage, data } = await auditEquippedRanked(readProduction);
  if (schemaStage !== 2) {
    fail('Production ranked-runes schema prerequisite must be fully applied at stage 2.');
  }
  return Object.freeze({ migrationHistory: true, schemaStage, evidence, data });
}

/**
 * The Apple/Game Center surface's durable prerequisite. Unlike the Rune Trial
 * plan there is no single migration version to pin: it arrives in four
 * migrations, so the reviewed catalog state — tables, owners, RLS, grants,
 * function contracts and function bodies — is the contract, and the database
 * rollout's existing audit is the one implementation of it. Each plan built on
 * that surface names only the stages that actually run its functions.
 */
async function assertAppleGameCenterStage(readProduction, stages, subject) {
  if (typeof readProduction !== 'function') {
    fail(`${subject} production prerequisite reader must be a function.`);
  }
  const { evidence, schemaStage } = await auditAppleGameCenter(readProduction);
  if (!stages.includes(schemaStage)) {
    fail(`Production ${subject} must be fully applied at stage `
      + `${stages.join(' or ')} (found stage ${schemaStage}).`);
  }
  return Object.freeze({ schemaStage, evidence });
}

export async function assertAppleIdentityProductionPrerequisite(
  readProduction = productionRead,
) {
  return assertAppleGameCenterStage(
    readProduction,
    APPLE_IDENTITY_PREREQUISITE_STAGES,
    'Apple identity credential lifecycle',
  );
}

/**
 * gc-auth's durable prerequisite: the Game Center identity mapping it claims
 * rows in, and the service grants that let it. It deliberately does NOT demand
 * the Apple credential lifecycle — gc-auth never touches those RPCs, and
 * over-gating a boundary deploy on unrelated schema teaches operators to reach
 * for a broader opt-in than the act needs.
 */
export async function assertGameCenterProductionPrerequisite(
  readProduction = productionRead,
) {
  return assertAppleGameCenterStage(
    readProduction,
    GAME_CENTER_PREREQUISITE_STAGES,
    'Game Center identity mapping',
  );
}

export const FUNCTION_ROLLOUT_PLANS = Object.freeze({
  'ranked-runes': Object.freeze({
    selector: 'ranked-runes',
    optIn: FUNCTION_DEPLOY_OPT_IN,
    projectId: 'knucklebones-ranked-runes-function-rollout',
    slugs: FUNCTION_ROLLOUT_SLUGS,
    readbackOmissions: SUPABASE_READBACK_OMISSION_HASHES,
    controlFiles: Object.freeze([
      ...SHARED_CONTROL_FILES,
      'supabase/migrations/20260825205241_rune_trial_ranked_v2.sql',
      'supabase/migrations/20260830155543_equipped_runes_ranked.sql',
      'supabase/migrations/20260830160000_random_rune_mode.sql',
    ]),
    prerequisite: assertRankedRunesProductionPrerequisite,
    notes: Object.freeze([
      `Set ${FUNCTION_DEPLOY_OPT_IN}=1 and pass --apply only after both ranked-runes database migrations are verified at stage 2.`,
    ]),
  }),
  'identity-hardening': Object.freeze({
    selector: 'identity-hardening',
    optIn: IDENTITY_FUNCTION_DEPLOY_OPT_IN,
    projectId: 'knucklebones-identity-function-rollout',
    slugs: IDENTITY_ROLLOUT_SLUGS,
    readbackOmissions: IDENTITY_READBACK_OMISSION_HASHES,
    controlFiles: Object.freeze([
      ...SHARED_CONTROL_FILES,
      'supabase/migrations/20260826153100_game_center_ids.sql',
      'supabase/migrations/20260826153101_game_center_service_grants.sql',
      'supabase/migrations/20260826153102_apple_identity_credentials.sql',
      'supabase/migrations/20260826181000_apple_revocation_unstage.sql',
    ]),
    prerequisite: assertAppleIdentityProductionPrerequisite,
    notes: Object.freeze([
      `Set ${IDENTITY_FUNCTION_DEPLOY_OPT_IN}=1 and pass --apply only after the Apple/Game Center database rollout is verified.`,
      `gc-auth is deliberately not in this plan: the auth boundary deploys alone through ${GAME_CENTER_ROLLOUT_SELECTOR}.`,
    ]),
  }),
  [GAME_CENTER_ROLLOUT_SELECTOR]: Object.freeze({
    selector: GAME_CENTER_ROLLOUT_SELECTOR,
    optIn: GAME_CENTER_FUNCTION_DEPLOY_OPT_IN,
    projectId: 'knucklebones-game-center-function-rollout',
    slugs: GAME_CENTER_ROLLOUT_SLUGS,
    readbackOmissions: GAME_CENTER_READBACK_OMISSION_HASHES,
    controlFiles: Object.freeze([
      ...SHARED_CONTROL_FILES,
      'supabase/migrations/20260826153100_game_center_ids.sql',
      'supabase/migrations/20260826153101_game_center_service_grants.sql',
    ]),
    prerequisite: assertGameCenterProductionPrerequisite,
    notes: Object.freeze([
      `Set ${GAME_CENTER_FUNCTION_DEPLOY_OPT_IN}=1 and pass --apply only after the Game Center identity mapping is verified in production.`,
      'gc-auth answers unauthenticated requests (verify_jwt=false). Deploying it is its own act, and it deploys nothing else.',
      'Acceptance runs immediately AFTER this deploy: exercise launch restore, attach, account switching, Apple repair, deletion and revocation on a signed device (docs/IDENTITY.md). The device exercises the deployed function, so that pass cannot precede this step.',
    ]),
  }),
});
// The default for programmatic callers only. The CLI below refuses to run
// without an explicit selector, so no operator ever deploys a plan by omission.
export const DEFAULT_FUNCTION_ROLLOUT = 'ranked-runes';

// One slug belongs to exactly one plan, so every per-slug rule below reads its
// plan rather than taking a selector it could be handed wrongly. Building the
// index at import time also fails a plan that claims another plan's slug, one
// whose auth posture was never reviewed, or two plans sharing one opt-in —
// which would silently make a single exported variable authorize both sets.
const PLAN_BY_SLUG = new Map();
const CLAIMED_OPT_INS = new Set();
for (const plan of Object.values(FUNCTION_ROLLOUT_PLANS)) {
  if (CLAIMED_OPT_INS.has(plan.optIn)) {
    fail(`Rollout opt-in ${plan.optIn} is claimed by two plans.`);
  }
  CLAIMED_OPT_INS.add(plan.optIn);
  for (const slug of plan.slugs) {
    if (PLAN_BY_SLUG.has(slug)) fail(`Function ${slug} appears in two rollout plans.`);
    if (typeof FUNCTION_VERIFY_JWT[slug] !== 'boolean') {
      fail(`Function ${slug} has no reviewed verify_jwt posture.`);
    }
    PLAN_BY_SLUG.set(slug, plan);
  }
}
// The auth boundary travels alone. Identity comparison against the exported
// array is deliberate: a plan may not append to gc-auth's set, and no other
// plan may claim it — either edit fails the module at import rather than at
// the moment somebody runs a rollout.
for (const slug of GAME_CENTER_ROLLOUT_SLUGS) {
  const plan = PLAN_BY_SLUG.get(slug);
  if (!plan || plan.selector !== GAME_CENTER_ROLLOUT_SELECTOR
      || plan.slugs !== GAME_CENTER_ROLLOUT_SLUGS) {
    fail(`Function ${slug} must deploy alone in the ${GAME_CENTER_ROLLOUT_SELECTOR} plan.`);
  }
}

export function rolloutPlan(selector = DEFAULT_FUNCTION_ROLLOUT) {
  if (typeof selector !== 'string' || !Object.hasOwn(FUNCTION_ROLLOUT_PLANS, selector)) {
    fail(`Unknown function rollout ${String(selector)}; expected one of `
      + `${Object.keys(FUNCTION_ROLLOUT_PLANS).join(', ')}.`);
  }
  return FUNCTION_ROLLOUT_PLANS[selector];
}

function planForSlug(slug) {
  const plan = PLAN_BY_SLUG.get(slug);
  if (!plan) fail(`Function ${String(slug)} is not in any production rollout allow-list.`);
  return plan;
}

function validateSlug(slug) {
  planForSlug(slug);
  return slug;
}

export function supabaseReadbackOmissionPaths(slug) {
  const { readbackOmissions } = planForSlug(slug);
  return Object.keys(readbackOmissions)
    .filter(key => key.startsWith('*:') || key.startsWith(`${slug}:`))
    .map(key => key.slice(key.indexOf(':') + 1));
}

function normalizeWorkdir(workdir) {
  if (typeof workdir !== 'string' || workdir === '' || workdir.includes('\0')) {
    fail('Function rollout workdir must be a non-empty path.');
  }
  return workdir;
}

function normalizeProjectRef(projectRef) {
  if (projectRef !== PRODUCTION_PROJECT_REF) {
    fail(`Function rollout target must be ${PRODUCTION_PROJECT_REF}.`);
  }
  return projectRef;
}

export function functionDeployArgs(slug, workdir, projectRef = PRODUCTION_PROJECT_REF) {
  return Object.freeze([
    'functions', 'deploy', validateSlug(slug),
    '--project-ref', normalizeProjectRef(projectRef),
    '--use-api', '--jobs', '1', '--workdir', normalizeWorkdir(workdir), '--yes',
  ]);
}

export function functionDownloadArgs(slug, workdir, projectRef = PRODUCTION_PROJECT_REF) {
  return Object.freeze([
    'functions', 'download', validateSlug(slug),
    '--project-ref', normalizeProjectRef(projectRef),
    '--use-api', '--workdir', normalizeWorkdir(workdir),
  ]);
}

export function functionListArgs(workdir, projectRef = PRODUCTION_PROJECT_REF) {
  return Object.freeze([
    'functions', 'list', '--project-ref', normalizeProjectRef(projectRef),
    '--output', 'json', '--workdir', normalizeWorkdir(workdir),
  ]);
}

function validatePayload(slug, payload) {
  validateSlug(slug);
  if (!Array.isArray(payload) || payload.length === 0) fail(`${slug} has an empty deploy closure.`);
  const seen = new Set();
  for (const [index, file] of payload.entries()) {
    if (!isObject(file) || typeof file.name !== 'string' || typeof file.content !== 'string') {
      fail(`${slug} deploy file ${index} has an invalid shape.`);
    }
    const segments = file.name.split('/');
    if (!file.name || file.name.includes('\\') || path.posix.isAbsolute(file.name)
        || segments.some(segment => !segment || segment === '.' || segment === '..')) {
      fail(`${slug} deploy path is unsafe: ${file.name}`);
    }
    if (seen.has(file.name)) fail(`${slug} deploy closure repeats ${file.name}.`);
    seen.add(file.name);
  }
  if (!seen.has('index.ts') || !seen.has('deno.json')) {
    fail(`${slug} deploy closure must contain index.ts and deno.json.`);
  }
  return payload;
}

function writeConfig(projectRoot, plan, slugs = plan.slugs) {
  const supabaseDir = path.join(projectRoot, 'supabase');
  mkdirSync(supabaseDir, { recursive: true });
  const lines = [
    `project_id = "${plan.projectId}"`,
    '',
    '[edge_runtime]',
    'deno_version = 2',
  ];
  for (const slug of slugs) {
    validateSlug(slug);
    lines.push('', `[functions.${slug}]`, `verify_jwt = ${FUNCTION_VERIFY_JWT[slug]}`);
  }
  lines.push('');
  writeFileSync(path.join(supabaseDir, 'config.toml'), lines.join('\n'));
}

function writePayload(projectRoot, slug, payload) {
  const functionRoot = path.join(projectRoot, 'supabase', 'functions', slug);
  mkdirSync(functionRoot, { recursive: true });
  for (const file of validatePayload(slug, payload)) {
    const destination = path.resolve(functionRoot, ...file.name.split('/'));
    if (destination !== functionRoot && !destination.startsWith(`${functionRoot}${path.sep}`)) {
      fail(`${slug} deploy path escapes its temporary root: ${file.name}`);
    }
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, file.content);
  }
  return functionRoot;
}

export function materializeFunctionProject(
  projectRoot,
  payloads,
  selector = DEFAULT_FUNCTION_ROLLOUT,
) {
  const plan = rolloutPlan(selector);
  normalizeWorkdir(projectRoot);
  if (!(payloads instanceof Map)
      || payloads.size !== plan.slugs.length
      || plan.slugs.some(slug => !payloads.has(slug))) {
    fail(`The ${plan.selector} payload map must contain exactly its ${plan.slugs.length} allow-listed slugs.`);
  }
  writeConfig(projectRoot, plan);
  for (const slug of plan.slugs) writePayload(projectRoot, slug, payloads.get(slug));
  return projectRoot;
}

function filesBelow(root, current = root, out = []) {
  if (!existsSync(current)) return out;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) fail(`Downloaded closure contains a symlink: ${full}`);
    if (entry.isDirectory()) filesBelow(root, full, out);
    else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    else fail(`Downloaded closure contains an unsupported filesystem entry: ${full}`);
  }
  return out;
}

export function assertExactDownloadedClosure(functionRoot, slug, payload) {
  const { readbackOmissions } = planForSlug(slug);
  const expected = [...validatePayload(slug, payload)].sort((a, b) => a.name.localeCompare(b.name));
  const actualNames = filesBelow(functionRoot).sort((a, b) => a.localeCompare(b));
  const expectedNames = expected.map(file => file.name);
  const actualSet = new Set(actualNames);
  const expectedSet = new Set(expectedNames);
  const unexpected = actualNames.filter(name => !expectedSet.has(name));
  const unsafeMissing = expected.filter((file) => {
    if (actualSet.has(file.name)) return false;
    const expectedHash = readbackOmissions[`${slug}:${file.name}`]
      ?? readbackOmissions[`*:${file.name}`];
    return expectedHash !== createHash('sha256').update(file.content).digest('hex');
  });
  if (unexpected.length || unsafeMissing.length) {
    fail(`${slug} downloaded paths differ from its deploy closure.\nExpected: ${expectedNames.join(', ')}\nActual: ${actualNames.join(', ')}`);
  }
  for (const file of expected.filter(({ name }) => actualSet.has(name))) {
    const actual = readFileSync(path.join(functionRoot, ...file.name.split('/')));
    if (!actual.equals(Buffer.from(file.content))) {
      fail(`${slug} downloaded bytes differ for ${file.name}.`);
    }
  }
  return true;
}

export function assertActiveFunctionMetadata(output, slug) {
  validateSlug(slug);
  const verifyJwt = FUNCTION_VERIFY_JWT[slug];
  let rows;
  try { rows = JSON.parse(output); } catch (error) {
    fail(`Supabase functions-list output is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(rows)) fail('Supabase functions-list output must be an array.');
  const matches = rows.filter(row => isObject(row) && row.slug === slug);
  if (matches.length !== 1) fail(`Supabase functions-list must contain exactly one ${slug} row.`);
  const row = matches[0];
  if (typeof row.id !== 'string' || !row.id
      || typeof row.name !== 'string' || !row.name
      || row.status !== 'ACTIVE'
      || !Number.isSafeInteger(row.version) || row.version < 1
      || row.verify_jwt !== verifyJwt
      || !Number.isSafeInteger(row.created_at) || row.created_at < 0
      || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0) {
    fail(`${slug} is not ACTIVE with verify_jwt=${verifyJwt} and valid deployment metadata.`);
  }
  return Object.freeze({ slug, version: row.version, updatedAt: row.updated_at });
}

export function assertPinnedSupabaseLock(packageJson, lock) {
  const lockedPackage = lock?.packages?.['node_modules/supabase'];
  if (packageJson?.devDependencies?.supabase !== FUNCTION_CLI_VERSION
      || lock?.packages?.['']?.devDependencies?.supabase !== FUNCTION_CLI_VERSION
      || lockedPackage?.version !== FUNCTION_CLI_VERSION) {
    fail(`Supabase CLI must be pinned exactly to ${FUNCTION_CLI_VERSION} in package.json and package-lock.json.`);
  }
  if (typeof lockedPackage.integrity !== 'string' || lockedPackage.integrity.trim() === '') {
    fail('The node_modules/supabase lockfile entry must have a non-empty integrity value.');
  }
  return lockedPackage.integrity;
}

function assertPinnedCli(runner, cli = CLI) {
  const packageJson = readJson(path.join(REPOSITORY_ROOT, 'package.json'), 'package.json');
  const lock = readJson(path.join(REPOSITORY_ROOT, 'package-lock.json'), 'package-lock.json');
  assertPinnedSupabaseLock(packageJson, lock);
  if (!existsSync(cli)) fail('Install the lockfile dependencies before the function rollout.');
  const installed = runner.capture(cli, ['--version']);
  if (installed !== FUNCTION_CLI_VERSION) {
    fail(`Installed Supabase CLI is ${installed}; expected ${FUNCTION_CLI_VERSION}.`);
  }
}

function rolloutPayloads(plan) {
  const payloads = new Map();
  for (const slug of plan.slugs) {
    const closure = fnFiles(slug);
    if (closure.missing.length) fail(`${slug} has an incomplete deploy closure.`);
    payloads.set(slug, validatePayload(slug, uploadPayload(slug)));
  }
  return payloads;
}

function assertCommittedClosures(runner, plan) {
  const sources = [...new Set([
    ...plan.controlFiles,
    ...plan.slugs.flatMap(slug => fnFiles(slug).files.map(file => file.source)),
  ])].sort();
  runner.capture('git', ['ls-files', '--error-unmatch', '--', ...sources]);
  const status = runner.capture('git', [
    'status', '--porcelain=v1', '--untracked-files=all', '--', ...sources,
  ]);
  if (status) fail(`Function closure and rollout inputs must match committed HEAD:\n${status}`);
}

function prepareReadbackRoot(root, plan, slug, index) {
  const readback = mkdtempSync(path.join(root, `readback-${String(index).padStart(2, '0')}-${slug}-`));
  writeConfig(readback, plan, [slug]);
  return readback;
}

/*
 * What production is running right now, for the preview report only. This is a
 * read, so it degrades instead of failing closed: a preview that cannot reach
 * Supabase (no CLI credentials, offline) must still print the plan it would
 * deploy rather than hide it behind an authentication error. Nothing is
 * written, and the apply path never uses this — it re-reads each row through
 * assertActiveFunctionMetadata, which does fail closed.
 */
function probeDeployedVersions(runner, cli, plan, workdir) {
  const versions = new Map(plan.slugs.map(slug => [slug, null]));
  let unavailable = '';
  try {
    const rows = JSON.parse(runner.capture(cli, functionListArgs(workdir)));
    if (!Array.isArray(rows)) fail('Supabase functions-list output must be an array.');
    for (const row of rows) {
      if (isObject(row) && versions.has(row.slug) && Number.isSafeInteger(row.version)) {
        versions.set(row.slug, row.version);
      }
    }
  } catch (error) {
    unavailable = (error instanceof Error ? error.message : String(error)).split('\n')[0];
  }
  return {
    unavailable,
    current: Object.freeze(plan.slugs.map(slug => Object.freeze({
      slug,
      version: versions.get(slug),
    }))),
  };
}

export async function rolloutProductionFunctions({
  selector = DEFAULT_FUNCTION_ROLLOUT,
  apply = false,
  // Each plan reads its own environment opt-in, so one plan's variable can
  // never authorize another's deploy.
  optIn = process.env[rolloutPlan(selector).optIn],
  nodeVersion = process.versions.node,
  runner = createCliRunner(),
  cli = CLI,
  createTemp = () => mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX)),
  removeTemp = root => rmSync(root, { recursive: true, force: true }),
  readProduction = productionRead,
  log = message => console.log(message),
} = {}) {
  const plan = rolloutPlan(selector);
  requireNode24(nodeVersion);
  assertFunctionDeployOptIn(apply, optIn, plan.optIn);
  if (SUPABASE_PROJECT_REF !== PRODUCTION_PROJECT_REF) {
    fail(`Configured project ref ${SUPABASE_PROJECT_REF} does not match the production allow-list.`);
  }
  const root = path.resolve(runner.capture('git', ['rev-parse', '--show-toplevel']));
  if (root !== REPOSITORY_ROOT || path.resolve(process.cwd()) !== REPOSITORY_ROOT) {
    fail(`Run the function rollout from ${REPOSITORY_ROOT}.`);
  }
  if (runner.capture('git', ['branch', '--show-current']) !== 'main') {
    fail('Production function rollout must run from the local main branch.');
  }
  assertPinnedCli(runner, cli);
  assertCommittedClosures(runner, plan);
  const payloads = rolloutPayloads(plan);
  const prerequisite = apply ? await plan.prerequisite(readProduction) : undefined;

  let tempRoot;
  let tempValidated = false;
  try {
    tempRoot = createTemp();
    if (typeof tempRoot !== 'string' || !tempRoot) fail('Temporary function workspace creation failed.');
    const resolvedTemp = path.resolve(tempRoot);
    if (path.dirname(resolvedTemp) !== path.resolve(os.tmpdir())
        || !path.basename(resolvedTemp).startsWith(TEMP_PREFIX)) {
      fail(`Refusing unsafe temporary function workspace: ${tempRoot}`);
    }
    tempValidated = true;
    const deployRoot = path.join(tempRoot, 'deploy');
    materializeFunctionProject(deployRoot, payloads, plan.selector);
    if (!apply) {
      const { current, unavailable } = probeDeployedVersions(runner, cli, plan, deployRoot);
      // A readable listing that omits a slug means production has never run it
      // — the ordinary state of a plan's first apply, and a different fact from
      // a listing we could not read at all.
      const deployedState = version => (version !== null
        ? `deployed v${version}`
        : (unavailable ? 'deployed version unknown' : 'not deployed yet'));
      log(`Preview only (${plan.selector}): would deploy ${current.map(({ slug, version }) => (
        `${slug} (${payloads.get(slug).length} files, ${deployedState(version)})`
      )).join(', ')}`);
      if (unavailable) log(`Deployed versions unavailable: ${unavailable}`);
      for (const note of plan.notes) log(note);
      return Object.freeze({
        applied: false,
        selector: plan.selector,
        slugs: plan.slugs,
        current,
      });
    }

    const deployed = [];
    for (const [index, slug] of plan.slugs.entries()) {
      runner.run(cli, functionDeployArgs(slug, deployRoot));
      const metadata = assertActiveFunctionMetadata(
        runner.capture(cli, functionListArgs(deployRoot)),
        slug,
      );
      const readbackRoot = prepareReadbackRoot(tempRoot, plan, slug, index);
      runner.run(cli, functionDownloadArgs(slug, readbackRoot));
      assertExactDownloadedClosure(
        path.join(readbackRoot, 'supabase', 'functions', slug),
        slug,
        payloads.get(slug),
      );
      deployed.push(metadata);
      log(`Verified ${slug} v${metadata.version}: ACTIVE, verify_jwt=${FUNCTION_VERIFY_JWT[slug]}, exact runtime closure read back.`);
    }
    return Object.freeze({
      applied: true,
      selector: plan.selector,
      slugs: plan.slugs,
      prerequisite,
      deployed: Object.freeze(deployed),
    });
  } finally {
    if (tempValidated && typeof tempRoot === 'string' && tempRoot) removeTemp(tempRoot);
  }
}

function parseArgs(argv) {
  const [selector, ...rest] = argv;
  if (typeof selector !== 'string' || !Object.hasOwn(FUNCTION_ROLLOUT_PLANS, selector)
      || rest.length > 1 || (rest.length === 1 && rest[0] !== '--apply')) {
    fail('Usage: mise exec -- node --experimental-strip-types '
      + `tools/functions/production-rollout.mjs <${Object.keys(FUNCTION_ROLLOUT_PLANS).join('|')}> [--apply]`);
  }
  return { selector, apply: rest.length === 1 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    await rolloutProductionFunctions(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`production-functions: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
