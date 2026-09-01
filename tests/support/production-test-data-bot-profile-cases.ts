import assert from 'node:assert/strict';
import {
  BASE_PRODUCTION_TEST_DATA_AUDIT_SQL,
  EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL,
  LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL,
  PRODUCTION_BOT_COUNT,
  PRODUCTION_BOT_MAX_PEAK_GAP,
  PRODUCTION_BOT_RUNE_OWNER_COUNT,
  PRODUCTION_BOT_RUNE_ROW_COUNT,
  PRODUCTION_BOT_SEED_PLAN,
  PRODUCTION_TEST_DATA_OPT_INS,
  REFRESH_PRODUCTION_BOT_PROFILES_AUDIT_SQL,
  REFRESH_PRODUCTION_BOT_PROFILES_SQL,
  RUNE_TRIAL_PRODUCTION_STAGE_SQL,
  SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL,
  SEED_PRODUCTION_BOTS_SQL,
  assertProductionBotSeedComplete,
  assertProductionBotProfilesRefreshable,
  buildProductionBotRunePlan,
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
  assert.equal(PRODUCTION_BOT_SEED_PLAN.length, PRODUCTION_BOT_COUNT);
  assert.equal(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.points)).size, PRODUCTION_BOT_COUNT);
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
  /* The floor the plan GUARANTEES, not the minimum a particular population
     happens to reach. This asserted exactly 18 while the population was 150;
     at 200 the extra ordinals draw lower rolls and the formula's own
     Math.max(16, ...) starts to bind, so 18 was describing the sample rather
     than the rule. 16 is the rule. */
  assert.ok(Math.min(...PRODUCTION_BOT_SEED_PLAN.map(
    row => row.wins + row.losses + row.draws,
  )) >= 16);
  /* Same reasoning as the floor above: the CEILING the formula allows, not the
     figure one population reaches. games = 18 + round(points / 11.5) + pick(25)
     - 12, so the richest bot (4600 points) can reach 406 + 24 = 430 and no
     more. This read 410 at 150 bots and 419 at 200 — both are samples of the
     same rule. */
  assert.ok(Math.max(...PRODUCTION_BOT_SEED_PLAN.map(
    row => row.wins + row.losses + row.draws,
  )) <= 430);
  /* A total is population-sized by definition, so assert the SHAPE instead: an
     average history in a band that stays a plausible ladder rather than either
     a handful of games or a grind nobody would believe. */
  const meanGames = PRODUCTION_BOT_SEED_PLAN.reduce(
    (sum, row) => sum + row.wins + row.losses + row.draws,
    0,
  ) / PRODUCTION_BOT_SEED_PLAN.length;
  assert.ok(meanGames > 150 && meanGames < 300, `mean games ${meanGames}`);
  /* Exactly half the population sits at its peak and half is below it — the
     plan alternates on ordinal parity, so this is the rule, expressed against
     the count rather than re-typed as 75. */
  assert.equal(PRODUCTION_BOT_SEED_PLAN.filter(row => row.peak === row.points).length,
    PRODUCTION_BOT_COUNT / 2);
  assert.equal(PRODUCTION_BOT_SEED_PLAN.filter(row => row.peak > row.points).length,
    PRODUCTION_BOT_COUNT / 2);
  /* The cap the plan enforces, not the largest gap this population happens to
     draw (170 at 150 bots, 180 at 200). PRODUCTION_BOT_MAX_PEAK_GAP is the
     contract, and the seed SQL asserts the same bound. */
  assert.ok(Math.max(...PRODUCTION_BOT_SEED_PLAN.map(row => row.peak - row.points))
    <= PRODUCTION_BOT_MAX_PEAK_GAP);
  /* VARIETY is the point — histories must not repeat in blocks — so assert the
     property rather than the tally (106 of 150, 130 of 200; both comfortably
     over half the population). */
  assert.ok(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.wins)).size
    > PRODUCTION_BOT_COUNT / 2);
  assert.ok(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.losses)).size
    > PRODUCTION_BOT_COUNT / 2);
  assert.equal(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.draws)).size, 11);
  assert.equal(new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.bestStreak)).size, 6);
  const rates = PRODUCTION_BOT_SEED_PLAN.map(
    row => row.wins / (row.wins + row.losses + row.draws),
  );
  /* The BAND the plan targets — deliberately beatable, never a walkover — not
     the extreme values one population lands on. buildProductionBotSeedPlan
     clamps its target win rate to 0.42-0.55 before integer rounding, and the
     seed SQL independently rejects any row outside 0.4-0.55. */
  assert.ok(Math.min(...rates) >= 0.4);
  assert.ok(Math.max(...rates) <= 0.55);
  for (const [min, max] of [[0, 300], [300, 720], [720, 1260], [1260, 2010],
    [2010, 3000], [3000, 4350], [4350, Number.POSITIVE_INFINITY]]) {
    assert.ok(PRODUCTION_BOT_SEED_PLAN.some(row => row.points >= min && row.points < max));
  }

  const runePlans = PRODUCTION_BOT_SEED_PLAN.map(bot => ({
    bot,
    owned: buildProductionBotRunePlan(bot),
  }));
  assert.equal(PRODUCTION_BOT_RUNE_ROW_COUNT, 539);
  assert.equal(PRODUCTION_BOT_RUNE_OWNER_COUNT, 155);
  assert.equal(
    runePlans.reduce((total, row) => total + row.owned.length, 0),
    PRODUCTION_BOT_RUNE_ROW_COUNT,
  );
  assert.equal(
    runePlans.filter(row => row.owned.length > 0).length,
    PRODUCTION_BOT_RUNE_OWNER_COUNT,
  );
  assert.ok(runePlans.every(row => new Set(row.owned).size === row.owned.length));
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
  assert.match(SEED_PRODUCTION_BOTS_SQL, /insert into public\.player_runes/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /set equipped_rune =/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /private\.bot_owned_rune_choice\(pr\.id\)/);
  assert.match(SEEDED_PRODUCTION_TEST_DATA_AUDIT_SQL,
    /private\.bot_owned_rune_choice\(profile\.id\)/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /a bot was seated with a rune it does not hold/);
  assert.doesNotMatch(SEED_PRODUCTION_BOTS_SQL, /\brandom\s*\(/i);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /20260826153000.*ladder_streak_baselines/s);
  assert.match(SEED_PRODUCTION_BOTS_SQL,
    /active_ranked_curve_version\(\)[\s\S]*legacy production bot seed is disabled after curve-v2 activation/);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /ranked_pool_tier = \(case/);
  assert.match(SEED_PRODUCTION_BOTS_SQL,
    new RegExp(`count\\(distinct points\\).*<> ${PRODUCTION_BOT_COUNT}`, 's'));
  assert.match(SEED_PRODUCTION_BOTS_SQL, /max\(points\).*<> 4600/s);
  assert.match(SEED_PRODUCTION_BOTS_SQL, /seed created unexpected Auth or ranked rows/);
  assert.doesNotMatch(SEED_PRODUCTION_BOTS_SQL, /public\.current_season\(\)/);
  assert.doesNotMatch(SEED_PRODUCTION_BOTS_SQL, /private\.ranked_pool_tier_for_peak\((?:rating|seed_row)/);
  assert.doesNotMatch(SEED_PRODUCTION_BOTS_SQL, /generate_series|\btruncate\b/i);
  assert.equal((SEED_PRODUCTION_BOTS_SQL.match(
    /^\s*\(\d+, \d+, \d+, \d+, \d+, \d+, \d+\),?$/gm,
  ) ?? []).length, PRODUCTION_BOT_COUNT);
  assert.equal((SEED_PRODUCTION_BOTS_SQL.match(
    /^\s*\(\d+, '(?:fate|nudge|ward|sunder|pilfer|anvil)'\)[,;]?$/gm,
  ) ?? []).length, PRODUCTION_BOT_RUNE_ROW_COUNT);
}

