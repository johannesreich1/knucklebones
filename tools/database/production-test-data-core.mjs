// Pure guards and fixed SQL for the one-off production account reset and bot
// population. Transport and credentials stay in production-test-data.mjs.

import { GROUPS } from '../../src/core/ladder.ts';
import { RANKED_POOL_TIERS } from '../../src/core/ranked-outcomes.ts';

export const PRODUCTION_TEST_DATA_PROJECT_REF = 'euzjcejbkxvqfrttgaxu';
export const PRODUCTION_TEST_DATA_CLI_VERSION = '2.115.0';
export const PRODUCTION_BOT_COUNT = 200;
export const PRODUCTION_BOT_MAX_POINTS = 4600;
export const PRODUCTION_BOT_MIN_WIN_RATE = 0.4;
export const PRODUCTION_BOT_MAX_WIN_RATE = 0.55;
export const PRODUCTION_BOT_MAX_PEAK_GAP = 180;
export const PRODUCTION_BOT_MIN_BEST_STREAK = 2;
export const PRODUCTION_BOT_MAX_BEST_STREAK = 7;

export const PRODUCTION_TEST_DATA_PHASES = Object.freeze([
  'wipe', 'seed-bots', 'refresh-bot-profiles',
]);
export const PRODUCTION_TEST_DATA_OPT_INS = Object.freeze({
  wipe: Object.freeze({
    name: 'KB_ALLOW_PRODUCTION_ACCOUNT_WIPE',
    value: 'WIPE_ALL_ACCOUNTS',
  }),
  'seed-bots': Object.freeze({
    name: 'KB_ALLOW_PRODUCTION_BOT_SEED',
    value: `SEED_EXACTLY_${PRODUCTION_BOT_COUNT}_BOTS`,
  }),
  'refresh-bot-profiles': Object.freeze({
    name: 'KB_ALLOW_PRODUCTION_BOT_PROFILE_REFRESH',
    value: `REFRESH_EXACT_${PRODUCTION_BOT_COUNT}_UNPLAYED_BOTS`,
  }),
});

/* Every account the test-data helper ever creates is a bot: the fixed seed
   plan mints PRODUCTION_BOT_COUNT bots and zero humans, and both seed
   postchecks pin `humans` to 0. A test-data database therefore holds no
   non-bot profiles at all, so the ceiling the standard wipe tolerates is
   zero — any human account belongs to a live player, and the game is live. */
export const PRODUCTION_WIPE_HUMAN_ACCOUNT_CEILING = 0;
export const PRODUCTION_HUMAN_WIPE_OPT_IN = Object.freeze({
  name: 'KB_ALLOW_PRODUCTION_HUMAN_ACCOUNT_WIPE',
  value: 'WIPE_REAL_HUMAN_ACCOUNTS',
});

export class ProductionTestDataGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductionTestDataGuardError';
  }
}

