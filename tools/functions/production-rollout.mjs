#!/usr/bin/env node

// Fail-closed Rune Trial Edge Function rollout.
//
// The repository's raw function directories are not deployable by the CLI:
// their synthetic ./core imports resolve to root src/. Materialize the exact
// normalized closure that tools/fnfiles.mjs gates, deploy one function at a
// time through the pinned API bundler, then download and compare every runtime
// byte. Supabase omits two known type-only files from readback; their expected
// source hashes are pinned below so a future runtime change fails closed.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
import {
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
export const FUNCTION_CLI_VERSION = '2.115.0';
export const FUNCTION_DEPLOY_OPT_IN = 'KB_ALLOW_PRODUCTION_RUNE_FUNCTIONS';
export const PRODUCTION_PROJECT_REF = 'euzjcejbkxvqfrttgaxu';
export const RUNE_TRIAL_MIGRATION_VERSION = '20260825205241';
export const RUNE_TRIAL_MIGRATION_NAME = 'rune_trial_ranked_v2';
export const SUPABASE_TYPE_ONLY_READBACK_OMISSIONS = Object.freeze({
  'core/ranked-action-types.ts': 'b2876e639391167cda7cfd070955adcca63f2be5798cdff0f1576ae27aea198c',
  'core/spell-types.ts': 'b56906dd5fc6c9ad56aaa7b8329a0365cc23c80f6d44814d04ebce9165ab35d6',
});

const REQUIRED_NODE_MAJOR = 24;
const TEMP_PREFIX = 'knucklebones-production-functions-';
const ROLLOUT_CONTROL_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'supabase/migrations/20260825205241_rune_trial_ranked_v2.sql',
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
const displayCommand = (command, args) => [command, ...args]
  .map(value => (/^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value)))
  .join(' ');

