import assert from 'node:assert/strict';
import {
  BASE_PRODUCTION_TEST_DATA_AUDIT_SQL,
  EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL,
  LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL,
  PRODUCTION_BOT_SEED_PLAN,
  PRODUCTION_TEST_DATA_OPT_INS,
  REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL,
  REFRESH_PRODUCTION_BOT_PROFILES_SQL,
  RUNE_TRIAL_PRODUCTION_STAGE_SQL,
  SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL,
  SEED_PRODUCTION_BOTS_SQL,
  assertProductionBotSeedComplete,
  assertProductionBotProfilesRefreshable,
  validateBaseProductionTestDataAudit,
  validateEmptyRuneTrialDataAudit,
  validateLadderStreakBaselineProductionStage,
  validateRefreshProductionBotProfilesAudit,
  validateSeededProductionTestDataAudit,
} from '../../tools/database/production-test-data-core.mjs';
import {
  auditExactBotSeedProduction,
  auditExactLadderStreakBaselineProduction,
  rolloutProductionTestData,
} from '../../tools/database/production-test-data.mjs';
import {
  LADDER_STREAK_BASELINES_DATA,
  LADDER_STREAK_BASELINES_SCHEMA,
  RUNE_TRIAL_FUNCTIONS,
  RUNE_TRIAL_JOB,
  RUNE_TRIAL_POST_APPLY_DATA,
  RUNE_TRIAL_SCHEMA,
} from '../../tools/database/production-rollout.mjs';
import {
  baseAudit,
  emptyRune,
  refreshAudit,
  runeStage,
  seededAudit,
  streakBaselineStage,
} from './production-test-data-cases.ts';

type GuardedAssertion = (run: () => unknown, pattern: RegExp) => void;

export function assertRealisticBotSeedPlan() {
  assert.equal(PRODUCTION_BOT_SEED_PLAN.length, 150);
  assert.equal(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.points)).size, 150);
  assert.equal(PRODUCTION_BOT_SEED_PLAN[0].points, 0);
  assert.equal(PRODUCTION_BOT_SEED_PLAN.at(-1)?.points, 4600);
  assert.ok(PRODUCTION_BOT_SEED_PLAN.every((row, index) => row.ordinal === index + 1));
  assert.ok(PRODUCTION_BOT_SEED_PLAN.every((row) => {
    const games = row.wins + row.losses + row.draws;
    const winRate = row.wins / games;
    return row.wins > 0 && row.losses > 0 && row.draws >= 0
      && games >= 16 && winRate >= 0.4 && winRate <= 0.55
      && row.peak >= row.points && row.peak - row.points <= 180
      && row.bestStreak >= 2 && row.bestStreak <= 7 && row.bestStreak <= row.wins;
  }));
  assert.equal(Math.min(...PRODUCTION_BOT_SEED_PLAN.map(
    row => row.wins + row.losses + row.draws,
  )), 18);
  assert.equal(Math.max(...PRODUCTION_BOT_SEED_PLAN.map(
    row => row.wins + row.losses + row.draws,
  )), 410);
  assert.equal(PRODUCTION_BOT_SEED_PLAN.reduce(
    (sum, row) => sum + row.wins + row.losses + row.draws,
    0,
  ), 32736);
  assert.equal(PRODUCTION_BOT_SEED_PLAN.filter(row => row.peak === row.points).length, 75);
  assert.equal(PRODUCTION_BOT_SEED_PLAN.filter(row => row.peak > row.points).length, 75);
  assert.equal(Math.max(...PRODUCTION_BOT_SEED_PLAN.map(row => row.peak - row.points)), 170);
  assert.equal(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.wins)).size, 106);
  assert.equal(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.losses)).size, 105);
  assert.equal(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.draws)).size, 11);
  assert.equal(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.bestStreak)).size, 6);
  const rates = PRODUCTION_BOT_SEED_PLAN.map(
    row => row.wins / (row.wins + row.losses + row.draws),
  );
  assert.equal(Math.min(...rates), 12 / 29);
  assert.equal(Math.max(...rates), 208 / 387);
  for (const [min, max] of [[0, 300], [300, 720], [720, 1260], [1260, 2010],
    [2010, 3000], [3000, 4350], [4350, Number.POSITIVE_INFINITY]]) {
    assert.ok(PRODUCTION_BOT_SEED_PLAN.some(row => row.points >= min && row.points < max));
  }
}

