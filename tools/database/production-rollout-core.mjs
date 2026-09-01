// Pure fail-closed helpers for a selected production database rollout.
// Transport, credentials, temporary workdirs, and the actual CLI invocation
// stay in the caller so this module can be tested without touching a database.

const MIGRATION_FILE = /^([0-9]{1,14})_([a-z0-9][a-z0-9_-]*)\.sql$/;
const MIGRATION_VERSION = /^[0-9]{1,14}$/;
const SCHEMA_FIELDS = Object.freeze([
  'baseTable',
  'baseContract',
  'localeColumn',
  'localeConstraint',
  'localeExpanded',
  'localeComment',
  'localeValues',
]);
const MATCH_COMMAND_RETENTION_FIELDS = Object.freeze([
  'cronExtension',
  'retentionIndex',
  'cleanupFunction',
  'cleanupFunctionLocked',
  'cronJob',
  'cronJobContract',
]);
const APPLE_GAME_CENTER_FIELDS = Object.freeze([
  'gameCenterTable',
  'gameCenterServiceGrant',
  'appleCredentialTable',
  'appleCredentialFunctions',
  'appleCredentialFunctionBodies',
  'appleCredentialGrants',
]);
const RUNE_TRIAL_FIELDS = Object.freeze([
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
const EQUIPPED_RANKED_STAGE_ONE_FIELDS = Object.freeze([
  'queueCapabilityConstraint',
  'matchConstraints',
  'functionContracts',
  'functionBodies',
  'serviceGrants',
  'helperLockdown',
]);
const RANDOM_RUNE_MODE_FIELDS = Object.freeze([
  'randomModeColumn',
  'randomModeConstraint',
  'randomModeComment',
  'randomModeGrant',
  'equipmentIntegrityConstraints',
  'profileSecurity',
  'compatibilityTrigger',
  'compatibilityFunctionContract',
  'compatibilityFunctionBody',
  'compatibilityFunctionLockdown',
  'randomHelperContract',
  'randomHelperBody',
  'randomHelperLockdown',
  'randomStartContract',
  'randomStartBody',
  'randomStartGrant',
  'equipmentRpcContract',
  'equipmentRpcBody',
  'equipmentRpcGrant',
]);
const HISTORICAL_SILVER_RANKED_RUNE_FIELDS = Object.freeze([
  'historicalSilverPolicy',
]);
const EQUIPPED_RANKED_FIELDS = Object.freeze([
  ...EQUIPPED_RANKED_STAGE_ONE_FIELDS,
  ...RANDOM_RUNE_MODE_FIELDS,
  ...HISTORICAL_SILVER_RANKED_RUNE_FIELDS,
]);
const LADDER_STREAK_BASELINE_FIELDS = Object.freeze([
  'tableColumns',
  'tablePrimaryKey',
  'tableRatingForeignKey',
  'tableCheck',
  'tableComment',
  'tableOwner',
  'tableGrants',
  'playerCardContract',
  'playerCardBody',
  'playerCardGrants',
  'bestStreakDelegate',
]);
const RANKED_PROGRESSION_BASE_FIELDS = Object.freeze([
  'tableContract',
  'tableColumns',
  'tableIndexes',
  'baseTableComments',
  'tableRlsPolicy',
  'tableGrants',
  'ackFunctionContract',
  'ackFunctionBody',
  'ackFunctionGrants',
]);
const RANKED_PROGRESSION_LEGACY_FIELDS = Object.freeze([
  'legacyTableConstraints',
  'legacyRuneComments',
  'legacySettleMatchEventBody',
]);
const RANKED_PROGRESSION_HISTORICAL_SILVER_FIELDS = Object.freeze([
  'historicalTableConstraints',
  'historicalRuneComments',
  'historicalRuneMatchStartPolicy',
  'historicalSettleMatchEventBody',
]);
const RANKED_PROGRESSION_V2_FIELDS = Object.freeze([
  'progressionV2TableColumns',
  'progressionV2TableConstraints',
  'progressionV2SettleMatchEventBody',
]);
const RANKED_PROGRESSION_FIELDS = Object.freeze([
  ...RANKED_PROGRESSION_BASE_FIELDS,
  ...RANKED_PROGRESSION_LEGACY_FIELDS,
  ...RANKED_PROGRESSION_HISTORICAL_SILVER_FIELDS,
  ...RANKED_PROGRESSION_V2_FIELDS,
]);

export class ProductionRolloutGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductionRolloutGuardError';
  }
}