export function assertBotProfileRefreshSql() {
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /^\s*begin;/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /commit;\s*$/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /lock_timeout = '10s'/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL,
    /active_ranked_curve_version\(\)[\s\S]*legacy production bot-profile refresh is disabled after curve-v2 activation/);
  assert.match(
    REFRESH_PRODUCTION_BOT_PROFILES_SQL,
    /select (?:count\(\*\)|1) from public\.matches/,
  );
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL,
    new RegExp(`legacy_rows = ${PRODUCTION_BOT_COUNT}`));
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL,
    new RegExp(`refreshed_rows = ${PRODUCTION_BOT_COUNT}`));
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /update public\.season_ratings/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /update public\.profiles/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /on conflict \(season_id, player\) do update/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /insert into public\.player_runes/);
  assert.match(REFRESH_PRODUCTION_BOT_PROFILES_SQL,
    /private\.bot_owned_rune_choice\(pr\.id\)/);
  assert.doesNotMatch(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /\brandom\s*\(/i);
  assert.doesNotMatch(REFRESH_PRODUCTION_BOT_PROFILES_SQL, /\bdelete\b|\btruncate\b/i);
  assert.equal((REFRESH_PRODUCTION_BOT_PROFILES_SQL.match(
    /^\s*\(\d+, \d+, \d+, \d+, \d+, \d+, \d+, \d+, \d+, \d+\)[,;]?$/gm,
  ) ?? []).length, PRODUCTION_BOT_COUNT);
  assert.equal((REFRESH_PRODUCTION_BOT_PROFILES_SQL.match(
    /^\s*\(\d+, '(?:fate|nudge|ward|sunder|pilfer|anvil)'\)[,;]?$/gm,
  ) ?? []).length, PRODUCTION_BOT_RUNE_ROW_COUNT);
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
  guarded(() => assertProductionBotSeedComplete({
    ...audit, botsWithRunesWithoutEquipped: 1,
  }), /botsWithRunesWithoutEquipped/);
  guarded(() => assertProductionBotSeedComplete({
    ...audit, botsWithUnownedEquippedRune: 1,
  }), /botsWithUnownedEquippedRune/);
  guarded(() => assertProductionBotSeedComplete({
    ...audit, botsWithoutRunesWithEquipped: 1,
  }), /botsWithoutRunesWithEquipped/);
  guarded(() => assertProductionBotSeedComplete({
    ...audit, botsWithUnexpectedEquippedRune: 1,
  }), /botsWithUnexpectedEquippedRune/);
  guarded(() => assertProductionBotSeedComplete({ ...audit, neonPointBots: 0 }), /neonPointBots/);
  guarded(() => assertProductionBotSeedComplete({ ...audit, maxWinRateBps: 5600 }), /maxWinRateBps/);
}