export function assertBotSeedSql() {
  assert.doesNotMatch(
    SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL,
    /public\.player_card\s*\(/,
    'management read-only audits must not execute the player-facing RPC',
  );
  assert.match(SEED_PRODUCTION_BOTS_SQL, /^\s*begin;/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /commit;\s*$/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /public\.mint_bot\(seed_row\.points\)/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /insert into public\.season_ratings/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /insert into private\.season_streak_baselines/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /20260826153000.*ladder_streak_baselines/s);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /ranked_pool_tier = \(case/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /count\(distinct points\).*<> 150/s);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /max\(points\).*<> 4600/s);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /seed created unexpected Auth or ranked rows/);
  assert.doesNotMatch(SEED_PRODUCTION_BOTS_SQL, /public\.current_season\(\)/);
  assert.doesNotMatch(SEED_PRODUCTION_BOTS_SQL, /private\.ranked_pool_tier_for_peak\((?:rating|seed_row)/);
  assert.doesNotMatch(SEED_PRODUCTION_BOTS_SQL, /generate_series|\btruncate\b/i);
  assert.equal((SEED_PRODUCTION_BOTS_SQL.match(
    /^\s*\(\d+, \d+, \d+, \d+, \d+, \d+, \d+\),?$/gm,
  ) ?? []).length, 150);
}

export function assertBotProfileRefreshSql() {
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /^\s*begin;/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /commit;\s*$/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /lock_timeout = '10s'/);
  assert.match(
    REFRESH_PRODUCTION_BOT_PROFILES_SQL,
    /select (?:count\(\*\)|1) from public\.matches/,
  );
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /legacy_rows = 150/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /refreshed_rows = 150/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /update public\.season_ratings/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /update public\.profiles/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /on conflict \(season_id, player\) do update/);
  assert.doesNotMatch(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /\bdelete\b|\btruncate\b/i);
  assert.equal((REFRESH_PRODUCTION_BOT_PROFILES_SQL.match(
    /^\s*\(\d+, \d+, \d+, \d+, \d+, \d+, \d+, \d+, \d+, \d+\)[,;]?$/gm,
  ) ?? []).length, 150);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL, /full join actual/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL, /"actualDistinctPoints"/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL, /"joinedRows"/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL, /"legacyRows"/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL, /"refreshedRows"/);
}

export function assertStreakBaselineStage(guarded: GuardedAssertion) {
  assert.equal(validateLadderStreakBaselineProductionStage([
    streakBaselineStage(false),
  ]), 0);
  assert.equal(validateLadderStreakBaselineProductionStage([
    streakBaselineStage(true),
  ]), 1);
  guarded(() => validateLadderStreakBaselineProductionStage([
    streakBaselineStage(false, { baselineTable: true }),
  ]), /partial/);
}

export function assertExactSeedAudit(guarded: GuardedAssertion) {
  const audit = validateSeededProductionTestDataAudit([seededAudit()]);
  assert.equal(assertProductionBotSeedComplete(audit), audit);
  guarded(() => assertProductionBotSeedComplete({ ...audit, humans: 1, bots: 149 }), /bots=149|ownership graph/);
  guarded(() => assertProductionBotSeedComplete({ ...audit, playerRunes: 1 }), /playerRunes/);
  guarded(() => assertProductionBotSeedComplete({ ...audit, neonPointBots: 0 }), /neonPointBots/);
  guarded(() => assertProductionBotSeedComplete({ ...audit, maxWinRateBps: 5600 }), /maxWinRateBps/);
}

export function assertRefreshAudit(guarded: GuardedAssertion) {
  const base = validateBaseProductionTestDataAudit([baseAudit({
    authUsers: 150, profiles: 150, bots: 150, seasonRatings: 150,
  })]);
  const rune = validateEmptyRuneTrialDataAudit([emptyRune()]);
  const legacy = validateRefreshProductionBotProfilesAudit([refreshAudit('legacy')]);
  const refreshed = validateRefreshProductionBotProfilesAudit([refreshAudit('refreshed')]);
  assert.equal(assertProductionBotProfilesRefreshable(base, rune, legacy), 'legacy');
  assert.equal(assertProductionBotProfilesRefreshable(base, rune, refreshed), 'refreshed');
  guarded(() => assertProductionBotProfilesRefreshable(
    base, rune, { ...legacy, canonicalRows: 149 },
  ), /canonical/);
  guarded(() => assertProductionBotProfilesRefreshable(
    base, rune, { ...refreshed, actualDistinctPoints: 149, joinedRows: 151 },
  ), /canonical/);
  guarded(() => assertProductionBotProfilesRefreshable(
    { ...base, matches: 1 }, rune, legacy,
  ), /matches=0/);
  guarded(() => assertProductionBotProfilesRefreshable(
    base, rune, { ...legacy, legacyRows: 149 },
  ), /neither/);
}