function fail(message) {
  throw new ProductionRolloutGuardError(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} has an unexpected shape.`);
  }
}

function normalizeVersion(value, label) {
  if (typeof value !== 'string' || !MIGRATION_VERSION.test(value)) {
    fail(`${label} must be a 1-14 digit migration version.`);
  }
  return value;
}

/**
 * Parse the final pretty-printed JSON object from CLI output. Informational
 * log lines may precede it; trailing non-whitespace output is rejected.
 */
export function parseCliJson(output, label = 'Supabase CLI output') {
  if (typeof output !== 'string' || output.trim() === '') {
    fail(`${label} did not contain JSON.`);
  }

  const trimmed = output.trim();
  const candidates = [0];
  for (const match of trimmed.matchAll(/\n[ \t]*\{/g)) {
    candidates.push(match.index + match[0].lastIndexOf('{'));
  }

  for (let index = candidates.length - 1; index >= 0; index--) {
    try {
      const parsed = JSON.parse(trimmed.slice(candidates[index]));
      if (!isObject(parsed)) fail(`${label} must end in a JSON object.`);
      return parsed;
    } catch (error) {
      if (error instanceof ProductionRolloutGuardError) throw error;
    }
  }
  fail(`${label} did not end in valid JSON.`);
}

/** Return the validated version and name encoded by one migration basename. */
export function parseMigrationFilename(filename) {
  if (typeof filename !== 'string') fail('Migration filename must be a string.');
  const match = MIGRATION_FILE.exec(filename);
  if (!match) {
    fail(`Invalid migration filename: ${filename}`);
  }
  return Object.freeze({ filename, version: match[1], name: match[2] });
}

/**
 * Validate a rollout's exact migration basenames. Versions must be unique and
 * strictly increasing in PostgreSQL/Supabase's text ordering.
 */
export function validateMigrationFilenames(filenames) {
  if (!Array.isArray(filenames)) fail('Migration filenames must be an array.');
  const parsed = filenames.map(parseMigrationFilename);
  const versions = new Set();
  let previous = null;
  for (const migration of parsed) {
    if (versions.has(migration.version)) {
      fail(`Duplicate migration version: ${migration.version}`);
    }
    if (previous !== null && migration.version <= previous) {
      fail('Migration filenames must be ordered by strictly increasing version.');
    }
    versions.add(migration.version);
    previous = migration.version;
  }
  return Object.freeze(parsed);
}

/** Parse and validate `supabase migration list --output-format json`. */
export function parseMigrationListJson(output) {
  const body = parseCliJson(output, 'Supabase migration-list output');
  assertOnlyKeys(body, ['migrations', 'message'], 'Supabase migration-list output');
  if (!Array.isArray(body.migrations) || typeof body.message !== 'string') {
    fail('Supabase migration-list output has invalid field types.');
  }

  const migrations = body.migrations.map((row, index) => {
    if (!isObject(row)) fail(`Migration-list row ${index} must be an object.`);
    assertOnlyKeys(row, ['local', 'remote', 'time'], `Migration-list row ${index}`);
    if (typeof row.local !== 'string' || typeof row.remote !== 'string'
      || typeof row.time !== 'string') {
      fail(`Migration-list row ${index} has invalid field types.`);
    }
    const local = row.local.trim();
    const remote = row.remote.trim();
    if (!local && !remote) fail(`Migration-list row ${index} has no version.`);
    if (local) normalizeVersion(local, `Migration-list row ${index} local version`);
    if (remote) normalizeVersion(remote, `Migration-list row ${index} remote version`);
    return Object.freeze({ local, remote, time: row.time });
  });

  return Object.freeze({
    migrations: Object.freeze(migrations),
    message: body.message,
  });
}

/**
 * Divide an ordered rollout into the already-applied prefix and pending
 * suffix. Applying a later selected migration without every predecessor is a
 * hard error; unrelated remote versions are ignored.
 */
export function computeAppliedPrefixPendingSuffix(filenames, appliedVersions) {
  const migrations = validateMigrationFilenames(filenames);
  if (!Array.isArray(appliedVersions)) fail('Applied migration versions must be an array.');

  const appliedSet = new Set();
  for (let index = 0; index < appliedVersions.length; index++) {
    const version = normalizeVersion(
      appliedVersions[index],
      `Applied migration version ${index}`,
    );
    if (appliedSet.has(version)) fail(`Duplicate applied migration version: ${version}`);
    appliedSet.add(version);
  }

  let pendingStarted = false;
  const applied = [];
  const pending = [];
  for (const migration of migrations) {
    if (appliedSet.has(migration.version)) {
      if (pendingStarted) {
        fail(`Migration ${migration.filename} is applied before its selected predecessor.`);
      }
      applied.push(migration.filename);
    } else {
      pendingStarted = true;
      pending.push(migration.filename);
    }
  }

  return Object.freeze({
    stage: applied.length,
    applied: Object.freeze(applied),
    pending: Object.freeze(pending),
  });
}

function assertExactPush(output, expectedFilenames, expectedDryRun) {
  const expected = validateMigrationFilenames(expectedFilenames).map(({ filename }) => filename);
  const body = typeof output === 'string'
    ? parseCliJson(
      output,
      `Supabase db-push ${expectedDryRun ? 'dry-run' : 'apply'} output`,
    )
    : output;
  if (!isObject(body)) fail('Supabase db-push output must be an object.');
  assertOnlyKeys(
    body,
    ['upToDate', 'dryRun', 'migrations', 'seeds', 'roles', 'message'],
    'Supabase db-push output',
  );
  if (typeof body.upToDate !== 'boolean' || body.dryRun !== expectedDryRun
    || !Array.isArray(body.migrations) || !Array.isArray(body.seeds)
    || !Array.isArray(body.roles) || typeof body.message !== 'string') {
    fail(`Supabase db-push output has invalid field types or is not an exact ${expectedDryRun ? 'dry run' : 'apply'}.`);
  }
  if (body.upToDate !== (expected.length === 0)) {
    fail('Supabase db-push up-to-date state does not match the expected migrations.');
  }
  if (body.seeds.length !== 0 || body.roles.length !== 0) {
    fail('Production rollout must not include seeds or roles.');
  }

  const actual = validateMigrationFilenames(body.migrations)
    .map(({ filename }) => filename);
  if (actual.length !== expected.length
    || actual.some((filename, index) => filename !== expected[index])) {
    fail('Production rollout dry run did not match the exact migration allow-list and order.');
  }
  return Object.freeze({ migrations: Object.freeze(actual) });
}

/** Assert that a dry run contains only the exact selected SQL migrations. */
export function assertExactDryRun(output, expectedFilenames) {
  return assertExactPush(output, expectedFilenames, true);
}

/** Assert that an apply reports only the exact selected SQL migrations. */
export function assertExactApply(output, expectedFilenames) {
  return assertExactPush(output, expectedFilenames, false);
}

function normalizeProjectRef(value, label) {
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  const normalized = value.trim();
  if (!/^[a-z0-9]{20}$/.test(normalized)) {
    fail(`${label} is not a valid Supabase project ref.`);
  }
  return normalized;
}

function normalizeWorkdir(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    fail('Temporary Supabase workdir must be a non-empty path.');
  }
  return value;
}

/** Build the complete, fixed argv for fetching one explicitly bound ledger. */
export function productionMigrationFetchArgs(workdir, projectRef) {
  const directory = normalizeWorkdir(workdir);
  const ref = normalizeProjectRef(projectRef, 'Production project ref');
  return Object.freeze([
    'migration', 'fetch', '--workdir', directory, '--linked', '--project-ref', ref,
  ]);
}

/* Rollouts are applied in dependency order, which is not always timestamp
   order: a later-stamped migration can reach production first and leave an
   earlier-stamped peer unable to insert behind it. The CLI refuses that
   without --include-all. It is safe here precisely because the workdir is the
   allow-list: only the migrations this rollout copied in can be applied at
   all, and every one of them is sha256-pinned and audited afterwards. */
/** Build the complete, fixed argv for a safe migration-only push. */
export function productionDbPushArgs(workdir, projectRef, dryRun) {
  const directory = normalizeWorkdir(workdir);
  const ref = normalizeProjectRef(projectRef, 'Production project ref');
  if (typeof dryRun !== 'boolean') fail('Production db-push dry-run state must be boolean.');
  return Object.freeze([
    'db', 'push', '--workdir', directory, '--linked', '--project-ref', ref,
    ...(dryRun ? ['--dry-run'] : []),
    '--include-all', '--skip-vault', '--yes',
  ]);
}

/** Require both the apply flag and a separate environment opt-in. */
export function assertProductionApplyOptIn(wantsApply, optInValue) {
  if (typeof wantsApply !== 'boolean') fail('Production apply intent must be boolean.');
  if (wantsApply && optInValue !== '1') {
    fail('Production apply requires the explicit environment opt-in.');
  }
  return wantsApply;
}

/** Compare two already-validated allow-list plans across the pre-apply audit. */
export function assertSameRolloutPlan(before, after) {
  if (!isObject(before) || !isObject(after)) fail('Rollout plans must be objects.');
  assertOnlyKeys(before, ['stage', 'applied', 'pending'], 'Initial rollout plan');
  assertOnlyKeys(after, ['stage', 'applied', 'pending'], 'Current rollout plan');
  for (const [label, plan] of [['Initial', before], ['Current', after]]) {
    if (!Number.isSafeInteger(plan.stage) || plan.stage < 0
        || !Array.isArray(plan.applied) || !Array.isArray(plan.pending)
        || [...plan.applied, ...plan.pending].some(value => typeof value !== 'string')) {
      fail(`${label} rollout plan has invalid field types.`);
    }
  }
  if (before.stage !== after.stage
      || before.applied.length !== after.applied.length
      || before.pending.length !== after.pending.length
      || before.applied.some((value, index) => value !== after.applied[index])
      || before.pending.some((value, index) => value !== after.pending[index])) {
    fail('Production migration state changed during planning; rerun the command.');
  }
  return after;
}

/** Always remove a freshly allocated temporary workspace, including on error. */
export async function withTemporaryWorkspace(create, remove, action) {
  if (typeof create !== 'function' || typeof remove !== 'function'
      || typeof action !== 'function') {
    fail('Temporary workspace lifecycle requires create, remove, and action functions.');
  }
  let workdir;
  try {
    workdir = create();
    if (typeof workdir !== 'string' || workdir === '') {
      fail('Temporary workspace creation did not return a path.');
    }
    return await action(workdir);
  } finally {
    if (typeof workdir === 'string' && workdir !== '') remove(workdir);
  }
}

/** Bind repository config, linked CLI state, and the explicit target together. */
export function assertConfiguredLinkedProjectRef(configuredRef, linkedRef, expectedRef) {
  const configured = normalizeProjectRef(configuredRef, 'Configured project ref');
  const linked = normalizeProjectRef(linkedRef, 'Linked project ref');
  const expected = normalizeProjectRef(expectedRef, 'Expected project ref');
  if (configured !== expected || linked !== expected) {
    fail(`Production project ref mismatch: configured=${configured}, linked=${linked}, expected=${expected}.`);
  }
  return expected;
}

/**
 * Validate the production player-settings schema as one of four complete
 * states: 0 = absent, 1 = base table only, 2 = original locale roster, and
 * 3 = expanded locale roster. Any partial or out-of-order state is unsafe.
 */
export function validatePlayerSettingsSchemaStage(metadata) {
  if (!isObject(metadata)) fail('Schema metadata must be an object.');
  assertOnlyKeys(metadata, SCHEMA_FIELDS, 'Schema metadata');
  for (const field of SCHEMA_FIELDS) {
    if (typeof metadata[field] !== 'boolean') {
      fail(`Schema metadata field ${field} must be boolean.`);
    }
  }

  const values = SCHEMA_FIELDS.map(field => metadata[field]);
  if (values.every(value => value === false)) return 0;

  if (!metadata.baseTable || !metadata.baseContract) {
    fail('Player-settings base schema is partial or locale was applied out of order.');
  }

  const locale = [
    metadata.localeColumn,
    metadata.localeConstraint,
    metadata.localeComment,
    metadata.localeValues,
  ];
  if (locale.every(value => value === false) && !metadata.localeExpanded) return 1;
  if (locale.every(value => value === true)) {
    return metadata.localeExpanded ? 3 : 2;
  }
  fail('Player-settings locale schema or stored values do not match the complete postcondition.');
}

/**
 * Validate command retention as absent or complete. pg_cron may already be
 * installed for an unrelated job, but every retention-owned object must
 * appear together and the completed state requires the extension.
 */
export function validateMatchCommandRetentionSchemaStage(metadata) {
  if (!isObject(metadata)) fail('Command-retention metadata must be an object.');
  assertOnlyKeys(
    metadata,
    MATCH_COMMAND_RETENTION_FIELDS,
    'Command-retention metadata',
  );
  for (const field of MATCH_COMMAND_RETENTION_FIELDS) {
    if (typeof metadata[field] !== 'boolean') {
      fail(`Command-retention metadata field ${field} must be boolean.`);
    }
  }

  const owned = [
    metadata.retentionIndex,
    metadata.cleanupFunction,
    metadata.cleanupFunctionLocked,
    metadata.cronJob,
    metadata.cronJobContract,
  ];
  if (owned.every(value => value === false)) return 0;
  if (metadata.cronExtension && owned.every(value => value === true)) return 1;
  fail('Match-command retention schema or cron job is partial.');
}

/**
 * Validate the held Apple/Game Center rollout's exact ordered prefix:
 * Game Center table, service-role grant, then Apple revocation credentials.
 */
export function validateAppleGameCenterSchemaStage(metadata) {
  if (!isObject(metadata)) fail('Apple/Game Center metadata must be an object.');
  assertOnlyKeys(metadata, APPLE_GAME_CENTER_FIELDS, 'Apple/Game Center metadata');
  for (const field of APPLE_GAME_CENTER_FIELDS) {
    if (typeof metadata[field] !== 'boolean') {
      fail(`Apple/Game Center metadata field ${field} must be boolean.`);
    }
  }

  const values = APPLE_GAME_CENTER_FIELDS.map(field => metadata[field]);
  const stages = [
    [false, false, false, false, false, false],
    [true, false, false, false, false, false],
    [true, true, false, false, false, false],
    [true, true, true, true, true, true],
  ];
  const stage = stages.findIndex(expected => (
    expected.every((value, index) => value === values[index])
  ));
  if (stage >= 0) return stage;
  fail('Apple/Game Center schema, grants, or credential lifecycle is partial or out of order.');
}

/**
 * Validate the Rune Trial v2 database surface as absent or complete. Every
 * migration-owned table, column, constraint, index, policy, grant, function,
 * function body, publication member, and cron job must move together.
 */
export function validateRuneTrialSchemaStage(metadata) {
  if (!isObject(metadata)) fail('Rune Trial metadata must be an object.');
  assertOnlyKeys(metadata, RUNE_TRIAL_FIELDS, 'Rune Trial metadata');
  for (const field of RUNE_TRIAL_FIELDS) {
    if (typeof metadata[field] !== 'boolean') {
      fail(`Rune Trial metadata field ${field} must be boolean.`);
    }
  }

  const values = RUNE_TRIAL_FIELDS.map(field => metadata[field]);
  if (values.every(value => value === false)) return 0;
  if (values.every(value => value === true)) return 1;
  fail('Rune Trial schema, security boundary, function contract, or cron job is partial.');
}

/**
 * Validate the ordered ranked-rune database surface: absent, fixed equipment,
 * fixed plus RANDOM equipment, or the historical-Silver match-start policy.
 * Its Rune Trial foundation is audited separately by the caller; a
 * partially-applied stage always fails closed.
 */
export function validateEquippedRankedSchemaStage(metadata) {
  if (!isObject(metadata)) fail('Equipped-ranked metadata must be an object.');
  assertOnlyKeys(metadata, EQUIPPED_RANKED_FIELDS, 'Equipped-ranked metadata');
  for (const field of EQUIPPED_RANKED_FIELDS) {
    if (typeof metadata[field] !== 'boolean') {
      fail(`Equipped-ranked metadata field ${field} must be boolean.`);
    }
  }

  const stageOne = EQUIPPED_RANKED_STAGE_ONE_FIELDS.map(field => metadata[field]);
  const stageTwo = RANDOM_RUNE_MODE_FIELDS.map(field => metadata[field]);
  const stageThree = HISTORICAL_SILVER_RANKED_RUNE_FIELDS.map(
    field => metadata[field],
  );
  if (stageOne.every(value => value === false)
      && stageTwo.every(value => value === false)
      && stageThree.every(value => value === false)) return 0;
  if (stageOne.every(value => value === true)
      && stageTwo.every(value => value === false)
      && stageThree.every(value => value === false)) return 1;
  if (stageOne.every(value => value === true)
      && stageTwo.every(value => value === true)
      && stageThree.every(value => value === false)) return 2;
  if (stageOne.every(value => value === true)
      && stageTwo.every(value => value === true)
      && stageThree.every(value => value === true)) return 3;
  fail('Equipped-ranked capability, match constraints, functions, or grants are partial.');
}

/**
 * Validate the imported ladder-streak surface as absent or complete. The
 * audit caller gates the pre-existing player-card/best-streak contracts on
 * the baseline table's presence, so an absent migration is represented by an
 * all-false object and any partial catalog state fails closed.
 */
export function validateLadderStreakBaselineSchemaStage(metadata) {
  if (!isObject(metadata)) fail('Ladder-streak baseline metadata must be an object.');
  assertOnlyKeys(
    metadata,
    LADDER_STREAK_BASELINE_FIELDS,
    'Ladder-streak baseline metadata',
  );
  for (const field of LADDER_STREAK_BASELINE_FIELDS) {
    if (typeof metadata[field] !== 'boolean') {
      fail(`Ladder-streak baseline metadata field ${field} must be boolean.`);
    }
  }

  const values = LADDER_STREAK_BASELINE_FIELDS.map(field => metadata[field]);
  if (values.every(value => value === false)) return 0;
  if (values.every(value => value === true)) return 1;
  fail('Ladder-streak baseline table, function contract, or security boundary is partial.');
}

/**
 * Validate the durable ranked-progression event surface as absent, deployed
 * with its original live-rune facts, corrected to historical SILVER, or
 * upgraded additively for progression v2.
 * The caller separately requires the pre-existing settle_match RPC to retain
 * its exact eleven-argument service boundary in every stage; only its reviewed
 * event-writing body belongs to this migration-owned all-or-nothing surface.
 */
export function validateRankedProgressionSchemaStage(metadata) {
  if (!isObject(metadata)) fail('Ranked-progression metadata must be an object.');
  assertOnlyKeys(
    metadata,
    RANKED_PROGRESSION_FIELDS,
    'Ranked-progression metadata',
  );
  for (const field of RANKED_PROGRESSION_FIELDS) {
    if (typeof metadata[field] !== 'boolean') {
      fail(`Ranked-progression metadata field ${field} must be boolean.`);
    }
  }

  const base = RANKED_PROGRESSION_BASE_FIELDS.map(field => metadata[field]);
  const legacy = RANKED_PROGRESSION_LEGACY_FIELDS.map(field => metadata[field]);
  const historical = RANKED_PROGRESSION_HISTORICAL_SILVER_FIELDS.map(
    field => metadata[field],
  );
  const progressionV2 = RANKED_PROGRESSION_V2_FIELDS.map(
    field => metadata[field],
  );
  if (base.every(value => value === false)
      && legacy.every(value => value === false)
      && historical.every(value => value === false)
      && progressionV2.every(value => value === false)) return 0;
  if (base.every(value => value === true)
      && legacy.every(value => value === true)
      && historical.every(value => value === false)
      && progressionV2.every(value => value === false)) return 1;
  if (base.every(value => value === true)
      && legacy.every(value => value === false)
      && historical.every(value => value === true)
      && progressionV2.every(value => value === false)) return 2;
  if (base.every(value => value === true)
      && legacy.every(value => value === false)
      && metadata.historicalTableConstraints === false
      && metadata.historicalRuneComments === true
      && metadata.historicalRuneMatchStartPolicy === true
      && metadata.historicalSettleMatchEventBody === true
      && progressionV2.every(value => value === true)) return 3;
  fail('Ranked-progression table, owner boundary, acknowledgement, or settlement body is partial.');
}