const fail = message => { throw new ProductionTestDataGuardError(message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const CURRENT_SEASON_SQL = '(select id from public.seasons where ends_at is null order by id desc limit 1)';

/* The registry owns the tier floors: every generated `ranked_pool_tier`
   predicate is built from RANKED_POOL_TIERS descending by floor, so a retuned
   floor in src/core/ladder.ts propagates here instead of silently drifting.
   The lowest tier is the catch-all else branch, so its floor must stay 0. */
const POOL_TIERS_BY_FLOOR_DESCENDING = Object.freeze(
  [...RANKED_POOL_TIERS].sort((a, b) => b.floor - a.floor),
);
if (POOL_TIERS_BY_FLOOR_DESCENDING.length < 2
    || POOL_TIERS_BY_FLOOR_DESCENDING.at(-1).floor !== 0) {
  fail('Ranked pool tier registry no longer has a floor-zero catch-all tier.');
}
const rankedPoolTierSql = peak => `(case
${POOL_TIERS_BY_FLOOR_DESCENDING.slice(0, -1)
    .map(tier => `  when coalesce(${peak}, 0) >= ${tier.floor} then '${tier.id}'`)
    .join('\n')}
  else '${POOL_TIERS_BY_FLOOR_DESCENDING.at(-1).id}'
end)`;

export function validateProductionTestDataPhase(phase) {
  if (!PRODUCTION_TEST_DATA_PHASES.includes(phase)) {
    fail(`Production test-data phase must be one of: ${PRODUCTION_TEST_DATA_PHASES.join(', ')}.`);
  }
  return phase;
}

export function assertProductionTestDataOptIn(phase, apply, value) {
  const selected = validateProductionTestDataPhase(phase);
  if (typeof apply !== 'boolean') fail('Production test-data apply intent must be boolean.');
  const optIn = PRODUCTION_TEST_DATA_OPT_INS[selected];
  if (apply && value !== optIn.value) {
    fail(`Production ${selected} requires ${optIn.name}=${optIn.value} and --apply.`);
  }
  return apply;
}

/* Second, distinct wipe opt-in: deleting live human players never rides on
   the ordinary test-data literal alone. Returns which fixed program the wipe
   must run — false for the standard ceiling-guarded SQL, true for the
   human-account program that only this separate literal unlocks. */
export function assertProductionWipeHumanOptIn(humans, apply, value) {
  if (!Number.isSafeInteger(humans) || humans < 0) {
    fail('Production wipe human-account count must be a non-negative integer.');
  }
  if (typeof apply !== 'boolean') fail('Production test-data apply intent must be boolean.');
  if (humans <= PRODUCTION_WIPE_HUMAN_ACCOUNT_CEILING) return false;
  if (apply && value !== PRODUCTION_HUMAN_WIPE_OPT_IN.value) {
    fail(`Production wipe found ${humans} human accounts over the test-data ceiling of ${PRODUCTION_WIPE_HUMAN_ACCOUNT_CEILING}; deleting live players additionally requires ${PRODUCTION_HUMAN_WIPE_OPT_IN.name}=${PRODUCTION_HUMAN_WIPE_OPT_IN.value}.`);
  }
  return true;
}

export function assertProductionProjectBinding(configured, linked, expected = PRODUCTION_TEST_DATA_PROJECT_REF) {
  for (const [label, value] of [['configured', configured], ['linked', linked], ['expected', expected]]) {
    if (typeof value !== 'string' || !/^[a-z0-9]{20}$/.test(value.trim())) {
      fail(`Production ${label} project ref is invalid.`);
    }
  }
  const values = [configured.trim(), linked.trim(), expected.trim()];
  if (values.some(value => value !== PRODUCTION_TEST_DATA_PROJECT_REF)) {
    fail(`Production project ref mismatch: configured=${values[0]}, linked=${values[1]}, expected=${values[2]}.`);
  }
  return PRODUCTION_TEST_DATA_PROJECT_REF;
}

export function assertProductionRepositoryState({ root, cwd, branch, status, expectedRoot }) {
  if ([root, cwd, branch, status, expectedRoot].some(value => typeof value !== 'string')) {
    fail('Production repository state has invalid field types.');
  }
  if (root !== expectedRoot || cwd !== expectedRoot) {
    fail(`Production test-data helper must run from ${expectedRoot}.`);
  }
  if (branch !== 'main') fail('Production test-data helper must run from local main.');
  if (status !== '') fail('Production test-data helper requires a clean worktree.');
  return true;
}

export function assertPinnedProductionCli(packageJson, packageLock, installedVersion) {
  if (!isObject(packageJson) || !isObject(packageLock)) fail('Package metadata is invalid.');
  const rootVersion = packageJson.devDependencies?.supabase;
  const lockRootVersion = packageLock.packages?.['']?.devDependencies?.supabase;
  const installed = packageLock.packages?.['node_modules/supabase'];
  if (rootVersion !== PRODUCTION_TEST_DATA_CLI_VERSION
      || lockRootVersion !== PRODUCTION_TEST_DATA_CLI_VERSION
      || installed?.version !== PRODUCTION_TEST_DATA_CLI_VERSION
      || typeof installed?.integrity !== 'string' || installed.integrity === '') {
    fail(`Supabase CLI must be exactly ${PRODUCTION_TEST_DATA_CLI_VERSION} and integrity-pinned.`);
  }
  if (installedVersion !== PRODUCTION_TEST_DATA_CLI_VERSION) {
    fail(`Installed Supabase CLI is ${String(installedVersion)}; expected ${PRODUCTION_TEST_DATA_CLI_VERSION}.`);
  }
  return true;
}

export function productionTestDataQueryArgs(sqlFile, projectRef = PRODUCTION_TEST_DATA_PROJECT_REF) {
  assertProductionProjectBinding(projectRef, projectRef, PRODUCTION_TEST_DATA_PROJECT_REF);
  if (typeof sqlFile !== 'string' || sqlFile === '' || sqlFile.includes('\0')) {
    fail('Production SQL file must be a non-empty path.');
  }
  return Object.freeze([
    'db', 'query', '--linked', '--project-ref', projectRef,
    '--file', sqlFile, '--output-format', 'json',
  ]);
}

const BASE_AUDIT_EXPRESSIONS = Object.freeze([
  `(select count(*) from auth.users)::integer as "authUsers"`,
  `(select count(*) from auth.identities)::integer as "authIdentities"`,
  `(select count(*) from auth.sessions)::integer as "authSessions"`,
  `(select count(*) from auth.refresh_tokens)::integer as "authRefreshTokens"`,
  `(select count(*) from auth.mfa_factors)::integer as "authMfaFactors"`,
  `(select count(*) from auth.mfa_challenges)::integer as "authMfaChallenges"`,
  `(select count(*) from auth.mfa_amr_claims)::integer as "authMfaAmrClaims"`,
  `(select count(*) from auth.one_time_tokens)::integer as "authOneTimeTokens"`,
  `(select count(*) from auth.oauth_authorizations)::integer as "authOauthAuthorizations"`,
  `(select count(*) from auth.oauth_consents)::integer as "authOauthConsents"`,
  `(select count(*) from auth.webauthn_credentials)::integer as "authWebauthnCredentials"`,
  `(select count(*) from auth.webauthn_challenges)::integer as "authWebauthnChallenges"`,
  `(select count(*) from auth.flow_state)::integer as "authFlowStates"`,
  `(select count(*) from auth.oauth_client_states)::integer as "authOauthClientStates"`,
  `(select count(*) from auth.saml_relay_states)::integer as "authSamlRelayStates"`,
  `(select count(*) from public.profiles)::integer as profiles`,
  `(select count(*) from public.profiles where is_bot)::integer as bots`,
  `(select count(*) from public.profiles where not is_bot)::integer as humans`,
  `(select count(*) from public.matches)::integer as matches`,
  `(select count(*) from public.matches where status = 'active')::integer as "activeMatches"`,
  `(select count(*) from public.match_moves)::integer as "matchMoves"`,
  `(select count(*) from public.match_seeds)::integer as "matchSeeds"`,
  `(select count(*) from public.matchmaking_queue)::integer as "queueRows"`,
  `(select count(*) from public.season_ratings)::integer as "seasonRatings"`,
  `(select count(*) from public.player_settings)::integer as "playerSettings"`,
  `(select count(*) from private.active_match_players)::integer as "activeSeats"`,
  `(select count(*) from private.deleting_accounts)::integer as "deletingAccounts"`,
  `(select count(*) from private.match_commands)::integer as "matchCommands"`,
  `(select count(*) from storage.objects)::integer as "storageObjects"`,
  `(select count(*) from storage.objects object where object.owner_id is not null
      and exists (select 1 from auth.users account where account.id::text = object.owner_id))::integer
      as "authOwnedStorageObjects"`,
  `(select count(*) from auth.users account left join public.profiles profile on profile.id = account.id
      where profile.id is null)::integer as "authWithoutProfile"`,
  `(select count(*) from public.profiles profile left join auth.users account on account.id = profile.id
      where account.id is null)::integer as "profileWithoutAuth"`,
  `(select count(*) from public.seasons where ends_at is null)::integer as "openSeasons"`,
  `${CURRENT_SEASON_SQL}::integer as "currentSeason"`,
]);

const RUNE_AUDIT_EXPRESSIONS = Object.freeze([
  `(select count(*) from public.player_runes)::integer as "playerRunes"`,
  `(select count(*) from public.match_actions)::integer as "matchActions"`,
  `(select count(*) from private.rune_trial_choices)::integer as "runeTrialChoices"`,
  `(select count(*) from private.rune_trial_selection_commands)::integer as "runeSelectionCommands"`,
  `(select count(*) from private.match_action_commands)::integer as "matchActionCommands"`,
  `(select count(*)
      from public.profiles profile
      join auth.users account on account.id = profile.id
     where not profile.is_bot
        or account.instance_id is distinct from '00000000-0000-0000-0000-000000000000'::uuid
        or account.aud is distinct from 'authenticated'
        or account.role is distinct from 'authenticated'
        or account.email is distinct from 'bot-' || account.id::text || '@internal.invalid'
        or profile.nickname !~ '^[A-Za-z0-9_]{3,16}$'
        or profile.avatar !~ '^die:[1-6]:(cy|mg|gold|green|violet|orange)$')::integer
      as "invalidBotRows"`,
  `(select count(*)
      from public.profiles profile
      left join public.season_ratings rating
        on rating.player = profile.id and rating.season_id = ${CURRENT_SEASON_SQL}
     where rating.player is null)::integer as "missingSeasonRows"`,
  `(select count(*)
      from public.profiles profile
      join public.season_ratings rating
        on rating.player = profile.id and rating.season_id = ${CURRENT_SEASON_SQL}
     where profile.rating is distinct from rating.points
        or rating.peak < rating.points)::integer as "inconsistentRatingRows"`,
  `(select count(*)
      from public.profiles profile
      join public.season_ratings rating
        on rating.player = profile.id and rating.season_id = ${CURRENT_SEASON_SQL}
     where profile.ranked_pool_tier is distinct from ${rankedPoolTierSql('rating.peak')})::integer
      as "inconsistentTierRows"`,
  `(select count(*)
      from public.season_ratings rating
      left join private.season_streak_baselines baseline
        on baseline.season_id = rating.season_id and baseline.player = rating.player
     where rating.wins < 1 or rating.losses < 1 or rating.draws < 0
        or rating.wins + rating.losses + rating.draws < 16
        or rating.wins::numeric / (rating.wins + rating.losses + rating.draws)
             not between ${PRODUCTION_BOT_MIN_WIN_RATE} and ${PRODUCTION_BOT_MAX_WIN_RATE}
        or rating.peak < rating.points
        or rating.peak - rating.points > ${PRODUCTION_BOT_MAX_PEAK_GAP}
        or baseline.best_streak is null
        or baseline.best_streak < ${PRODUCTION_BOT_MIN_BEST_STREAK}
        or baseline.best_streak > ${PRODUCTION_BOT_MAX_BEST_STREAK}
        or baseline.best_streak > rating.wins)::integer
      as "invalidStatsRows"`,
  `(select count(*) from private.season_streak_baselines)::integer as "streakBaselines"`,
  `(select count(*)
      from private.season_streak_baselines baseline
      left join public.season_ratings rating
        on rating.season_id = baseline.season_id and rating.player = baseline.player
     where rating.player is null)::integer as "orphanStreakBaselines"`,
  `(select count(distinct points) from public.season_ratings)::integer as "distinctPoints"`,
  `(select min(points) from public.season_ratings)::integer as "minPoints"`,
  `(select max(points) from public.season_ratings)::integer as "maxPoints"`,
  `(select count(distinct wins) from public.season_ratings)::integer as "distinctWins"`,
  `(select count(distinct losses) from public.season_ratings)::integer as "distinctLosses"`,
  `(select count(distinct draws) from public.season_ratings)::integer as "distinctDraws"`,
  `(select count(*) from public.season_ratings where peak = points)::integer as "atPeakBots"`,
  `(select count(*) from public.season_ratings where peak > points)::integer as "peakAheadBots"`,
  `(select max(peak - points) from public.season_ratings)::integer as "maxPeakGap"`,
  `(select count(distinct best_streak) from private.season_streak_baselines)::integer
      as "distinctBestStreaks"`,
  `(select min(best_streak) from private.season_streak_baselines)::integer as "minBestStreak"`,
  `(select max(best_streak) from private.season_streak_baselines)::integer as "maxBestStreak"`,
  `(select min(wins + losses + draws) from public.season_ratings)::integer as "minGames"`,
  `(select max(wins + losses + draws) from public.season_ratings)::integer as "maxGames"`,
  `(select sum(wins + losses + draws) from public.season_ratings)::integer as "totalGames"`,
  `(select floor(min(wins::numeric * 10000 / (wins + losses + draws)))::integer
      from public.season_ratings) as "minWinRateBps"`,
  `(select floor(max(wins::numeric * 10000 / (wins + losses + draws)))::integer
      from public.season_ratings) as "maxWinRateBps"`,
  `(select count(*) from public.season_ratings where points >= 0 and points < 300)::integer as "stoneBots"`,
  `(select count(*) from public.season_ratings where points >= 300 and points < 720)::integer as "boneBots"`,
  `(select count(*) from public.season_ratings where points >= 720 and points < 1260)::integer as "ivoryBots"`,
  `(select count(*) from public.season_ratings where points >= 1260 and points < 2010)::integer as "silverBots"`,
  `(select count(*) from public.season_ratings where points >= 2010 and points < 3000)::integer as "goldBots"`,
  `(select count(*) from public.season_ratings where points >= 3000 and points < 4350)::integer as "obsidianBots"`,
  `(select count(*) from public.season_ratings where points >= 4350)::integer as "neonPointBots"`,
]);

export const BASE_PRODUCTION_TEST_DATA_AUDIT_SQL = `
select
  ${BASE_AUDIT_EXPRESSIONS.join(',\n  ')};
`;

export const SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL = `
select
  ${[...BASE_AUDIT_EXPRESSIONS, ...RUNE_AUDIT_EXPRESSIONS].join(',\n  ')};
`;

const RUNE_EMPTY_FIELDS = Object.freeze([
  'playerRunes', 'matchActions', 'runeTrialChoices',
  'runeSelectionCommands', 'matchActionCommands',
]);

export const EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL = `
select
  ${(RUNE_AUDIT_EXPRESSIONS.slice(0, RUNE_EMPTY_FIELDS.length)).join(',\n  ')};
`;

export const RUNE_TRIAL_PRODUCTION_STAGE_SQL = String.raw`
select
  exists (
    select 1 from supabase_migrations.schema_migrations
     where version = '20260825205241' and name = 'rune_trial_ranked_v2'
  ) as "migrationHistory",
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'ranked_pool_tier'
  ) as "rankedPoolColumn",
  (
    select count(*) = 12 from information_schema.columns
     where table_schema = 'public' and table_name = 'matches'
       and column_name in (
         'format', 'protocol_version', 'rune_rules_version', 'pool_tier', 'phase',
         'trial_offer', 'p1_rune', 'p2_rune', 'selection_deadline',
         'selection_version', 'action_version', 'pending_aim'
       )
  ) as "matchProtocolColumns",
  (
    select count(*) = 3 from information_schema.columns
     where table_schema = 'public' and table_name = 'matchmaking_queue'
       and column_name in ('protocol_version', 'capabilities', 'pool_tier')
  ) as "queueProtocolColumns",
  to_regclass('public.player_runes') is not null as "playerRunesTable",
  to_regclass('public.match_actions') is not null as "matchActionsTable",
  to_regclass('private.rune_trial_choices') is not null as "runeChoicesTable",
  to_regclass('private.rune_trial_selection_commands') is not null as "runeCommandsTable",
  to_regclass('private.match_action_commands') is not null as "actionCommandsTable",
  to_regprocedure('private.ranked_pool_tier_for_peak(integer)') is not null as "poolFunction";
`;

export const LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL = String.raw`
select
  exists (
    select 1 from supabase_migrations.schema_migrations
     where version = '20260826153000' and name = 'ladder_streak_baselines'
  ) as "migrationHistory",
  to_regclass('private.season_streak_baselines') is not null as "baselineTable",
  (
    select count(*) = 3 from information_schema.columns
     where table_schema = 'private' and table_name = 'season_streak_baselines'
       and column_name in ('season_id', 'player', 'best_streak')
  ) as "baselineColumns",
  (
    select count(*) = 3 from pg_constraint
     where conrelid = to_regclass('private.season_streak_baselines')
       and conname in (
         'season_streak_baselines_pkey',
         'season_streak_baselines_rating_fkey',
         'season_streak_baselines_best_streak_check'
       )
  ) as "baselineConstraints",
  coalesce((
    select position('private.season_streak_baselines' in procedure.prosrc) > 0
      from pg_proc procedure
     where procedure.oid = to_regprocedure('public.player_card(text)')
  ), false) as "playerCardBaseline";
`;

const BASE_AUDIT_FIELDS = Object.freeze([
  'authUsers', 'authIdentities', 'authSessions', 'authRefreshTokens',
  'authMfaFactors', 'authMfaChallenges', 'authMfaAmrClaims',
  'authOneTimeTokens', 'authOauthAuthorizations',
  'authOauthConsents', 'authWebauthnCredentials', 'authWebauthnChallenges',
  'authFlowStates', 'authOauthClientStates', 'authSamlRelayStates',
  'profiles', 'bots', 'humans', 'matches', 'activeMatches', 'matchMoves',
  'matchSeeds', 'queueRows', 'seasonRatings', 'playerSettings', 'activeSeats',
  'deletingAccounts', 'matchCommands', 'storageObjects', 'authOwnedStorageObjects',
  'authWithoutProfile', 'profileWithoutAuth', 'openSeasons', 'currentSeason',
]);

const RUNE_STAGE_FIELDS = Object.freeze([
  'migrationHistory', 'rankedPoolColumn', 'matchProtocolColumns',
  'queueProtocolColumns', 'playerRunesTable', 'matchActionsTable',
  'runeChoicesTable', 'runeCommandsTable', 'actionCommandsTable', 'poolFunction',
]);

const LADDER_STREAK_BASELINE_STAGE_FIELDS = Object.freeze([
  'migrationHistory', 'baselineTable', 'baselineColumns',
  'baselineConstraints', 'playerCardBaseline',
]);

const RUNE_AUDIT_FIELDS = Object.freeze([
  'playerRunes', 'matchActions', 'runeTrialChoices', 'runeSelectionCommands',
  'matchActionCommands', 'invalidBotRows', 'missingSeasonRows',
  'inconsistentRatingRows', 'inconsistentTierRows', 'invalidStatsRows',
  'streakBaselines', 'orphanStreakBaselines',
  'distinctPoints', 'minPoints', 'maxPoints', 'distinctWins', 'distinctLosses',
  'distinctDraws', 'atPeakBots', 'peakAheadBots', 'maxPeakGap',
  'distinctBestStreaks', 'minBestStreak', 'maxBestStreak',
  'minGames', 'maxGames', 'totalGames', 'minWinRateBps', 'maxWinRateBps',
  'stoneBots', 'boneBots', 'ivoryBots', 'silverBots', 'goldBots',
  'obsidianBots', 'neonPointBots',
]);

function assertExactFields(row, fields, label) {
  if (!isObject(row)) fail(`${label} must be one object.`);
  const actual = Object.keys(row).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length
      || actual.some((field, index) => field !== expected[index])) {
    fail(`${label} has an unexpected shape.`);
  }
}

function oneRow(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) fail(`${label} must return exactly one row.`);
  return rows[0];
}

