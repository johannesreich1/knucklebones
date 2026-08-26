import {
  PRODUCTION_BOT_COUNT,
  PRODUCTION_BOT_MAX_POINTS,
  PRODUCTION_BOT_SEED_PLAN,
} from '../../tools/database/production-test-data-core.mjs';

export const baseAudit = (overrides: Record<string, number> = {}) => ({
  authUsers: 0,
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
  profiles: 0,
  bots: 0,
  humans: 0,
  matches: 0,
  activeMatches: 0,
  matchMoves: 0,
  matchSeeds: 0,
  queueRows: 0,
  seasonRatings: 0,
  playerSettings: 0,
  activeSeats: 0,
  deletingAccounts: 0,
  matchCommands: 0,
  storageObjects: 0,
  authOwnedStorageObjects: 0,
  authWithoutProfile: 0,
  profileWithoutAuth: 0,
  openSeasons: 1,
  currentSeason: 1,
  ...overrides,
});

export const runeStage = (value: boolean, overrides: Record<string, boolean> = {}) => ({
  migrationHistory: value,
  rankedPoolColumn: value,
  matchProtocolColumns: value,
  queueProtocolColumns: value,
  playerRunesTable: value,
  matchActionsTable: value,
  runeChoicesTable: value,
  runeCommandsTable: value,
  actionCommandsTable: value,
  poolFunction: value,
  ...overrides,
});

export const streakBaselineStage = (
  value: boolean,
  overrides: Record<string, boolean> = {},
) => ({
  migrationHistory: value,
  baselineTable: value,
  baselineColumns: value,
  baselineConstraints: value,
  playerCardBaseline: value,
  ...overrides,
});

export const emptyRune = (overrides: Record<string, number> = {}) => ({
  playerRunes: 0,
  matchActions: 0,
  runeTrialChoices: 0,
  runeSelectionCommands: 0,
  matchActionCommands: 0,
  ...overrides,
});

export function seededAudit(overrides: Record<string, number> = {}) {
  const groupCount = (min: number, max = Number.POSITIVE_INFINITY) =>
    PRODUCTION_BOT_SEED_PLAN.filter(row => row.points >= min && row.points < max).length;
  return {
    ...baseAudit({
      authUsers: PRODUCTION_BOT_COUNT,
      profiles: PRODUCTION_BOT_COUNT,
      bots: PRODUCTION_BOT_COUNT,
      seasonRatings: PRODUCTION_BOT_COUNT,
    }),
    ...emptyRune(),
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
    distinctWins: new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.wins)).size,
    distinctLosses: new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.losses)).size,
    distinctDraws: new Set(PRODUCTION_BOT_SEED_PLAN.map(row => row.draws)).size,
    atPeakBots: PRODUCTION_BOT_SEED_PLAN.filter(row => row.peak === row.points).length,
    peakAheadBots: PRODUCTION_BOT_SEED_PLAN.filter(row => row.peak > row.points).length,
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
      (sum, row) => sum + row.wins + row.losses + row.draws,
      0,
    ),
    minWinRateBps: Math.floor(Math.min(...PRODUCTION_BOT_SEED_PLAN.map(
      row => row.wins * 10000 / (row.wins + row.losses + row.draws),
    ))),
    maxWinRateBps: Math.floor(Math.max(...PRODUCTION_BOT_SEED_PLAN.map(
      row => row.wins * 10000 / (row.wins + row.losses + row.draws),
    ))),
    stoneBots: groupCount(0, 300),
    boneBots: groupCount(300, 720),
    ivoryBots: groupCount(720, 1260),
    silverBots: groupCount(1260, 2010),
    goldBots: groupCount(2010, 3000),
    obsidianBots: groupCount(3000, 4350),
    neonPointBots: groupCount(4350),
    ...overrides,
  };
}

export const refreshAudit = (
  state: 'legacy' | 'refreshed',
  overrides: Record<string, number> = {},
) => ({
  expectedRows: PRODUCTION_BOT_COUNT,
  actualRows: PRODUCTION_BOT_COUNT,
  actualDistinctPoints: PRODUCTION_BOT_COUNT,
  joinedRows: PRODUCTION_BOT_COUNT,
  canonicalRows: PRODUCTION_BOT_COUNT,
  legacyRows: state === 'legacy' ? PRODUCTION_BOT_COUNT : 0,
  refreshedRows: state === 'refreshed' ? PRODUCTION_BOT_COUNT : 0,
  baselineRows: state === 'refreshed' ? PRODUCTION_BOT_COUNT : 0,
  orphanBaselineRows: 0,
  ...overrides,
});