export function createCommandRunner({
  cwd = REPOSITORY_ROOT,
  env = process.env,
  spawn = spawnSync,
  announce = message => console.log(message),
} = {}) {
  const invoke = (command, args, options) => {
    announce(`$ ${displayCommand(command, args)}`);
    const result = spawn(command, args, {
      cwd,
      env: { ...env, SUPABASE_TELEMETRY_DISABLED: '1' },
      shell: false,
      ...options,
    });
    if (result.status !== 0 || result.error || result.signal) {
      const detail = String(result.stderr || result.stdout || '').trim();
      const state = result.error
        ? `could not start: ${result.error.message}`
        : result.signal ? `was terminated by ${result.signal}` : `exited with ${result.status}`;
      throw new Error(`${displayCommand(command, args)} ${state}${detail ? `\n${detail}` : ''}`);
    }
    return result;
  };
  return {
    capture(command, args) {
      const result = invoke(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return String(result.stdout || '').trim();
    },
    run(command, args) {
      invoke(command, args, { stdio: 'inherit' });
    },
  };
}

export function requireNode24(version = process.versions.node) {
  if (Number.parseInt(version.split('.')[0], 10) !== REQUIRED_NODE_MAJOR) {
    fail(`Node 24 is required (received ${version}); run this helper through mise exec --.`);
  }
}

export function assertFunctionDeployOptIn(apply, value) {
  if (typeof apply !== 'boolean') fail('Function rollout apply intent must be boolean.');
  if (apply && value !== '1') {
    fail(`Production deployment requires ${FUNCTION_DEPLOY_OPT_IN}=1 and --apply.`);
  }
  return apply;
}

function validateSlug(slug) {
  if (!FUNCTION_ROLLOUT_SLUGS.includes(slug)) {
    fail(`Function ${String(slug)} is not in the Rune Trial rollout allow-list.`);
  }
  return slug;
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

function writeConfig(projectRoot, slugs = FUNCTION_ROLLOUT_SLUGS) {
  const supabaseDir = path.join(projectRoot, 'supabase');
  mkdirSync(supabaseDir, { recursive: true });
  const lines = [
    'project_id = "knucklebones-rune-trial-function-rollout"',
    '',
    '[edge_runtime]',
    'deno_version = 2',
  ];
  for (const slug of slugs) {
    validateSlug(slug);
    lines.push('', `[functions.${slug}]`, 'verify_jwt = true');
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

export function materializeFunctionProject(projectRoot, payloads) {
  normalizeWorkdir(projectRoot);
  if (!(payloads instanceof Map)
      || payloads.size !== FUNCTION_ROLLOUT_SLUGS.length
      || FUNCTION_ROLLOUT_SLUGS.some(slug => !payloads.has(slug))) {
    fail('Function rollout payload map must contain exactly the six allow-listed slugs.');
  }
  writeConfig(projectRoot);
  for (const slug of FUNCTION_ROLLOUT_SLUGS) writePayload(projectRoot, slug, payloads.get(slug));
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
  const expected = [...validatePayload(slug, payload)].sort((a, b) => a.name.localeCompare(b.name));
  const actualNames = filesBelow(functionRoot).sort((a, b) => a.localeCompare(b));
  const expectedNames = expected.map(file => file.name);
  const actualSet = new Set(actualNames);
  const expectedSet = new Set(expectedNames);
  const unexpected = actualNames.filter(name => !expectedSet.has(name));
  const unsafeMissing = expected.filter(file => !actualSet.has(file.name)
    && SUPABASE_TYPE_ONLY_READBACK_OMISSIONS[file.name]
      !== createHash('sha256').update(file.content).digest('hex'));
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
      || row.verify_jwt !== true
      || !Number.isSafeInteger(row.created_at) || row.created_at < 0
      || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0) {
    fail(`${slug} is not ACTIVE with verify_jwt=true and valid deployment metadata.`);
  }
  return Object.freeze({ slug, version: row.version, updatedAt: row.updated_at });
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (error) {
    fail(`Could not read ${path.relative(REPOSITORY_ROOT, file)}: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  const packageJson = readJson(path.join(REPOSITORY_ROOT, 'package.json'));
  const lock = readJson(path.join(REPOSITORY_ROOT, 'package-lock.json'));
  assertPinnedSupabaseLock(packageJson, lock);
  if (!existsSync(cli)) fail('Install the lockfile dependencies before the function rollout.');
  const installed = runner.capture(cli, ['--version']);
  if (installed !== FUNCTION_CLI_VERSION) {
    fail(`Installed Supabase CLI is ${installed}; expected ${FUNCTION_CLI_VERSION}.`);
  }
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

function rolloutPayloads() {
  const payloads = new Map();
  for (const slug of FUNCTION_ROLLOUT_SLUGS) {
    const closure = fnFiles(slug);
    if (closure.missing.length) fail(`${slug} has an incomplete deploy closure.`);
    payloads.set(slug, validatePayload(slug, uploadPayload(slug)));
  }
  return payloads;
}

function assertCommittedClosures(runner) {
  const sources = [...new Set([
    ...ROLLOUT_CONTROL_FILES,
    ...FUNCTION_ROLLOUT_SLUGS.flatMap(slug => fnFiles(slug).files.map(file => file.source)),
  ])].sort();
  runner.capture('git', ['ls-files', '--error-unmatch', '--', ...sources]);
  const status = runner.capture('git', [
    'status', '--porcelain=v1', '--untracked-files=all', '--', ...sources,
  ]);
  if (status) fail(`Function closure and rollout inputs must match committed HEAD:\n${status}`);
}

function prepareReadbackRoot(root, slug, index) {
  const readback = mkdtempSync(path.join(root, `readback-${String(index).padStart(2, '0')}-${slug}-`));
  writeConfig(readback, [slug]);
  return readback;
}

export async function rolloutProductionFunctions({
  apply = false,
  optIn = process.env[FUNCTION_DEPLOY_OPT_IN],
  nodeVersion = process.versions.node,
  runner = createCommandRunner(),
  cli = CLI,
  createTemp = () => mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX)),
  removeTemp = root => rmSync(root, { recursive: true, force: true }),
  readProduction = productionRead,
  log = message => console.log(message),
} = {}) {
  requireNode24(nodeVersion);
  assertFunctionDeployOptIn(apply, optIn);
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
  assertCommittedClosures(runner);
  const payloads = rolloutPayloads();
  const prerequisite = apply
    ? await assertRuneTrialProductionPrerequisite(readProduction)
    : undefined;

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
    materializeFunctionProject(deployRoot, payloads);
    if (!apply) {
      log(`Preview only: ${FUNCTION_ROLLOUT_SLUGS.map(slug => `${slug} (${payloads.get(slug).length} files)`).join(', ')}`);
      log(`Set ${FUNCTION_DEPLOY_OPT_IN}=1 and pass --apply only after the Rune Trial migration is verified.`);
      return Object.freeze({ applied: false, slugs: FUNCTION_ROLLOUT_SLUGS });
    }

    const deployed = [];
    for (const [index, slug] of FUNCTION_ROLLOUT_SLUGS.entries()) {
      runner.run(cli, functionDeployArgs(slug, deployRoot));
      const metadata = assertActiveFunctionMetadata(
        runner.capture(cli, functionListArgs(deployRoot)),
        slug,
      );
      const readbackRoot = prepareReadbackRoot(tempRoot, slug, index);
      runner.run(cli, functionDownloadArgs(slug, readbackRoot));
      assertExactDownloadedClosure(
        path.join(readbackRoot, 'supabase', 'functions', slug),
        slug,
        payloads.get(slug),
      );
      deployed.push(metadata);
      log(`Verified ${slug} v${metadata.version}: ACTIVE, JWT required, exact runtime closure read back.`);
    }
    return Object.freeze({
      applied: true,
      slugs: FUNCTION_ROLLOUT_SLUGS,
      prerequisite,
      deployed: Object.freeze(deployed),
    });
  } finally {
    if (tempValidated && typeof tempRoot === 'string' && tempRoot) removeTemp(tempRoot);
  }
}

function parseArgs(argv) {
  if (argv.length === 0) return false;
  if (argv.length === 1 && argv[0] === '--apply') return true;
  fail('Usage: mise exec -- node --experimental-strip-types tools/functions/production-rollout.mjs [--apply]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    await rolloutProductionFunctions({ apply: parseArgs(process.argv.slice(2)) });
  } catch (error) {
    console.error(`production-functions: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
