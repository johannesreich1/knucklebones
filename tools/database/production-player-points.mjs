#!/usr/bin/env node

// Guarded production-only owner utility. Preview is read-only; apply writes one
// reviewed transaction for the fixed BadRandolf account and verifies it again.

import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, MIN_GAIN } from '../../src/core/ladder.ts';
import {
  highestRankedPoolTier,
  rankedPoolTierForPeak,
} from '../../src/core/ranked-outcomes.ts';
import { productionRead } from '../debug/production-read.mjs';
import { createCliRunner } from './cli-runner.mjs';
import {
  PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN,
  PRODUCTION_PLAYER_NICKNAME,
  PRODUCTION_PLAYER_POINTS_AUDIT_SQL,
  PRODUCTION_PLAYER_POINTS_OPT_IN,
  assertProductionPlayerPointsApplied,
  assertProductionPlayerPointsOptIn,
  assertProductionPlayerPointsReady,
  buildProductionPlayerPointsSql,
  parseProductionPlayerPoints,
  productionPlayerHighWaterResetOptInValue,
  validateProductionPlayerPointsAudit,
} from './production-player-points-core.mjs';
import {
  PRODUCTION_TEST_DATA_PROJECT_REF,
  productionTestDataQueryArgs,
} from './production-test-data-core.mjs';
import {
  verifyProductionTestDataEnvironment,
} from './production-test-data.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const TEMP_PREFIX = 'knucklebones-production-player-points-';
const CLI = path.join(
  REPOSITORY_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
);
const CONTROL_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'tools/database/README.md',
  'tools/database/production-player-points-core.mjs',
  'tools/database/production-player-points.mjs',
  'tests/production-test-data.test.ts',
  'tests/support/production-player-points-cases.ts',
]);

export function verifyProductionPlayerPointsEnvironment({
  runner = createCliRunner(),
  root = REPOSITORY_ROOT,
  cwd = process.cwd(),
  cli = CLI,
  nodeVersion = process.versions.node,
} = {}) {
  const verified = verifyProductionTestDataEnvironment({
    runner, root, cwd, cli, nodeVersion,
  });
  runner.capture('git', ['ls-files', '--error-unmatch', '--', ...CONTROL_FILES]);
  return verified;
}