export function assertRefreshAudit(guarded: GuardedAssertion) {
  const base = validateBaseProductionTestDataAudit([baseAudit({
    authUsers: PRODUCTION_BOT_COUNT, profiles: PRODUCTION_BOT_COUNT,
    bots: PRODUCTION_BOT_COUNT, seasonRatings: PRODUCTION_BOT_COUNT,
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
    if (query === RUNE_TRIAL_POST_APPLY_DATA) {
      throw new Error('bot-population exact audit repeated the empty-data migration check');
    }
    throw new Error('unexpected combined query');
  });
  assert.equal(combined.ledgerStage, 1);
}

export async function assertBotProfileRefreshOrchestration() {
  const populated = baseAudit({
    authUsers: PRODUCTION_BOT_COUNT, profiles: PRODUCTION_BOT_COUNT,
    bots: PRODUCTION_BOT_COUNT, seasonRatings: PRODUCTION_BOT_COUNT,
  });
  const readFor = (
    state: 'legacy' | 'refreshed',
    runeBefore = emptyRune(),
  ) => async (query: string) => {
    if (query === RUNE_TRIAL_PRODUCTION_STAGE_SQL) return [runeStage(true)];
    if (query === LADDER_STREAK_BASELINE_PRODUCTION_STAGE_SQL) {
      return [streakBaselineStage(true)];
    }
    if (query === BASE_PRODUCTION_TEST_DATA_AUDIT_SQL) return [populated];
    if (query === EMPTY_RUNE_TRIAL_DATA_AUDIT_SQL) return [runeBefore];
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
    rankedCurve: async () => 1,
    verifyEnvironment: () => {},
    exactBotSeedPrerequisite: async () => { exactChecks++; return { ledgerStage: 1 }; },
    execute: (sql: string) => { executed.push(sql); },
    log: () => {},
  } as never);
  assert.equal(result.applied, true);
  assert.equal(exactChecks, 3);
  assert.deepEqual(executed, [REFRESH_PRODUCTION_BOT_PROFILES_SQL]);

  const refreshedProfileWrites: string[] = [];
  const already = await rolloutProductionTestData({
    phase: 'refresh-bot-profiles',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS['refresh-bot-profiles'].value,
    read: readFor('refreshed'),
    rankedCurve: async () => 1,
    verifyEnvironment: () => {},
    exactBotSeedPrerequisite: async () => ({ ledgerStage: 1 }),
    execute: (sql: string) => { refreshedProfileWrites.push(sql); },
    log: () => {},
  } as never);
  assert.equal(already.applied, true);
  assert.equal((already as { refreshState?: string }).refreshState, 'refreshed');
  assert.deepEqual(refreshedProfileWrites, [REFRESH_PRODUCTION_BOT_PROFILES_SQL]);

  let canonicalWrites = 0;
  await assert.rejects(() => rolloutProductionTestData({
    phase: 'refresh-bot-profiles',
    apply: true,
    optIn: PRODUCTION_TEST_DATA_OPT_INS['refresh-bot-profiles'].value,
    read: readFor('refreshed', emptyRune({
      playerRunes: PRODUCTION_BOT_RUNE_ROW_COUNT,
    })),
    rankedCurve: async () => 1,
    verifyEnvironment: () => {},
    exactBotSeedPrerequisite: async () => ({ ledgerStage: 1 }),
    execute: () => { canonicalWrites++; },
    log: () => {},
  } as never), /not empty/);
  assert.equal(canonicalWrites, 0);
}
