#!/usr/bin/env node

// Guarded one-off production test-data reset. Preview is read-only. Applying
// either fixed phase requires a clean committed main branch and a distinct
// literal environment opt-in; no caller-provided SQL or row count is accepted.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPABASE_PROJECT_REF } from '../../src/config.ts';
import { productionRead } from '../debug/production-read.mjs';
import {
  auditLadderStreakBaselines,
  auditRuneTrial,
  auditRuneTrialPostApplyData,
} from './production-rollout.mjs';
import {
  BASE_PRODUCTION_TEST_DATA_AUDIT_SQL,
  EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL,
  LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL,
  PRODUCTION_TEST_DATA_CLI_VERSION,
  PRODUCTION_TEST_DATA_OPT_INS,
  PRODUCTION_TEST_DATA_PROJECT_REF,
  RUNE_TRIAL_PRODUCTION_STAGE_SQL,
  REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL,
  REFRESH_PRODUCTION_BOT_PROFILES_SQL,
  SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL,
  SEED_PRODUCTION_BOTS_SQL,
  WIPE_PRODUCTION_ACCOUNTS_SQL,
  assertPinnedProductionCli,
  assertProductionBotSeedComplete,
  assertProductionBotProfilesRefreshable,
  assertProductionProjectBinding,
  assertProductionRepositoryState,
  assertProductionTestDataOptIn,
  assertProductionWipeComplete,
  assertProductionWipePreflight,
  productionTestDataQueryArgs,
  validateBaseProductionTestDataAudit,
  validateEmptyRuneTrialDataAudit,
  validateLadderStreakBaselineProductionStage,
  validateProductionTestDataPhase,
  validateRuneTrialProductionStage,
  validateRefreshProductionBotProfilesAudit,
  validateSeededProductionTestDataAudit,
} from './production-test-data-core.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const TEMP_PREFIX = 'knucklebones-production-test-data-';
const CLI = path.join(
  REPOSITORY_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
);
const CONTROL_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'src/core/ladder.ts',
  'supabase/migrations/20260826153000_ladder_streak_baselines.sql',
  'tools/database/production-rollout-core.mjs',
  'tools/database/production-rollout.mjs',
  'tools/database/production-test-data-core.mjs',
  'tools/database/production-test-data.mjs',
  'tests/production-test-data.test.ts',
]);

function displayCommand(command, args) {
  return [command, ...args]
    .map(value => (/^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value)))
    .join(' ');
}