export async function assertExactStreakBaselinePrerequisite() {
  const responses = new Map<string, unknown[]>([
    [LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL, [streakBaselineStage(true)]],
    [LADDER_STREAK_BASELINES_SCHEMA, [{
      table_exists: true,
      table_columns: true,
      table_primary_key: true,
      table_rating_foreign_key: true,
      table_check: true,
      table_comment: true,
      table_owner: true,
      table_grants: true,
      player_card_contract: true,
      player_card_body: true,
      player_card_grants: true,
      best_streak_delegate: true,
    }]],
    [LADDER_STREAK_BASELINES_DATA, [{
      baseline_count: '0', baselines_valid: true,
    }]],
  ]);
  const read = async (query: string) => {
    const rows = responses.get(query);
    if (!rows) throw new Error('unexpected query');
    return rows;
  };
  const exact = await auditExactLadderStreakBaselineProduction(read);
  assert.equal(exact.ledgerStage, 1);
  const combined = await auditExactBotSeedProduction(async (query) => {
    if (responses.has(query)) return responses.get(query)!;
    if (query === RUNE_TRIAL_PRODUCTION_STAGE_SQL) return [runeStage(true)];
    if (query === RUNE_TRIAL_SCHEMA) return [{
      cron_extension: true,
      profile_progression: true,
      match_protocol: true,
      queue_protocol: true,
      player_runes_table: true,
      match_actions_table: true,
      private_tables: true,
      indexes: true,
      policies: true,
      table_grants: true,
      private_tables_locked: true,
      realtime_publication: true,
    }];
    if (query === RUNE_TRIAL_FUNCTIONS) return [{
      function_contracts: true, function_bodies: true, function_grants: true,
    }];
    if (query === RUNE_TRIAL_JOB) return [{ cron_job: true, cron_job_contract: true }];
    if (query === RUNE_TRIAL_POST_APPLY_DATA) return [{
      profile_backfill: true, legacy_matches: true, legacy_queue: true, new_tables_empty: true,
    }];
    throw new Error('unexpected combined query');
  });
  assert.equal(combined.ledgerStage, 1);
}

export async function assertBotProfileRefreshOrchestration() {
  const populated = baseAudit({
    authUsers: 150, profiles: 150, bots: 150, seasonRatings: 150,
  });
  const readFor = (state: 'legacy' | 'refreshed') => async (query: string) => {
    if (query === RUNE_TRIAL_PRODUCTION_STAGE_SQL) return [runeStage(true)];
    if (query === LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL) {
      return [streakBaselineStage(true)];
    }
    if (query === BASE_PRODUCTION_TEST_DATA_AUDIT_SQL) return [populated];
    if (query === EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL) return [emptyRune()];
    if (query === REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL) return [refreshAudit(state)];
    if (query === SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL) return [seededAudit()];
    throw new Error('unexpected query');
  };
  const executed: string[] = [];
  let exactChecks = 0;
  const result = await rolloutProductionTestData({
    phase: 'refresh-bot-profiles',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS['refresh-bot-profiles'].value,
    read: readFor('legacy'),
    verifyEnvironment: () => {},
    exactBotSeedPrerequisite: async () => { exactChecks++; return { ledgerStage: 1 }; },
    execute: (sql: string) => { executed.push(sql); },
    log: () => {},
  } as never);
  assert.equal(result.applied, true);
  assert.equal(exactChecks, 3);
  assert.deepEqual(executed, [REFRESH_PRODUCTION_BOT_PROFILES_SQL]);

  const repeatWrites: string[] = [];
  const already = await rolloutProductionTestData({
    phase: 'refresh-bot-profiles',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS['refresh-bot-profiles'].value,
    read: readFor('refreshed'),
    verifyEnvironment: () => {},
    exactBotSeedPrerequisite: async () => ({ ledgerStage: 1 }),
    execute: (sql: string) => { repeatWrites.push(sql); },
    log: () => {},
  } as never);
  assert.equal(already.applied, true);
  assert.equal((already as { refreshState?: string }).refreshState, 'refreshed');
  assert.deepEqual(repeatWrites, [REFRESH_PRODUCTION_BOT_PROFILES_SQL]);
}