export function executeProductionPlayerPointsSql(sql, before, requestedPoints, {
  resetHighWater = false,
  cli = CLI,
  runner = createCliRunner(),
  createTemp = () => mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX)),
  removeTemp = directory => rmSync(directory, { recursive: true, force: true }),
} = {}) {
  const expectedSql = buildProductionPlayerPointsSql(before, requestedPoints, {
    resetHighWater,
  });
  if (typeof expectedSql !== 'string' || sql !== expectedSql) {
    throw new Error('Production player-points executor accepts only its exact generated SQL.');
  }
  let directory;
  let tempValidated = false;
  try {
    directory = createTemp();
    if (typeof directory !== 'string' || directory === '') {
      throw new Error('Could not allocate the production player-points temporary directory.');
    }
    const resolvedTemp = path.resolve(directory);
    if (path.dirname(resolvedTemp) !== path.resolve(os.tmpdir())
        || !path.basename(resolvedTemp).startsWith(TEMP_PREFIX)) {
      throw new Error(`Refusing unsafe production player-points temporary directory: ${directory}`);
    }
    tempValidated = true;
    const sqlFile = path.join(directory, 'operation.sql');
    writeFileSync(sqlFile, sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    runner.run(cli, productionTestDataQueryArgs(sqlFile, PRODUCTION_TEST_DATA_PROJECT_REF));
  } finally {
    if (tempValidated && typeof directory === 'string' && directory !== '') removeTemp(directory);
  }
}

function transitionGuidance(points) {
  const next = GROUPS.find(group => group.floor > points);
  if (!next || next.id === 'neon') {
    return 'NEON is positional (top 1%); no fixed point value guarantees that transition.';
  }
  const distance = next.floor - points;
  const guarantee = distance <= MIN_GAIN
    ? `any win crosses it because the minimum win gain is ${MIN_GAIN}`
    : `a win must pay at least ${distance}`;
  return `${distance} point${distance === 1 ? '' : 's'} below ${next.id.toUpperCase()}; ${guarantee}.`;
}

async function readPlayerAudit(read) {
  return validateProductionPlayerPointsAudit(await read(
    PRODUCTION_PLAYER_POINTS_AUDIT_SQL,
    [PRODUCTION_PLAYER_NICKNAME],
  ));
}

/**
 * @param {{
 *   points?: string | number,
 *   apply?: boolean,
 *   resetHighWater?: boolean,
 *   optIn?: string,
 *   read?: (sql: string, parameters?: readonly unknown[]) => Promise<unknown[]>,
 *   verifyEnvironment?: () => unknown,
 *   execute?: (sql: string, before: ReturnType<typeof assertProductionPlayerPointsReady>, requestedPoints: number, options: { readonly resetHighWater: boolean }) => void,
 *   log?: (message: string) => void,
 * }} [options]
 */
export async function rolloutProductionPlayerPoints({
  points,
  apply = false,
  resetHighWater = false,
  optIn,
  read = productionRead,
  verifyEnvironment = () => { verifyProductionPlayerPointsEnvironment(); },
  execute = executeProductionPlayerPointsSql,
  log = message => console.log(message),
} = {}) {
  const requested = typeof points === 'number'
    ? parseProductionPlayerPoints(String(points))
    : parseProductionPlayerPoints(points);
  assertProductionPlayerPointsOptIn(
    requested,
    apply,
    optIn ?? process.env[resetHighWater
      ? PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN
      : PRODUCTION_PLAYER_POINTS_OPT_IN],
    { resetHighWater },
  );
  verifyEnvironment();

  const before = assertProductionPlayerPointsReady(await readPlayerAudit(read));
  const nextPeak = resetHighWater ? requested : Math.max(before.peak, requested);
  const nextPool = resetHighWater
    ? rankedPoolTierForPeak(nextPeak)
    : highestRankedPoolTier(
      before.rankedPoolTier,
      rankedPoolTierForPeak(nextPeak),
    );
  const operation = resetHighWater ? ' HIGH-WATER RESET:' : ':';
  log(`${PRODUCTION_PLAYER_NICKNAME}${operation} season ${before.currentSeason}, ${before.points} → ${requested} points; peak ${before.peak} → ${nextPeak}; permanent pool ${before.rankedPoolTier} → ${nextPool}.`);
  log(transitionGuidance(requested));
  if (!apply) {
    if (resetHighWater) {
      log(`Preview only. Apply with ${PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN}=${productionPlayerHighWaterResetOptInValue(requested)} and --reset-high-water --apply.`);
    } else {
      log(`Preview only. Apply with ${PRODUCTION_PLAYER_POINTS_OPT_IN}=${requested} and --apply.`);
    }
    return Object.freeze({ applied: false, points: requested, before });
  }

  /* Re-read immediately before generating the compare-and-set transaction.
     The SQL takes the same profile lock as queue/match lifecycle operations
     and repeats every blocker under that lock. */
  const immediatelyBefore = assertProductionPlayerPointsReady(await readPlayerAudit(read));
  if (immediatelyBefore.playerId !== before.playerId
      || immediatelyBefore.currentSeason !== before.currentSeason) {
    throw new Error('Production player-points target or season changed after preview.');
  }
  const sql = buildProductionPlayerPointsSql(immediatelyBefore, requested, {
    resetHighWater,
  });
  execute(sql, immediatelyBefore, requested, { resetHighWater });
  const after = await readPlayerAudit(read);
  assertProductionPlayerPointsApplied(immediatelyBefore, after, requested, {
    resetHighWater,
  });
  log(`Production player-points apply verified: ${PRODUCTION_PLAYER_NICKNAME} is at ${requested}; no pending transition predates the next match.`);
  return Object.freeze({ applied: true, points: requested, before: immediatelyBefore, after });
}

function usage() {
  console.error('Usage: production-player-points.mjs <points> [--reset-high-water] [--apply]');
  console.error(`  apply: ${PRODUCTION_PLAYER_POINTS_OPT_IN}=<same points> ... <points> --apply`);
  console.error(`  reset: ${PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN}=RESET_BADRANDOLF_HIGH_WATER_TO_<same points> ... <points> --reset-high-water --apply`);
}

export function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { help: true };
  if (argv.length < 1 || argv.length > 3) {
    throw new Error('Expected points and optional --reset-high-water/--apply flags.');
  }
  const [value, ...flags] = argv;
  const seen = new Set();
  for (const flag of flags) {
    if (flag !== '--apply' && flag !== '--reset-high-water') {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (seen.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    seen.add(flag);
  }
  return {
    help: false,
    points: parseProductionPlayerPoints(value),
    apply: seen.has('--apply'),
    resetHighWater: seen.has('--reset-high-water'),
  };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    throw error;
  }
  if (parsed.help) {
    usage();
    return;
  }
  await rolloutProductionPlayerPoints(parsed);
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