export function createProductionTestDataRunner({
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
  return Object.freeze({
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
  });
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function verifyProductionTestDataEnvironment({
  runner = createProductionTestDataRunner(),
  nodeVersion = process.versions.node,
  root = REPOSITORY_ROOT,
  cwd = process.cwd(),
  cli = CLI,
} = {}) {
  if (Number.parseInt(nodeVersion.split('.')[0], 10) !== 24) {
    throw new Error(`Node 24 is required (received ${nodeVersion}); run this helper through mise exec --.`);
  }
  if (!existsSync(cli)) throw new Error('Install the lockfile-pinned Supabase CLI before production test-data work.');

  const repositoryRoot = path.resolve(runner.capture('git', ['rev-parse', '--show-toplevel']));
  const branch = runner.capture('git', ['branch', '--show-current']);
  const status = runner.capture('git', ['status', '--porcelain=v1', '--untracked-files=all']);
  assertProductionRepositoryState({
    root: repositoryRoot,
    cwd: path.resolve(cwd),
    branch,
    status,
    expectedRoot: path.resolve(root),
  });
  runner.capture('git', ['ls-files', '--error-unmatch', '--', ...CONTROL_FILES]);

  const packageJson = readJson(path.join(root, 'package.json'), 'package.json');
  const packageLock = readJson(path.join(root, 'package-lock.json'), 'package-lock.json');
  assertPinnedProductionCli(packageJson, packageLock, runner.capture(cli, ['--version']));

  const linked = readJson(
    path.join(root, 'supabase', '.temp', 'linked-project.json'),
    'Supabase linked-project metadata',
  );
  assertProductionProjectBinding(
    SUPABASE_PROJECT_REF,
    typeof linked?.ref === 'string' ? linked.ref : '',
    PRODUCTION_TEST_DATA_PROJECT_REF,
  );
  return Object.freeze({ root, cli, runner });
}

export function executeFixedProductionTestDataSql(sql, {
  cli = CLI,
  runner = createProductionTestDataRunner(),
  createTemp = () => mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX)),
  removeTemp = directory => rmSync(directory, { recursive: true, force: true }),
} = {}) {
  if (sql !== WIPE_PRODUCTION_ACCOUNTS_SQL
      && sql !== SEED_PRODUCTION_BOTS_SQL
      && sql !== REFRESH_PRODUCTION_BOT_PROFILES_SQL) {
    throw new Error('Production test-data executor accepts only its fixed SQL programs.');
  }
  let directory;
  let tempValidated = false;
  try {
    directory = createTemp();
    if (typeof directory !== 'string' || directory === '') {
      throw new Error('Could not allocate the production test-data temporary directory.');
    }
    const resolvedTemp = path.resolve(directory);
    if (path.dirname(resolvedTemp) !== path.resolve(os.tmpdir())
        || !path.basename(resolvedTemp).startsWith(TEMP_PREFIX)) {
      throw new Error(`Refusing unsafe production test-data temporary directory: ${directory}`);
    }
    tempValidated = true;
    const sqlFile = path.join(directory, 'operation.sql');
    writeFileSync(sqlFile, sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    runner.run(cli, productionTestDataQueryArgs(sqlFile));
  } finally {
    if (tempValidated && typeof directory === 'string' && directory !== '') removeTemp(directory);
  }
}

/** Reuse the migration rollout's exact catalog/security/body/ACL/cron audit. */
export async function auditExactRuneTrialProduction(read = productionRead) {
  const ledgerStage = validateRuneTrialProductionStage(await read(RUNE_TRIAL_PRODUCTION_STAGE_SQL));
  if (ledgerStage !== 1) throw new Error('Rune Trial production migration ledger is not complete.');
  const exact = await auditRuneTrial(read);
  if (exact.schemaStage !== 1) {
    throw new Error('Rune Trial exact catalog/security/function contract is incomplete.');
  }
  await auditRuneTrialPostApplyData(read);
  return Object.freeze({ ledgerStage, evidence: exact.evidence });
}

export async function auditExactLadderStreakBaselineProduction(read = productionRead) {
  const ledgerStage = validateLadderStreakBaselineProductionStage(
    await read(LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL),
  );
  if (ledgerStage !== 1) {
    throw new Error('Ladder streak-baseline production migration ledger is not complete.');
  }
  const exact = await auditLadderStreakBaselines(read);
  if (exact.schemaStage !== 1) {
    throw new Error('Ladder streak-baseline exact catalog/security/function contract is incomplete.');
  }
  return Object.freeze({ ledgerStage, evidence: exact.evidence });
}

export async function auditExactBotSeedProduction(read = productionRead) {
  const rune = await auditExactRuneTrialProduction(read);
  const streakBaseline = await auditExactLadderStreakBaselineProduction(read);
  return Object.freeze({ ledgerStage: 1, rune, streakBaseline });
}

export async function rolloutProductionTestData({
  phase,
  apply = false,
  optIn,
  read = productionRead,
  exactBotSeedPrerequisite = auditExactBotSeedProduction,
  verifyEnvironment = verifyProductionTestDataEnvironment,
  execute = executeFixedProductionTestDataSql,
  log = message => console.log(message),
} = {}) {
  const selected = validateProductionTestDataPhase(phase);
  const optInContract = PRODUCTION_TEST_DATA_OPT_INS[selected];
  assertProductionTestDataOptIn(selected, apply, optIn ?? process.env[optInContract.name]);
  verifyEnvironment();

  const runeStage = validateRuneTrialProductionStage(
    await read(RUNE_TRIAL_PRODUCTION_STAGE_SQL),
  );
  const streakBaselineStage = validateLadderStreakBaselineProductionStage(
    await read(LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL),
  );
  const before = validateBaseProductionTestDataAudit(
    await read(BASE_PRODUCTION_TEST_DATA_AUDIT_SQL),
  );

  if (selected === 'wipe') {
    assertProductionWipePreflight(before);
    if (!apply) {
      log(`Preview only: wipe ${before.authUsers} Auth accounts (${before.humans} humans, ${before.bots} bots) and ${before.matches} matches.`);
      log(`Set ${optInContract.name}=${optInContract.value} and pass --apply to execute the fixed transaction.`);
      return Object.freeze({
        phase: selected, applied: false, runeStage, streakBaselineStage, before,
      });
    }

    execute(WIPE_PRODUCTION_ACCOUNTS_SQL);
    const after = validateBaseProductionTestDataAudit(
      await read(BASE_PRODUCTION_TEST_DATA_AUDIT_SQL),
    );
    assertProductionWipeComplete(after);
    if (runeStage === 1) {
      validateEmptyRuneTrialDataAudit(await read(EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL));
    }
    log('Production account wipe verified: zero humans, bots, Auth sessions, matches, ratings, queue, settings, and rune rows.');
    return Object.freeze({
      phase: selected, applied: true, runeStage, streakBaselineStage, before, after,
    });
  }

  if (runeStage !== 1 || streakBaselineStage !== 1) {
    throw new Error('Rune Trial and streak-baseline production migrations must be complete before bot population work.');
  }
  const emptyRune = validateEmptyRuneTrialDataAudit(
    await read(EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL),
  );
  const exactBefore = await exactBotSeedPrerequisite(read);
  if (exactBefore?.ledgerStage !== 1) {
    throw new Error('Exact bot-population prerequisite returned an invalid stage.');
  }

  if (selected === 'refresh-bot-profiles') {
    const refreshBefore = validateRefreshProductionBotProfilesAudit(
      await read(REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL),
    );
    const refreshState = assertProductionBotProfilesRefreshable(
      before,
      emptyRune,
      refreshBefore,
    );
    if (!apply) {
      log(`Preview only: ${refreshState === 'legacy' ? 'refresh' : 'retain'} the exact 150 unplayed bot profiles with toned-down records, varied peaks, and streak baselines.`);
      log(`Set ${optInContract.name}=${optInContract.value} and pass --apply to execute the fixed transaction.`);
      return Object.freeze({
        phase: selected,
        applied: false,
        runeStage,
        streakBaselineStage,
        refreshState,
        before,
        refreshBefore,
      });
    }
    const exactImmediatelyBefore = await exactBotSeedPrerequisite(read);
    if (exactImmediatelyBefore?.ledgerStage !== 1) {
      throw new Error('Production schema changed before bot-profile refresh.');
    }
    execute(REFRESH_PRODUCTION_BOT_PROFILES_SQL);
    const exactAfter = await exactBotSeedPrerequisite(read);
    if (exactAfter?.ledgerStage !== 1) {
      throw new Error('Production schema changed during bot-profile refresh.');
    }
    const after = validateSeededProductionTestDataAudit(
      await read(SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL),
    );
    assertProductionBotSeedComplete(after);
    log('Production bot-profile refresh verified: 150 unplayed bots, 41–54% win rates, modest peaks, streaks 2–7, and no invented matches.');
    return Object.freeze({
      phase: selected,
      applied: true,
      refreshState,
      runeStage,
      streakBaselineStage,
      before,
      after,
    });
  }

  assertProductionWipeComplete(before);
  if (!apply) {
    log('Preview only: seed exactly 150 bots with toned-down records, varied peaks, and streak baselines across the complete ladder.');
    log(`Set ${optInContract.name}=${optInContract.value} and pass --apply to execute the fixed transaction.`);
    return Object.freeze({
      phase: selected, applied: false, runeStage, streakBaselineStage, before,
    });
  }

  const exactImmediatelyBefore = await exactBotSeedPrerequisite(read);
  if (exactImmediatelyBefore?.ledgerStage !== 1) {
    throw new Error('Production schema changed before bot seeding.');
  }
  execute(SEED_PRODUCTION_BOTS_SQL);
  const exactAfter = await exactBotSeedPrerequisite(read);
  const afterStage = exactAfter?.ledgerStage;
  if (afterStage !== 1) throw new Error('Production schema changed during bot seeding.');
  const after = validateSeededProductionTestDataAudit(
    await read(SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL),
  );
  assertProductionBotSeedComplete(after);
  log('Production bot seed verified: zero humans and exactly 150 toned-down bots with realistic aggregate histories across every ladder group.');
  return Object.freeze({
    phase: selected,
    applied: true,
    runeStage,
    streakBaselineStage: afterStage,
    before,
    after,
  });
}

function usage() {
  console.error('Usage: production-test-data.mjs <wipe|seed-bots|refresh-bot-profiles> [--apply]');
  console.error(`  wipe apply: ${PRODUCTION_TEST_DATA_OPT_INS.wipe.name}=${PRODUCTION_TEST_DATA_OPT_INS.wipe.value}`);
  console.error(`  seed apply: ${PRODUCTION_TEST_DATA_OPT_INS['seed-bots'].name}=${PRODUCTION_TEST_DATA_OPT_INS['seed-bots'].value}`);
  console.error(`  refresh apply: ${PRODUCTION_TEST_DATA_OPT_INS['refresh-bot-profiles'].name}=${PRODUCTION_TEST_DATA_OPT_INS['refresh-bot-profiles'].value}`);
}

function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { help: true };
  if (argv.length < 1 || argv.length > 2) throw new Error('Expected one phase and optional --apply.');
  const [phase, flag] = argv;
  if (flag !== undefined && flag !== '--apply') throw new Error(`Unknown argument: ${flag}`);
  return { help: false, phase: validateProductionTestDataPhase(phase), apply: flag === '--apply' };
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
  await rolloutProductionTestData(parsed);
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