export function validateBaseProductionTestDataAudit(rows) {
  const row = oneRow(rows, 'Production test-data audit');
  assertExactFields(row, BASE_AUDIT_FIELDS, 'Production test-data audit');
  for (const field of BASE_AUDIT_FIELDS) {
    if (!Number.isSafeInteger(row[field]) || row[field] < 0) {
      fail(`Production test-data audit field ${field} must be a non-negative integer.`);
    }
  }
  return Object.freeze({ ...row });
}

export function validateRuneTrialProductionStage(rows) {
  const row = oneRow(rows, 'Rune Trial production stage audit');
  assertExactFields(row, RUNE_STAGE_FIELDS, 'Rune Trial production stage audit');
  for (const field of RUNE_STAGE_FIELDS) {
    if (typeof row[field] !== 'boolean') fail(`Rune Trial stage field ${field} must be boolean.`);
  }
  const values = RUNE_STAGE_FIELDS.map(field => row[field]);
  if (values.every(value => value === false)) return 0;
  if (values.every(value => value === true)) return 1;
  fail('Rune Trial production migration is partial or its history disagrees with its schema.');
}

export function validateLadderStreakBaselineProductionStage(rows) {
  const row = oneRow(rows, 'Ladder streak-baseline production stage audit');
  assertExactFields(
    row,
    LADDER_STREAK_BASELINE_STAGE_FIELDS,
    'Ladder streak-baseline production stage audit',
  );
  for (const field of LADDER_STREAK_BASELINE_STAGE_FIELDS) {
    if (typeof row[field] !== 'boolean') {
      fail(`Ladder streak-baseline stage field ${field} must be boolean.`);
    }
  }
  const values = LADDER_STREAK_BASELINE_STAGE_FIELDS.map(field => row[field]);
  if (values.every(value => value === false)) return 0;
  if (values.every(value => value === true)) return 1;
  fail('Ladder streak-baseline production migration is partial or disagrees with its schema.');
}

export function validateSeededProductionTestDataAudit(rows) {
  const row = oneRow(rows, 'Seeded production test-data audit');
  assertExactFields(row, [...BASE_AUDIT_FIELDS, ...RUNE_AUDIT_FIELDS], 'Seeded production test-data audit');
  for (const field of [...BASE_AUDIT_FIELDS, ...RUNE_AUDIT_FIELDS]) {
    if (!Number.isSafeInteger(row[field]) || row[field] < 0) {
      fail(`Seeded production test-data field ${field} must be a non-negative integer.`);
    }
  }
  return Object.freeze({ ...row });
}

export function validateEmptyRuneTrialDataAudit(rows) {
  const row = oneRow(rows, 'Empty Rune Trial data audit');
  assertExactFields(row, RUNE_EMPTY_FIELDS, 'Empty Rune Trial data audit');
  for (const field of RUNE_EMPTY_FIELDS) {
    if (!Number.isSafeInteger(row[field]) || row[field] < 0) {
      fail(`Empty Rune Trial data field ${field} must be a non-negative integer.`);
    }
    if (row[field] !== 0) fail(`Rune Trial rollout table ${field} is not empty.`);
  }
  return Object.freeze({ ...row });
}

function assertAccountGraphConsistent(audit) {
  if (audit.profiles !== audit.bots + audit.humans
      || audit.authUsers !== audit.profiles
      || audit.authWithoutProfile !== 0
      || audit.profileWithoutAuth !== 0) {
    fail('Production Auth/profile ownership graph is inconsistent.');
  }
  if (audit.openSeasons !== 1 || !Number.isSafeInteger(audit.currentSeason)) {
    fail('Production must have exactly one current season.');
  }
  return audit;
}

export function assertProductionWipePreflight(audit) {
  assertAccountGraphConsistent(audit);
  if (audit.authOwnedStorageObjects !== 0) {
    fail('Production Auth users own Storage objects; account deletion would be unsafe.');
  }
  return audit;
}

const ZERO_AFTER_WIPE = Object.freeze([
  'authUsers', 'authIdentities', 'authSessions', 'authRefreshTokens',
  'authMfaFactors', 'authMfaChallenges', 'authMfaAmrClaims',
  'authOneTimeTokens', 'authOauthAuthorizations',
  'authOauthConsents', 'authWebauthnCredentials', 'authWebauthnChallenges',
  'authFlowStates', 'authOauthClientStates', 'authSamlRelayStates',
  'profiles', 'bots', 'humans', 'matches', 'activeMatches', 'matchMoves',
  'matchSeeds', 'queueRows', 'seasonRatings', 'playerSettings', 'activeSeats',
  'deletingAccounts', 'matchCommands', 'authOwnedStorageObjects',
  'authWithoutProfile', 'profileWithoutAuth',
]);

export function assertProductionWipeComplete(audit) {
  for (const field of ZERO_AFTER_WIPE) {
    if (audit[field] !== 0) fail(`Production wipe left ${field}=${audit[field]}.`);
  }
  if (audit.openSeasons !== 1 || !Number.isSafeInteger(audit.currentSeason)) {
    fail('Production wipe damaged the current season reference data.');
  }
  for (const field of ['playerRunes', 'matchActions', 'runeTrialChoices',
    'runeSelectionCommands', 'matchActionCommands']) {
    if (field in audit && audit[field] !== 0) fail(`Production wipe left ${field}=${audit[field]}.`);
  }
  return audit;
}

const clamp = (min, max, value) => Math.max(min, Math.min(max, value));

function botSeedHash(ordinal, salt) {
  let value = (ordinal ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x045d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x045d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function botSeedPick(ordinal, salt, size) {
  if (!Number.isSafeInteger(size) || size < 1) fail('Bot seed pick size must be positive.');
  return botSeedHash(ordinal, salt) % size;
}

function peakReferenceWidth(points) {
  const group = GROUPS.reduce(
    (selected, candidate) => (points >= candidate.floor ? candidate : selected),
    GROUPS[0],
  );
  if (group.width > 0) return group.width;
  return Math.max(...GROUPS.map(candidate => candidate.width));
}

function legacyProductionBotSeedPlan() {
  return Object.freeze(Array.from({ length: PRODUCTION_BOT_COUNT }, (_, index) => {
    const ordinal = index + 1;
    const points = Math.round(
      (index * PRODUCTION_BOT_MAX_POINTS) / (PRODUCTION_BOT_COUNT - 1),
    );
    return Object.freeze({
      ordinal,
      points,
      wins: 4 + Math.floor(points / 42) + (ordinal % 5),
      losses: 6 + Math.floor(points / 95) + ((ordinal * 3) % 6),
      draws: ordinal % 4,
    });
  }));
}

/* THE SIX-RUNE ROSTER, in registry order. Duplicated here as plain strings
   rather than imported from src/core/spells.ts: this tool runs against
   production without a build step, and the migration's own CHECK constraint is
   the authority both sides answer to. */
export const PRODUCTION_RUNE_ROSTER = Object.freeze([
  'fate', 'nudge', 'ward', 'sunder', 'pilfer', 'anvil',
]);

/* A bot's runes are WINNINGS, not decoration, so the seed may only hand out
   what the bot could plausibly have won. Two rules, and the smaller wins:

   1. STANDING. Rune Trial is dealt from IVORY (720) up, so a bot below it has
      never been offered one and gets nothing — exactly what a human at those
      points holds. From IVORY to NEON the roster fills in evenly, so the top of
      the ladder carries all six and the bottom of IVORY carries none.
   2. RECORD. You cannot hold more runes than Trials you could have won:
      games x Trial's slice of the pool x win rate. This currently never binds
      against the seeded records (they play enough), and it is kept anyway so a
      future seed plan with fewer games cannot mint runes out of nothing.

   Which runes, not just how many, is deterministic per bot: the same ordinal
   always draws the same faces, so a reseed reproduces the population exactly
   rather than reshuffling who carries what. */
const IVORY_FLOOR = 720;
const NEON_FLOOR = 4350;
const TRIAL_POOL_SHARE = 1 / 8;

export function buildProductionBotRunePlan(bot) {
  const games = bot.wins + bot.losses + bot.draws;
  if (bot.points < IVORY_FLOOR || games < 1) return Object.freeze([]);
  const reach = Math.min(1, (bot.points - IVORY_FLOOR) / (NEON_FLOOR - IVORY_FLOOR));
  const byStanding = Math.round(reach * PRODUCTION_RUNE_ROSTER.length);
  const byRecord = Math.floor(games * TRIAL_POOL_SHARE * (bot.wins / games));
  const count = Math.max(0, Math.min(PRODUCTION_RUNE_ROSTER.length, byStanding, byRecord));
  /* Rotate the roster by a per-bot offset instead of slicing from the front,
     so the population does not make FATE look universal and ANVIL rare. The
     offset is POINTS-derived rather than hashed on purpose: points are unique
     per bot (the seed's own postcheck pins count(distinct points)), so this is
     just as stable, and unlike a JS hash it can be recomputed in SQL. That lets
     the whole grant be one re-runnable statement instead of 11KB of literals
     nobody can review. */
  const offset = bot.points % PRODUCTION_RUNE_ROSTER.length;
  return Object.freeze(Array.from({ length: count }, (_, index) =>
    PRODUCTION_RUNE_ROSTER[(offset + index) % PRODUCTION_RUNE_ROSTER.length]));
}

/* The seat a bot carries into ranked. Its first winning is what a player's own
   first winning becomes: auto-equipped, because a collection of one has no
   decision in it. Below SILVER the rune is held but not in play, which the
   client already says on the profile — the seat is set regardless, so a bot
   that climbs into SILVER arrives already carrying what it won. */
export function productionBotEquippedRune(bot) {
  return buildProductionBotRunePlan(bot)[0] ?? null;
}

/**
 * The rune winnings for a freshly seeded bot population, as one guarded
 * statement. Bots are identified by their season points, which the seed plan
 * makes unique per ordinal (the seed's own postcheck pins
 * `count(distinct points)` to the population size), so no id has to be
 * hardcoded or round-tripped.
 *
 * The equipped seat is set in the same statement and only ever to a rune the
 * same statement just granted — the migration's composite foreign key would
 * refuse anything else, which is the point of putting it there.
 */
export function buildProductionBotRuneSql(plan = buildProductionBotSeedPlan()) {
  const rows = plan.flatMap((bot) => {
    const runes = buildProductionBotRunePlan(bot);
    return runes.map((rune, index) => `(${bot.points}, '${rune}', ${index === 0})`);
  });
  if (!rows.length) fail('Bot rune plan produced no rows.');
  return String.raw`
begin;
set local lock_timeout = '10s';
set local statement_timeout = '90s';

do $runes$
declare
  granted integer;
  seated integer;
begin
  if (select count(*) from public.profiles where not is_bot) <> 0 then
    raise exception 'bot rune seeding expects a bot-only population';
  end if;
  if (select count(*) from public.player_runes) <> 0 then
    raise exception 'bot rune seeding expects an empty collection table';
  end if;

  create temporary table kb_bot_rune_plan (points integer, rune_id text, seat boolean)
    on commit drop;
  insert into kb_bot_rune_plan (points, rune_id, seat) values
    ${rows.join(',\n    ')};

  insert into public.player_runes (player_id, rune_id, source_match_id)
  select r.player, p.rune_id, null
    from kb_bot_rune_plan p
    join public.season_ratings r on r.points = p.points;
  get diagnostics granted = row_count;

  /* The seat is the FIRST rune the bot won, which is what a player's own first
     winning becomes. Set even below SILVER: the rune is carried but not in
     play, so a bot that climbs arrives already holding it. */
  update public.profiles pr
     set equipped_rune = p.rune_id
    from kb_bot_rune_plan p
    join public.season_ratings r on r.points = p.points
   where pr.id = r.player and p.seat;
  get diagnostics seated = row_count;

  if granted <> ${rows.length} then
    raise exception 'expected ${rows.length} rune grants, wrote %', granted;
  end if;
  if seated <> ${plan.filter((bot) => buildProductionBotRunePlan(bot).length > 0).length} then
    raise exception 'expected ${plan.filter((bot) => buildProductionBotRunePlan(bot).length > 0).length} seated bots, wrote %', seated;
  end if;
  if exists (select 1 from public.profiles pr where pr.equipped_rune is not null
               and not exists (select 1 from public.player_runes pl
                                where pl.player_id = pr.id and pl.rune_id = pr.equipped_rune)) then
    raise exception 'a bot was seated with a rune it does not hold';
  end if;
end
$runes$;
commit;
`;
}

export function buildProductionBotSeedPlan() {
  const plan = Array.from({ length: PRODUCTION_BOT_COUNT }, (_, index) => {
    const ordinal = index + 1;
    const points = Math.round(
      (index * PRODUCTION_BOT_MAX_POINTS) / (PRODUCTION_BOT_COUNT - 1),
    );
    const games = Math.max(
      16,
      18 + Math.round(points / 11.5) + botSeedPick(ordinal, 1, 25) - 12,
    );
    const targetWinRate = clamp(
      0.42,
      0.55,
      0.43 + 0.105 * (points / PRODUCTION_BOT_MAX_POINTS)
        + (botSeedPick(ordinal, 2, 13) - 6) * 0.002,
    );
    const draws = Math.round(
      games * (0.008 + botSeedPick(ordinal, 3, 5) * 0.004),
    );
    const wins = Math.max(1, Math.round(games * targetWinRate));
    const losses = games - wins - draws;
    const peakGapCap = Math.min(
      PRODUCTION_BOT_MAX_PEAK_GAP,
      Math.max(35, Math.round(peakReferenceWidth(points) * 0.14)),
    );
    const peakGap = ordinal % 2 === 0
      ? 0
      : 5 * (1 + botSeedPick(ordinal, 4, Math.floor(peakGapCap / 5)));
    const peak = points + peakGap;
    const bestStreak = Math.min(
      wins,
      clamp(
        PRODUCTION_BOT_MIN_BEST_STREAK,
        PRODUCTION_BOT_MAX_BEST_STREAK,
        Math.floor(Math.log2(games)) - 1 + (botSeedPick(ordinal, 5, 3) - 1),
      ),
    );
    return Object.freeze({ ordinal, points, peak, wins, losses, draws, bestStreak });
  });
  const pointSet = new Set(plan.map(row => row.points));
  if (plan.length !== PRODUCTION_BOT_COUNT || pointSet.size !== PRODUCTION_BOT_COUNT
      || plan[0].points !== 0 || plan.at(-1).points !== PRODUCTION_BOT_MAX_POINTS) {
    fail('Canonical production bot point spread is invalid.');
  }
  if (GROUPS.some((group, index) => !plan.some(row => row.points >= group.floor
    && (index === GROUPS.length - 1 || row.points < GROUPS[index + 1].floor)))) {
    fail('Canonical production bot spread misses a ladder group.');
  }
  const invalid = plan.some((row) => {
    const games = row.wins + row.losses + row.draws;
    const winRate = row.wins / games;
    return row.wins < 1 || row.losses < 1 || row.draws < 0 || games < 16
      || winRate < PRODUCTION_BOT_MIN_WIN_RATE || winRate > PRODUCTION_BOT_MAX_WIN_RATE
      || row.peak < row.points || row.peak - row.points > PRODUCTION_BOT_MAX_PEAK_GAP
      || row.bestStreak < PRODUCTION_BOT_MIN_BEST_STREAK
      || row.bestStreak > PRODUCTION_BOT_MAX_BEST_STREAK
      || row.bestStreak > row.wins;
  });
  if (invalid) fail('Canonical production bot history is outside its plausible bounds.');
  if (plan.filter(row => row.peak > row.points).length !== PRODUCTION_BOT_COUNT / 2) {
    fail('Canonical production bot peaks do not contain the intended even split.');
  }
  return Object.freeze(plan);
}

export const PRODUCTION_BOT_SEED_PLAN = buildProductionBotSeedPlan();
const LEGACY_PRODUCTION_BOT_SEED_PLAN = legacyProductionBotSeedPlan();

const SEED_VALUES = PRODUCTION_BOT_SEED_PLAN
  .map(({ ordinal, points, peak, wins, losses, draws, bestStreak }) =>
    `(${ordinal}, ${points}, ${peak}, ${wins}, ${losses}, ${draws}, ${bestStreak})`)
  .join(',\n      ');

const REFRESH_VALUES = PRODUCTION_BOT_SEED_PLAN
  .map((row, index) => {
    const legacy = LEGACY_PRODUCTION_BOT_SEED_PLAN[index];
    if (legacy.ordinal !== row.ordinal || legacy.points !== row.points) {
      fail('Legacy and current production bot plans do not align.');
    }
    return `(${row.ordinal}, ${row.points}, ${legacy.wins}, ${legacy.losses}, ${legacy.draws}, ${row.peak}, ${row.wins}, ${row.losses}, ${row.draws}, ${row.bestStreak})`;
  })
  .join(',\n      ');

const REFRESH_AUDIT_FIELDS = Object.freeze([
  'expectedRows', 'actualRows', 'actualDistinctPoints', 'joinedRows',
  'canonicalRows', 'legacyRows', 'refreshedRows', 'baselineRows',
  'orphanBaselineRows',
]);

export const REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL = String.raw`
with expected(
  ordinal, expected_points, old_wins, old_losses, old_draws,
  new_peak, new_wins, new_losses, new_draws, new_best_streak
) as (
  values
      ${REFRESH_VALUES}
),
actual as (
  select rating.season_id,
         rating.player,
         rating.points,
         rating.peak,
         rating.wins,
         rating.losses,
         rating.draws,
         profile.rating as profile_rating,
         profile.ranked_pool_tier,
         profile.is_bot,
         profile.nickname,
         profile.avatar,
         account.instance_id,
         account.aud,
         account.role,
         account.email,
         baseline.best_streak
    from public.season_ratings rating
    join public.profiles profile on profile.id = rating.player
    join auth.users account on account.id = profile.id
    left join private.season_streak_baselines baseline
      on baseline.season_id = rating.season_id and baseline.player = rating.player
   where rating.season_id = ${CURRENT_SEASON_SQL}
),
joined as (
  select expected.*,
         actual.*,
         (
           expected.ordinal is not null
           and actual.player is not null
           and actual.is_bot
           and actual.profile_rating is not distinct from expected.expected_points
           and actual.instance_id is not distinct from
                 '00000000-0000-0000-0000-000000000000'::uuid
           and actual.aud is not distinct from 'authenticated'
           and actual.role is not distinct from 'authenticated'
           and actual.email is not distinct from
                 'bot-' || actual.player::text || '@internal.invalid'
           and actual.nickname ~ '^[A-Za-z0-9_]{3,16}$'
           and actual.avatar ~ '^die:[1-6]:(cy|mg|gold|green|violet|orange)$'
         ) as canonical
    from expected
    full join actual on actual.points = expected.expected_points
)
select
  (select count(*) from expected)::integer as "expectedRows",
  (select count(*) from actual)::integer as "actualRows",
  (select count(distinct points) from actual)::integer as "actualDistinctPoints",
  count(*)::integer as "joinedRows",
  count(*) filter (where canonical)::integer as "canonicalRows",
  count(*) filter (
    where canonical
      and joined.peak is not distinct from joined.points
      and joined.wins is not distinct from joined.old_wins
      and joined.losses is not distinct from joined.old_losses
      and joined.draws is not distinct from joined.old_draws
      and joined.ranked_pool_tier is not distinct from ${rankedPoolTierSql('joined.points')}
      and joined.best_streak is null
  )::integer as "legacyRows",
  count(*) filter (
    where canonical
      and joined.peak is not distinct from joined.new_peak
      and joined.wins is not distinct from joined.new_wins
      and joined.losses is not distinct from joined.new_losses
      and joined.draws is not distinct from joined.new_draws
      and joined.ranked_pool_tier is not distinct from ${rankedPoolTierSql('joined.new_peak')}
      and joined.best_streak is not distinct from joined.new_best_streak
  )::integer as "refreshedRows",
  (select count(*) from private.season_streak_baselines)::integer as "baselineRows",
  (select count(*)
     from private.season_streak_baselines baseline
     left join public.season_ratings rating
       on rating.season_id = baseline.season_id and rating.player = baseline.player
    where rating.player is null)::integer as "orphanBaselineRows"
from joined;
`;

export function validateRefreshProductionBotProfilesAudit(rows) {
  const row = oneRow(rows, 'Production bot-profile refresh audit');
  assertExactFields(row, REFRESH_AUDIT_FIELDS, 'Production bot-profile refresh audit');
  for (const field of REFRESH_AUDIT_FIELDS) {
    if (!Number.isSafeInteger(row[field]) || row[field] < 0) {
      fail(`Production bot-profile refresh field ${field} must be a non-negative integer.`);
    }
  }
  return Object.freeze({ ...row });
}

/* The ceiling is re-checked inside the locked transaction, so a human account
   created between the preflight audit and the wipe still aborts the standard
   program. Only the separate human-account program omits this guard. */
const WIPE_HUMAN_CEILING_GUARD_SQL = String.raw`  -- Launch guard: the fixed seed plan mints bots only, so any non-bot
  -- profile belongs to a live player and the standard wipe must refuse.
  if (select count(*) from public.profiles where not is_bot)
       > ${PRODUCTION_WIPE_HUMAN_ACCOUNT_CEILING} then
    raise exception 'production account wipe found % human accounts over the test-data ceiling of ${PRODUCTION_WIPE_HUMAN_ACCOUNT_CEILING}',
      (select count(*) from public.profiles where not is_bot);
  end if;
`;

const wipeProductionAccountsSql = humanCeilingGuard => String.raw`
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

lock table auth.users in access exclusive mode;
lock table public.profiles in access exclusive mode;
lock table public.matches in access exclusive mode;

do $guard$
begin
  if (select count(*) from auth.users) <> (select count(*) from public.profiles)
     or exists (select 1 from public.profiles where is_bot is null)
     or exists (
       select 1 from storage.objects object
        where object.owner_id is not null
          and exists (select 1 from auth.users account where account.id::text = object.owner_id)
     ) then
    raise exception 'production account wipe precheck failed';
  end if;
${humanCeilingGuard}  if (select count(*) from public.seasons where ends_at is null) <> 1
     or ${CURRENT_SEASON_SQL} is null then
    raise exception 'production current-season precheck failed';
  end if;
end;
$guard$;

-- The winner FK is NO ACTION, while p1/p2 cascade. Removing matches first is
-- the explicit safe order; every match child cascades from this statement.
delete from public.matches;
-- Profiles and their settings, ratings, queue rows, plus Auth sessions,
-- identities, tokens, and private deletion barriers cascade from this one.
delete from auth.users;
-- These hosted Auth tables hold transient login/authorization state but are
-- not all attached to auth.users by a foreign key. Preserve provider/client
-- configuration and immutable Auth audit logs; remove only transient flows.
delete from auth.saml_relay_states;
delete from auth.flow_state;
delete from auth.oauth_client_states;
-- Current refresh tokens cascade through sessions. This also removes any
-- legacy token whose nullable session_id predates that FK contract.
delete from auth.refresh_tokens;

do $guard$
declare
  relation_name text;
  relation_id regclass;
  remaining bigint;
begin
  if exists (select 1 from auth.users)
     or exists (select 1 from auth.identities)
     or exists (select 1 from auth.sessions)
     or exists (select 1 from auth.refresh_tokens)
     or exists (select 1 from auth.mfa_factors)
     or exists (select 1 from auth.mfa_challenges)
     or exists (select 1 from auth.mfa_amr_claims)
     or exists (select 1 from auth.one_time_tokens)
     or exists (select 1 from auth.oauth_authorizations)
     or exists (select 1 from auth.oauth_consents)
     or exists (select 1 from auth.webauthn_credentials)
     or exists (select 1 from auth.webauthn_challenges)
     or exists (select 1 from auth.flow_state)
     or exists (select 1 from auth.oauth_client_states)
     or exists (select 1 from auth.saml_relay_states)
     or exists (select 1 from public.profiles)
     or exists (select 1 from public.matches)
     or exists (select 1 from public.match_moves)
     or exists (select 1 from public.match_seeds)
     or exists (select 1 from public.matchmaking_queue)
     or exists (select 1 from public.season_ratings)
     or exists (select 1 from public.player_settings)
     or exists (select 1 from private.active_match_players)
     or exists (select 1 from private.deleting_accounts)
     or exists (select 1 from private.match_commands) then
    raise exception 'production account wipe left account or ranked rows';
  end if;

  -- Prove every current direct or indirect FK descendant of auth.users is
  -- empty. The catalog walk makes a future hosted-Auth child table fail closed
  -- even if this helper's named diagnostics have not learned its name yet.
  for relation_id in
    with recursive account_graph(relation_oid, path) as (
      select 'auth.users'::regclass::oid, array['auth.users'::regclass::oid]
      union all
      select constraint_row.conrelid,
             account_graph.path || constraint_row.conrelid
        from account_graph
        join pg_constraint constraint_row
          on constraint_row.contype = 'f'
         and constraint_row.confrelid = account_graph.relation_oid
       where not constraint_row.conrelid = any(account_graph.path)
    )
    select distinct relation_oid::regclass
      from account_graph
     where relation_oid <> 'auth.users'::regclass::oid
  loop
    execute format('select count(*) from %s', relation_id) into remaining;
    if remaining <> 0 then
      raise exception 'production account wipe left FK-owned rows in %', relation_id;
    end if;
  end loop;

  foreach relation_name in array array[
    'public.player_runes',
    'public.match_actions',
    'private.rune_trial_choices',
    'private.rune_trial_selection_commands',
    'private.match_action_commands',
    'private.season_streak_baselines'
  ] loop
    relation_id := to_regclass(relation_name);
    if relation_id is not null then
      execute format('select count(*) from %s', relation_id) into remaining;
      if remaining <> 0 then
        raise exception 'production account wipe left rows in %', relation_name;
      end if;
    end if;
  end loop;

  if (select count(*) from public.seasons where ends_at is null) <> 1
     or ${CURRENT_SEASON_SQL} is null then
    raise exception 'production account wipe damaged season reference data';
  end if;
end;
$guard$;

commit;
`;

export const WIPE_PRODUCTION_ACCOUNTS_SQL = wipeProductionAccountsSql(WIPE_HUMAN_CEILING_GUARD_SQL);
/* Identical transaction without the ceiling guard. The executor accepts it as
   a fixed program, but the orchestration selects it only when the audit shows
   humans over the ceiling AND the distinct PRODUCTION_HUMAN_WIPE_OPT_IN
   literal is present. */
export const WIPE_PRODUCTION_HUMAN_ACCOUNTS_SQL = wipeProductionAccountsSql('');

export const SEED_PRODUCTION_BOTS_SQL = String.raw`
begin;
set local lock_timeout = '10s';
set local statement_timeout = '90s';

lock table auth.users in access exclusive mode;
lock table public.profiles in access exclusive mode;
lock table public.matches in access exclusive mode;
lock table public.season_ratings in access exclusive mode;

do $seed$
declare
  seed_row record;
  bot_id uuid;
  current_season_id smallint;
begin
  if not exists (
       select 1 from supabase_migrations.schema_migrations
        where version = '20260825205241' and name = 'rune_trial_ranked_v2'
     )
     or not exists (
       select 1 from supabase_migrations.schema_migrations
        where version = '20260826153000' and name = 'ladder_streak_baselines'
     )
     or to_regclass('public.player_runes') is null
     or to_regclass('public.match_actions') is null
     or to_regclass('private.rune_trial_choices') is null
     or to_regclass('private.rune_trial_selection_commands') is null
     or to_regclass('private.match_action_commands') is null
     or to_regclass('private.season_streak_baselines') is null
     or to_regprocedure('private.ranked_pool_tier_for_peak(integer)') is null then
    raise exception 'Rune Trial and streak-baseline migrations must be complete before bot seeding';
  end if;

  if exists (select 1 from auth.users)
     or exists (select 1 from public.profiles)
     or exists (select 1 from public.matches)
     or exists (select 1 from public.match_moves)
     or exists (select 1 from public.match_seeds)
     or exists (select 1 from public.matchmaking_queue)
     or exists (select 1 from public.season_ratings)
     or exists (select 1 from public.player_settings)
     or exists (select 1 from public.player_runes)
     or exists (select 1 from public.match_actions)
     or exists (select 1 from private.active_match_players)
     or exists (select 1 from private.deleting_accounts)
     or exists (select 1 from private.match_commands)
     or exists (select 1 from private.rune_trial_choices)
     or exists (select 1 from private.rune_trial_selection_commands)
     or exists (select 1 from private.match_action_commands)
     or exists (select 1 from private.season_streak_baselines) then
    raise exception 'production must contain no accounts or ranked rows before bot seeding';
  end if;

  if (select count(*) from public.seasons where ends_at is null) <> 1 then
    raise exception 'production must have exactly one current season';
  end if;
  current_season_id := ${CURRENT_SEASON_SQL};
  if current_season_id is null then raise exception 'production current season is missing'; end if;

  for seed_row in
    select * from (values
      ${SEED_VALUES}
    ) as seed(ordinal, points, peak, wins, losses, draws, best_streak)
    order by ordinal
  loop
    bot_id := public.mint_bot(seed_row.points);
    if bot_id is null then raise exception 'mint_bot returned null at ordinal %', seed_row.ordinal; end if;

    insert into public.season_ratings (
      season_id, player, points, peak, wins, losses, draws
    ) values (
      current_season_id, bot_id, seed_row.points, seed_row.peak,
      seed_row.wins, seed_row.losses, seed_row.draws
    );

    insert into private.season_streak_baselines (
      season_id, player, best_streak
    ) values (
      current_season_id, bot_id, seed_row.best_streak
    );

    update public.profiles
       set rating = seed_row.points,
           ranked_pool_tier = ${rankedPoolTierSql('seed_row.peak')}
     where id = bot_id and is_bot = true;
    if not found then raise exception 'minted bot profile is invalid at ordinal %', seed_row.ordinal; end if;
  end loop;

  if (select count(*) from auth.users) <> ${PRODUCTION_BOT_COUNT}
     or (select count(*) from public.profiles) <> ${PRODUCTION_BOT_COUNT}
     or (select count(*) from public.profiles where is_bot) <> ${PRODUCTION_BOT_COUNT}
     or exists (select 1 from public.profiles where not is_bot)
     or (select count(*) from public.season_ratings where season_id = current_season_id) <> ${PRODUCTION_BOT_COUNT}
     or (select count(distinct points) from public.season_ratings where season_id = current_season_id) <> ${PRODUCTION_BOT_COUNT}
     or (select min(points) from public.season_ratings where season_id = current_season_id) <> 0
     or (select max(points) from public.season_ratings where season_id = current_season_id) <> 4600
     or (select count(*) from private.season_streak_baselines where season_id = current_season_id) <> ${PRODUCTION_BOT_COUNT} then
    raise exception 'production bot seed cardinality or point spread is invalid';
  end if;

  if exists (select 1 from auth.identities)
     or exists (select 1 from auth.sessions)
     or exists (select 1 from auth.refresh_tokens)
     or exists (select 1 from auth.mfa_factors)
     or exists (select 1 from auth.mfa_challenges)
     or exists (select 1 from auth.mfa_amr_claims)
     or exists (select 1 from auth.one_time_tokens)
     or exists (select 1 from auth.oauth_authorizations)
     or exists (select 1 from auth.oauth_consents)
     or exists (select 1 from auth.webauthn_credentials)
     or exists (select 1 from auth.webauthn_challenges)
     or exists (select 1 from auth.flow_state)
     or exists (select 1 from auth.oauth_client_states)
     or exists (select 1 from auth.saml_relay_states)
     or exists (select 1 from public.matches)
     or exists (select 1 from public.match_moves)
     or exists (select 1 from public.match_seeds)
     or exists (select 1 from public.matchmaking_queue)
     or exists (select 1 from public.player_settings)
     or exists (select 1 from public.player_runes)
     or exists (select 1 from public.match_actions)
     or exists (select 1 from private.active_match_players)
     or exists (select 1 from private.deleting_accounts)
     or exists (select 1 from private.match_commands)
     or exists (select 1 from private.rune_trial_choices)
     or exists (select 1 from private.rune_trial_selection_commands)
     or exists (select 1 from private.match_action_commands) then
    raise exception 'production bot seed created unexpected Auth or ranked rows';
  end if;

  if exists (
    select 1
      from public.profiles profile
      join auth.users account on account.id = profile.id
      join public.season_ratings rating
        on rating.player = profile.id and rating.season_id = current_season_id
      join private.season_streak_baselines baseline
        on baseline.player = rating.player and baseline.season_id = rating.season_id
     where account.instance_id is distinct from '00000000-0000-0000-0000-000000000000'::uuid
        or account.aud is distinct from 'authenticated'
        or account.role is distinct from 'authenticated'
        or account.email is distinct from 'bot-' || account.id::text || '@internal.invalid'
        or profile.rating is distinct from rating.points
        or rating.peak < rating.points
        or rating.peak - rating.points > ${PRODUCTION_BOT_MAX_PEAK_GAP}
        or profile.ranked_pool_tier is distinct from ${rankedPoolTierSql('rating.peak')}
        or profile.nickname !~ '^[A-Za-z0-9_]{3,16}$'
        or profile.avatar !~ '^die:[1-6]:(cy|mg|gold|green|violet|orange)$'
        or rating.wins < 1 or rating.losses < 1 or rating.draws < 0
        or rating.wins + rating.losses + rating.draws < 16
        or rating.wins::numeric / (rating.wins + rating.losses + rating.draws)
             not between ${PRODUCTION_BOT_MIN_WIN_RATE} and ${PRODUCTION_BOT_MAX_WIN_RATE}
        or baseline.best_streak < ${PRODUCTION_BOT_MIN_BEST_STREAK}
        or baseline.best_streak > ${PRODUCTION_BOT_MAX_BEST_STREAK}
        or baseline.best_streak > rating.wins
  ) then
    raise exception 'production bot seed row contract is invalid';
  end if;

  if not exists (select 1 from public.season_ratings where points >= 0 and points < 300)
     or not exists (select 1 from public.season_ratings where points >= 300 and points < 720)
     or not exists (select 1 from public.season_ratings where points >= 720 and points < 1260)
     or not exists (select 1 from public.season_ratings where points >= 1260 and points < 2010)
     or not exists (select 1 from public.season_ratings where points >= 2010 and points < 3000)
     or not exists (select 1 from public.season_ratings where points >= 3000 and points < 4350)
     or not exists (select 1 from public.season_ratings where points >= 4350) then
    raise exception 'production bot seed misses a ladder group';
  end if;

  if (select count(*) from public.season_ratings where peak = points) <> ${PRODUCTION_BOT_COUNT / 2}
     or (select count(*) from public.season_ratings where peak > points) <> ${PRODUCTION_BOT_COUNT / 2}
     or (select max(peak - points) from public.season_ratings) > ${PRODUCTION_BOT_MAX_PEAK_GAP}
     or (select max(best_streak) from private.season_streak_baselines)
          > ${PRODUCTION_BOT_MAX_BEST_STREAK} then
    raise exception 'production bot seed peak or streak distribution is invalid';
  end if;
end;
$seed$;

commit;
`;

export const REFRESH_PRODUCTION_BOT_PROFILES_SQL = String.raw`
begin;
set local lock_timeout = '10s';
set local statement_timeout = '90s';

lock table auth.users in access exclusive mode;
lock table public.profiles in access exclusive mode;
lock table public.matches in access exclusive mode;
lock table public.season_ratings in access exclusive mode;
lock table public.matchmaking_queue in access exclusive mode;
lock table public.player_settings in access exclusive mode;
lock table public.player_runes in access exclusive mode;
lock table public.match_actions in access exclusive mode;
lock table private.season_streak_baselines in access exclusive mode;

create temporary table kb_bot_profile_refresh_plan (
  ordinal integer primary key,
  points integer unique not null,
  old_wins integer not null,
  old_losses integer not null,
  old_draws integer not null,
  new_peak integer not null,
  new_wins integer not null,
  new_losses integer not null,
  new_draws integer not null,
  new_best_streak integer not null
) on commit drop;

insert into kb_bot_profile_refresh_plan values
      ${REFRESH_VALUES};

do $refresh$
declare
  current_season_id smallint;
  canonical_rows integer;
  legacy_rows integer;
  refreshed_rows integer;
  affected_rows integer;
begin
  if not exists (
       select 1 from supabase_migrations.schema_migrations
        where version = '20260825205241' and name = 'rune_trial_ranked_v2'
     )
     or not exists (
       select 1 from supabase_migrations.schema_migrations
        where version = '20260826153000' and name = 'ladder_streak_baselines'
     )
     or to_regclass('private.season_streak_baselines') is null then
    raise exception 'required production migrations are incomplete before bot-profile refresh';
  end if;

  if (select count(*) from public.seasons where ends_at is null) <> 1 then
    raise exception 'production must have exactly one current season';
  end if;
  current_season_id := ${CURRENT_SEASON_SQL};
  if current_season_id is null then raise exception 'production current season is missing'; end if;

  if (select count(*) from kb_bot_profile_refresh_plan) <> ${PRODUCTION_BOT_COUNT}
     or (select count(*) from auth.users) <> ${PRODUCTION_BOT_COUNT}
     or (select count(*) from public.profiles) <> ${PRODUCTION_BOT_COUNT}
     or (select count(*) from public.profiles where is_bot) <> ${PRODUCTION_BOT_COUNT}
     or exists (select 1 from public.profiles where not is_bot)
     or (select count(*) from public.season_ratings) <> ${PRODUCTION_BOT_COUNT}
     or (select count(*) from public.season_ratings where season_id = current_season_id) <> ${PRODUCTION_BOT_COUNT}
     or (select count(distinct points) from public.season_ratings) <> ${PRODUCTION_BOT_COUNT} then
    raise exception format('production bot-profile refresh requires the exact %s-bot population', ${PRODUCTION_BOT_COUNT});
  end if;

  if exists (select 1 from auth.identities)
     or exists (select 1 from auth.sessions)
     or exists (select 1 from auth.refresh_tokens)
     or exists (select 1 from auth.mfa_factors)
     or exists (select 1 from auth.mfa_challenges)
     or exists (select 1 from auth.mfa_amr_claims)
     or exists (select 1 from auth.one_time_tokens)
     or exists (select 1 from auth.oauth_authorizations)
     or exists (select 1 from auth.oauth_consents)
     or exists (select 1 from auth.webauthn_credentials)
     or exists (select 1 from auth.webauthn_challenges)
     or exists (select 1 from auth.flow_state)
     or exists (select 1 from auth.oauth_client_states)
     or exists (select 1 from auth.saml_relay_states)
     or exists (select 1 from public.matches)
     or exists (select 1 from public.match_moves)
     or exists (select 1 from public.match_seeds)
     or exists (select 1 from public.matchmaking_queue)
     or exists (select 1 from public.player_settings)
     or exists (select 1 from public.player_runes)
     or exists (select 1 from public.match_actions)
     or exists (select 1 from private.active_match_players)
     or exists (select 1 from private.deleting_accounts)
     or exists (select 1 from private.match_commands)
     or exists (select 1 from private.rune_trial_choices)
     or exists (select 1 from private.rune_trial_selection_commands)
     or exists (select 1 from private.match_action_commands)
     or exists (
       select 1 from storage.objects object
        where object.owner_id is not null
          and exists (select 1 from auth.users account where account.id::text = object.owner_id)
     ) then
    raise exception 'production bot-profile refresh refuses accounts with real activity or owned data';
  end if;

  select count(*) into canonical_rows
    from kb_bot_profile_refresh_plan plan
    join public.season_ratings rating
      on rating.season_id = current_season_id and rating.points = plan.points
    join public.profiles profile on profile.id = rating.player
    join auth.users account on account.id = profile.id
   where profile.is_bot
     and profile.rating is not distinct from rating.points
     and account.instance_id is not distinct from
           '00000000-0000-0000-0000-000000000000'::uuid
     and account.aud is not distinct from 'authenticated'
     and account.role is not distinct from 'authenticated'
     and account.email is not distinct from
           'bot-' || account.id::text || '@internal.invalid'
     and profile.nickname ~ '^[A-Za-z0-9_]{3,16}$'
     and profile.avatar ~ '^die:[1-6]:(cy|mg|gold|green|violet|orange)$';
  if canonical_rows <> ${PRODUCTION_BOT_COUNT} then
    raise exception 'production bot-profile refresh canonical identity or point plan is invalid';
  end if;

  select count(*) into legacy_rows
    from kb_bot_profile_refresh_plan plan
    join public.season_ratings rating
      on rating.season_id = current_season_id and rating.points = plan.points
    join public.profiles profile on profile.id = rating.player
    left join private.season_streak_baselines baseline
      on baseline.season_id = rating.season_id and baseline.player = rating.player
   where rating.peak is not distinct from rating.points
     and rating.wins is not distinct from plan.old_wins
     and rating.losses is not distinct from plan.old_losses
     and rating.draws is not distinct from plan.old_draws
     and profile.ranked_pool_tier is not distinct from ${rankedPoolTierSql('rating.points')}
     and baseline.player is null;

  select count(*) into refreshed_rows
    from kb_bot_profile_refresh_plan plan
    join public.season_ratings rating
      on rating.season_id = current_season_id and rating.points = plan.points
    join public.profiles profile on profile.id = rating.player
    join private.season_streak_baselines baseline
      on baseline.season_id = rating.season_id and baseline.player = rating.player
   where rating.peak is not distinct from plan.new_peak
     and rating.wins is not distinct from plan.new_wins
     and rating.losses is not distinct from plan.new_losses
     and rating.draws is not distinct from plan.new_draws
     and profile.ranked_pool_tier is not distinct from ${rankedPoolTierSql('plan.new_peak')}
     and baseline.best_streak is not distinct from plan.new_best_streak;

  if not ((legacy_rows = ${PRODUCTION_BOT_COUNT}
           and (select count(*) from private.season_streak_baselines) = 0)
          or (refreshed_rows = ${PRODUCTION_BOT_COUNT}
              and (select count(*) from private.season_streak_baselines) = ${PRODUCTION_BOT_COUNT})) then
    raise exception 'production bot profiles are neither the exact legacy seed nor exact refreshed seed';
  end if;

  update public.season_ratings rating
     set peak = plan.new_peak,
         wins = plan.new_wins,
         losses = plan.new_losses,
         draws = plan.new_draws
    from kb_bot_profile_refresh_plan plan
   where rating.season_id = current_season_id and rating.points = plan.points;
  get diagnostics affected_rows = row_count;
  if affected_rows <> ${PRODUCTION_BOT_COUNT} then raise exception 'bot rating refresh touched % rows', affected_rows; end if;

  update public.profiles profile
     set ranked_pool_tier = ${rankedPoolTierSql('plan.new_peak')}
    from public.season_ratings rating
    join kb_bot_profile_refresh_plan plan on plan.points = rating.points
   where rating.season_id = current_season_id and profile.id = rating.player;
  get diagnostics affected_rows = row_count;
  if affected_rows <> ${PRODUCTION_BOT_COUNT} then raise exception 'bot tier refresh touched % rows', affected_rows; end if;

  insert into private.season_streak_baselines (season_id, player, best_streak)
  select rating.season_id, rating.player, plan.new_best_streak
    from public.season_ratings rating
    join kb_bot_profile_refresh_plan plan on plan.points = rating.points
   where rating.season_id = current_season_id
  on conflict (season_id, player) do update
    set best_streak = excluded.best_streak;
  get diagnostics affected_rows = row_count;
  if affected_rows <> ${PRODUCTION_BOT_COUNT} then raise exception 'bot streak refresh touched % rows', affected_rows; end if;

  if (select count(*)
        from kb_bot_profile_refresh_plan plan
        join public.season_ratings rating
          on rating.season_id = current_season_id and rating.points = plan.points
        join public.profiles profile on profile.id = rating.player
        join private.season_streak_baselines baseline
          on baseline.season_id = rating.season_id and baseline.player = rating.player
       where rating.peak is not distinct from plan.new_peak
         and rating.wins is not distinct from plan.new_wins
         and rating.losses is not distinct from plan.new_losses
         and rating.draws is not distinct from plan.new_draws
         and profile.rating is not distinct from rating.points
         and profile.ranked_pool_tier is not distinct from ${rankedPoolTierSql('plan.new_peak')}
         and baseline.best_streak is not distinct from plan.new_best_streak) <> ${PRODUCTION_BOT_COUNT}
     or (select count(*) from private.season_streak_baselines) <> ${PRODUCTION_BOT_COUNT}
     or exists (select 1 from public.matches) then
    raise exception 'production bot-profile refresh postcheck failed';
  end if;
end;
$refresh$;

commit;
`;

export function assertProductionBotSeedComplete(audit) {
  const base = Object.fromEntries(BASE_AUDIT_FIELDS.map(field => [field, audit[field]]));
  assertAccountGraphConsistent(base);
  const exact = {
    authUsers: PRODUCTION_BOT_COUNT,
    profiles: PRODUCTION_BOT_COUNT,
    bots: PRODUCTION_BOT_COUNT,
    humans: 0,
    seasonRatings: PRODUCTION_BOT_COUNT,
    authIdentities: 0,
    authSessions: 0,
    authRefreshTokens: 0,
    authMfaFactors: 0,
    authMfaChallenges: 0,
    authMfaAmrClaims: 0,
    authOneTimeTokens: 0,
    authOauthAuthorizations: 0,
    authOauthConsents: 0,
    authWebauthnCredentials: 0,
    authWebauthnChallenges: 0,
    authFlowStates: 0,
    authOauthClientStates: 0,
    authSamlRelayStates: 0,
    matches: 0,
    activeMatches: 0,
    matchMoves: 0,
    matchSeeds: 0,
    queueRows: 0,
    playerSettings: 0,
    activeSeats: 0,
    deletingAccounts: 0,
    matchCommands: 0,
    authOwnedStorageObjects: 0,
    authWithoutProfile: 0,
    profileWithoutAuth: 0,
    playerRunes: 0,
    matchActions: 0,
    runeTrialChoices: 0,
    runeSelectionCommands: 0,
    matchActionCommands: 0,
    invalidBotRows: 0,
    missingSeasonRows: 0,
    inconsistentRatingRows: 0,
    inconsistentTierRows: 0,
    invalidStatsRows: 0,
    streakBaselines: PRODUCTION_BOT_COUNT,
    orphanStreakBaselines: 0,
    distinctPoints: PRODUCTION_BOT_COUNT,
    minPoints: 0,
    maxPoints: PRODUCTION_BOT_MAX_POINTS,
    atPeakBots: PRODUCTION_BOT_COUNT / 2,
    peakAheadBots: PRODUCTION_BOT_COUNT / 2,
    maxPeakGap: Math.max(...PRODUCTION_BOT_SEED_PLAN.map(row => row.peak - row.points)),
    distinctBestStreaks: new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.bestStreak)).size,
    minBestStreak: Math.min(...PRODUCTION_BOT_SEED_PLAN.map(row => row.bestStreak)),
    maxBestStreak: Math.max(...PRODUCTION_BOT_SEED_PLAN.map(row => row.bestStreak)),
    minGames: Math.min(...PRODUCTION_BOT_SEED_PLAN.map(
      row => row.wins + row.losses + row.draws,
    )),
    maxGames: Math.max(...PRODUCTION_BOT_SEED_PLAN.map(
      row => row.wins + row.losses + row.draws,
    )),
    totalGames: PRODUCTION_BOT_SEED_PLAN.reduce(
      (total, row) => total + row.wins + row.losses + row.draws,
      0,
    ),
    minWinRateBps: Math.floor(Math.min(...PRODUCTION_BOT_SEED_PLAN.map(
      row => (row.wins * 10000) / (row.wins + row.losses + row.draws),
    ))),
    maxWinRateBps: Math.floor(Math.max(...PRODUCTION_BOT_SEED_PLAN.map(
      row => (row.wins * 10000) / (row.wins + row.losses + row.draws),
    ))),
  };
  for (const [field, expected] of Object.entries(exact)) {
    if (audit[field] !== expected) fail(`Production bot seed ${field}=${audit[field]}; expected ${expected}.`);
  }
  for (const field of ['stoneBots', 'boneBots', 'ivoryBots', 'silverBots',
    'goldBots', 'obsidianBots', 'neonPointBots']) {
    if (audit[field] < 1) fail(`Production bot seed left ${field} empty.`);
  }
  if (audit.distinctWins < 100 || audit.distinctLosses < 100 || audit.distinctDraws < 10) {
    fail('Production bot records are not plausibly varied.');
  }
  return audit;
}

const ZERO_FOR_UNPLAYED_BOT_REFRESH = Object.freeze([
  'authIdentities', 'authSessions', 'authRefreshTokens', 'authMfaFactors',
  'authMfaChallenges', 'authMfaAmrClaims', 'authOneTimeTokens',
  'authOauthAuthorizations', 'authOauthConsents', 'authWebauthnCredentials',
  'authWebauthnChallenges', 'authFlowStates', 'authOauthClientStates',
  'authSamlRelayStates', 'humans', 'matches', 'activeMatches', 'matchMoves',
  'matchSeeds', 'queueRows', 'playerSettings', 'activeSeats', 'deletingAccounts',
  'matchCommands', 'authOwnedStorageObjects', 'authWithoutProfile',
  'profileWithoutAuth',
]);

export function assertProductionBotProfilesRefreshable(baseAudit, runeAudit, refreshAudit) {
  assertAccountGraphConsistent(baseAudit);
  if (baseAudit.authUsers !== PRODUCTION_BOT_COUNT
      || baseAudit.profiles !== PRODUCTION_BOT_COUNT
      || baseAudit.bots !== PRODUCTION_BOT_COUNT
      || baseAudit.seasonRatings !== PRODUCTION_BOT_COUNT) {
    fail(`Production bot-profile refresh requires exactly ${PRODUCTION_BOT_COUNT} Auth/profile/current-season bots.`);
  }
  for (const field of ZERO_FOR_UNPLAYED_BOT_REFRESH) {
    if (baseAudit[field] !== 0) {
      fail(`Production bot-profile refresh requires ${field}=0; received ${baseAudit[field]}.`);
    }
  }
  for (const field of RUNE_EMPTY_FIELDS) {
    if (runeAudit[field] !== 0) {
      fail(`Production bot-profile refresh requires ${field}=0; received ${runeAudit[field]}.`);
    }
  }
  if (refreshAudit.expectedRows !== PRODUCTION_BOT_COUNT
      || refreshAudit.actualRows !== PRODUCTION_BOT_COUNT
      || refreshAudit.actualDistinctPoints !== PRODUCTION_BOT_COUNT
      || refreshAudit.joinedRows !== PRODUCTION_BOT_COUNT
      || refreshAudit.canonicalRows !== PRODUCTION_BOT_COUNT
      || refreshAudit.orphanBaselineRows !== 0) {
    fail(`Production bot-profile refresh does not match the canonical ${PRODUCTION_BOT_COUNT}-point plan.`);
  }
  if (refreshAudit.legacyRows === PRODUCTION_BOT_COUNT
      && refreshAudit.refreshedRows === 0
      && refreshAudit.baselineRows === 0) return 'legacy';
  if (refreshAudit.refreshedRows === PRODUCTION_BOT_COUNT
      && refreshAudit.legacyRows === 0
      && refreshAudit.baselineRows === PRODUCTION_BOT_COUNT) return 'refreshed';
  fail('Production bot profiles are neither the exact legacy seed nor exact refreshed seed.');
}
