// Focused contracts for the guarded BadRandolf transition-testing helper.
// Kept beside the existing production test-data cases so the owner runner
// stays within the repository's architecture size budget.
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  PRODUCTION_PLAYER_NICKNAME,
  PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN,
  PRODUCTION_PLAYER_POINTS_AUDIT_SQL,
  PRODUCTION_PLAYER_POINTS_MAX,
  PRODUCTION_PLAYER_POINTS_OPT_IN,
  ProductionPlayerPointsGuardError,
  assertProductionPlayerPointsApplied as verifyProductionPlayerPointsApplied,
  assertProductionPlayerPointsOptIn,
  assertProductionPlayerPointsReady,
  buildProductionPlayerPointsSql,
  parseProductionPlayerPoints,
  productionPlayerHighWaterResetOptInValue,
  validateProductionPlayerPointsAudit,
} from '../../tools/database/production-player-points-core.mjs';
import {
  executeProductionPlayerPointsSql,
  parseArgs,
  rolloutProductionPlayerPoints,
} from '../../tools/database/production-player-points.mjs';

const PLAYER_ID = '00000000-0000-4000-8000-00000000beef';
const playerPointsAudit = (overrides: Record<string, unknown> = {}) => ({
  openSeasons: 1,
  currentSeason: 1,
  profileMatches: 1,
  humanMatches: 1,
  seasonRows: 1,
  playerId: PLAYER_ID,
  nickname: PRODUCTION_PLAYER_NICKNAME,
  profileRating: 1218,
  points: 1218,
  peak: 1800,
  rankedPoolTier: 'ivory',
  activeMatches: 0,
  queueRows: 0,
  unseenEvents: 0,
  ...overrides,
});

const guarded = (run: () => unknown, pattern: RegExp) => {
  assert.throws(run, (error: unknown) => error instanceof ProductionPlayerPointsGuardError
    && pattern.test(error.message));
};

export function assertProductionPlayerPointsInput() {
  assert.equal(PRODUCTION_PLAYER_NICKNAME, 'BadRandolf');
  assert.equal(parseProductionPlayerPoints('1259'), 1259);
  assert.equal(parseProductionPlayerPoints(String(PRODUCTION_PLAYER_POINTS_MAX)),
    PRODUCTION_PLAYER_POINTS_MAX);
  for (const invalid of ['', '-1', '1.5', '01', '1259;delete from profiles',
    String(PRODUCTION_PLAYER_POINTS_MAX + 1)]) {
    guarded(() => parseProductionPlayerPoints(invalid), /points must be/);
  }
  assert.equal(assertProductionPlayerPointsOptIn(1259, false, undefined), false);
  assert.equal(assertProductionPlayerPointsOptIn(1259, true, '1259'), true);
  guarded(() => assertProductionPlayerPointsOptIn(1259, true, '1260'),
    new RegExp(`${PRODUCTION_PLAYER_POINTS_OPT_IN}=1259`));

  const resetValue = productionPlayerHighWaterResetOptInValue(299);
  assert.equal(resetValue, 'RESET_BADRANDOLF_HIGH_WATER_TO_299');
  assert.notEqual(PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN,
    PRODUCTION_PLAYER_POINTS_OPT_IN);
  assert.equal(assertProductionPlayerPointsOptIn(
    299, true, resetValue, { resetHighWater: true },
  ), true);
  guarded(() => assertProductionPlayerPointsOptIn(
    299, true, '299', { resetHighWater: true },
  ), new RegExp(`${PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN}=${resetValue}`));
  guarded(() => assertProductionPlayerPointsOptIn(
    299, true, productionPlayerHighWaterResetOptInValue(719), { resetHighWater: true },
  ), new RegExp(`${PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN}=${resetValue}`));
  guarded(() => assertProductionPlayerPointsOptIn(
    299, true, resetValue,
  ), new RegExp(`${PRODUCTION_PLAYER_POINTS_OPT_IN}=299`));
  guarded(() => assertProductionPlayerPointsOptIn(
    299, false, undefined, { resetHighWater: 'yes' as never },
  ), /reset intent must be boolean/);

  assert.deepEqual(parseArgs(['299']), {
    help: false, points: 299, apply: false, resetHighWater: false,
  });
  assert.deepEqual(parseArgs(['299', '--reset-high-water']), {
    help: false, points: 299, apply: false, resetHighWater: true,
  });
  assert.deepEqual(parseArgs(['299', '--apply', '--reset-high-water']), {
    help: false, points: 299, apply: true, resetHighWater: true,
  });
  assert.deepEqual(parseArgs(['299', '--reset-high-water', '--apply']), {
    help: false, points: 299, apply: true, resetHighWater: true,
  });
  assert.throws(() => parseArgs(['299', '--reset-high-water', '--reset-high-water']),
    /Duplicate argument/);
  assert.throws(() => parseArgs(['299', '--apply', '--apply']), /Duplicate argument/);
  assert.throws(() => parseArgs(['299', '--unknown']), /Unknown argument/);
}

export function assertProductionPlayerPointsAudit() {
  assert.match(PRODUCTION_PLAYER_POINTS_AUDIT_SQL, /lower\(profile\.nickname\) = lower\(\$1\)/);
  assert.match(PRODUCTION_PLAYER_POINTS_AUDIT_SQL,
    /from public\.matches ranked_match[\s\S]*ranked_match\.status = 'active'/);
  assert.doesNotMatch(PRODUCTION_PLAYER_POINTS_AUDIT_SQL, /\bprivate\./,
    'the management read-only preview cannot execute or inspect private-schema owners');
  const ready = validateProductionPlayerPointsAudit([playerPointsAudit()]);
  assert.equal(assertProductionPlayerPointsReady(ready), ready);
  for (const [overrides, pattern] of [
    [{ openSeasons: 2 }, /exactly one open season/],
    [{ profileMatches: 2, humanMatches: 2 }, /exactly one profile/],
    [{ humanMatches: 0 }, /non-bot human/],
    [{ seasonRows: 0 }, /current-season rating/],
    [{ profileRating: 1200 }, /rating mirror/],
    [{ activeMatches: 1 }, /active match/],
    [{ queueRows: 1 }, /ranked queue/],
    [{ unseenEvents: 1 }, /unseen progression/],
  ] as const) {
    const audit = validateProductionPlayerPointsAudit([playerPointsAudit(overrides)]);
    guarded(() => assertProductionPlayerPointsReady(audit), pattern);
  }
  guarded(
    () => validateProductionPlayerPointsAudit([{ ...playerPointsAudit(), surprise: 1 }]),
    /unexpected shape/,
  );
}

export function assertProductionPlayerPointsSql() {
  const before = assertProductionPlayerPointsReady(
    validateProductionPlayerPointsAudit([playerPointsAudit()]),
  );
  const sql = buildProductionPlayerPointsSql(before, 1259);
  assert.match(sql, /^begin;/);
  assert.match(sql, /set local lock_timeout = '5s'/);
  assert.match(sql, /set local statement_timeout = '30s'/);
  assert.match(sql, /where profile\.id = '00000000-0000-4000-8000-00000000beef'::uuid/);
  assert.match(sql, /lower\(profile\.nickname\) = lower\('BadRandolf'\)/);
  assert.ok(sql.indexOf('for update;') < sql.indexOf('from private.active_match_players'));
  assert.match(sql, /set points = 1259,\s+peak = greatest\(rating\.peak, 1259\)/);
  assert.match(sql, /set rating = 1259,/);
  assert.match(sql, /ranked_pool_tier = case/);
  assert.match(sql, /rating\.points is distinct from 1218/);
  assert.match(sql, /rating\.peak is distinct from 1800/);
  assert.match(sql, /profile\.rating is distinct from 1218/);
  assert.doesNotMatch(sql, /update public\.ranked_progression_events/i);
  assert.doesNotMatch(sql, /\b(delete|truncate)\b/i);
  assert.doesNotMatch(sql, /auth\./i);
  assert.match(sql, /commit;\s*$/);

  const resetBefore = assertProductionPlayerPointsReady(
    validateProductionPlayerPointsAudit([playerPointsAudit({
      profileRating: 4601,
      points: 4601,
      peak: 4601,
      rankedPoolTier: 'ivory',
    })]),
  );
  const resetSql = buildProductionPlayerPointsSql(resetBefore, 299, {
    resetHighWater: true,
  });
  assert.match(resetSql, /set points = 299,\s+peak = 299/);
  assert.match(resetSql, /set rating = 299,\s+ranked_pool_tier = 'stone'/);
  assert.doesNotMatch(resetSql, /peak = greatest/);
  assert.doesNotMatch(resetSql, /ranked_pool_tier = case/);
  assert.match(resetSql, /rating\.points is distinct from 4601/);
  assert.match(resetSql, /rating\.peak is distinct from 4601/);
  assert.match(resetSql, /profile\.ranked_pool_tier is distinct from 'ivory'/);
  assert.match(resetSql,
    /where profile\.id = v_player[\s\S]*profile\.rating = 299[\s\S]*rating\.points = 299[\s\S]*rating\.peak = v_peak[\s\S]*profile\.ranked_pool_tier = 'stone'/);
  for (const preserved of [
    /update public\.ranked_progression_events/i,
    /update public\.matches/i,
    /update public\.player_runes/i,
    /\b(delete|truncate)\b/i,
  ]) assert.doesNotMatch(resetSql, preserved);

  const normalLoweringSql = buildProductionPlayerPointsSql(resetBefore, 299);
  assert.equal(buildProductionPlayerPointsSql(resetBefore, 299, {
    resetHighWater: false,
  }), normalLoweringSql, 'explicit ordinary mode changed the legacy SQL program');
  assert.match(normalLoweringSql, /set points = 299,\s+peak = greatest\(rating\.peak, 299\)/);
  assert.match(normalLoweringSql, /ranked_pool_tier = case/);
  assert.doesNotMatch(normalLoweringSql, /ranked_pool_tier = 'stone'/);
  for (const [points, tier] of [[299, 'stone'], [300, 'bone'], [719, 'bone'], [720, 'ivory']]) {
    assert.match(buildProductionPlayerPointsSql(resetBefore, points, {
      resetHighWater: true,
    }), new RegExp(`ranked_pool_tier = '${tier}'`));
  }
  guarded(() => buildProductionPlayerPointsSql(resetBefore, 299, {
    resetHighWater: 'yes' as never,
  }), /reset intent must be boolean/);
}

export function assertProductionPlayerPointsPostcheck() {
  const before = assertProductionPlayerPointsReady(
    validateProductionPlayerPointsAudit([playerPointsAudit()]),
  );
  const after = validateProductionPlayerPointsAudit([playerPointsAudit({
    profileRating: 1259,
    points: 1259,
  })]);
  assert.equal(verifyProductionPlayerPointsApplied(before, after, 1259), after);
  guarded(() => verifyProductionPlayerPointsApplied(before, {
    ...after, peak: 1200,
  }, 1259), /peak/);
  guarded(() => verifyProductionPlayerPointsApplied(before, {
    ...after, rankedPoolTier: 'stone',
  }, 1259), /pool tier/);
  guarded(() => verifyProductionPlayerPointsApplied(before, {
    ...after, unseenEvents: 1,
  }, 1259), /unseen progression/);

  const resetBefore = assertProductionPlayerPointsReady(
    validateProductionPlayerPointsAudit([playerPointsAudit({
      profileRating: 4601,
      points: 4601,
      peak: 4601,
      rankedPoolTier: 'ivory',
    })]),
  );
  const resetAfter = validateProductionPlayerPointsAudit([playerPointsAudit({
    profileRating: 299,
    points: 299,
    peak: 299,
    rankedPoolTier: 'stone',
  })]);
  assert.equal(verifyProductionPlayerPointsApplied(
    resetBefore, resetAfter, 299, { resetHighWater: true },
  ), resetAfter);
  guarded(() => verifyProductionPlayerPointsApplied(resetBefore, {
    ...resetAfter, peak: 4601,
  }, 299, { resetHighWater: true }), /peak/);
  guarded(() => verifyProductionPlayerPointsApplied(resetBefore, {
    ...resetAfter, rankedPoolTier: 'ivory',
  }, 299, { resetHighWater: true }), /pool tier/);
}

export function assertProductionPlayerPointsExecutor() {
  const before = assertProductionPlayerPointsReady(
    validateProductionPlayerPointsAudit([playerPointsAudit()]),
  );
  const sql = buildProductionPlayerPointsSql(before, 1259);
  assert.throws(
    () => executeProductionPlayerPointsSql(`${sql}\nselect 1;`, before, 1259),
    /exact generated SQL/,
  );
  let removed = false;
  assert.throws(() => executeProductionPlayerPointsSql(sql, before, 1259, {
    createTemp: () => os.tmpdir(),
    removeTemp: () => { removed = true; },
  }), /Refusing unsafe production player-points temporary directory/);
  assert.equal(removed, false, 'an unvalidated broad path was recursively removed');

  const resetSql = buildProductionPlayerPointsSql(before, 299, {
    resetHighWater: true,
  });
  assert.throws(
    () => executeProductionPlayerPointsSql(resetSql, before, 299),
    /exact generated SQL/,
  );
  assert.throws(
    () => executeProductionPlayerPointsSql(sql, before, 1259, {
      resetHighWater: true,
    }),
    /exact generated SQL/,
  );
}

export async function assertProductionPlayerPointsOrchestration() {
  const before = playerPointsAudit();
  const after = playerPointsAudit({ profileRating: 1259, points: 1259 });
  const previewReads: unknown[] = [];
  const previewWrites: string[] = [];
  const previewLogs: string[] = [];
  const preview = await rolloutProductionPlayerPoints({
    points: 1259,
    read: async (sql, parameters) => {
      previewReads.push({ sql, parameters });
      return [before];
    },
    verifyEnvironment: () => undefined,
    execute: (sql) => { previewWrites.push(sql); },
    log: (message) => { previewLogs.push(message); },
  });
  assert.equal(preview.applied, false);
  assert.equal(previewReads.length, 1);
  assert.deepEqual((previewReads[0] as { parameters: unknown[] }).parameters,
    [PRODUCTION_PLAYER_NICKNAME]);
  assert.equal(previewWrites.length, 0);
  assert.match(previewLogs.join('\n'), /peak 1800 → 1800; permanent pool ivory → ivory/);

  const applyReads = [before, before, after];
  const writes: string[] = [];
  const applied = await rolloutProductionPlayerPoints({
    points: 1259,
    apply: true,
    optIn: '1259',
    read: async () => [applyReads.shift()],
    verifyEnvironment: () => undefined,
    execute: (sql) => { writes.push(sql); },
    log: () => undefined,
  });
  assert.equal(applied.applied, true);
  assert.equal(applyReads.length, 0);
  assert.deepEqual(writes, [buildProductionPlayerPointsSql(
    validateProductionPlayerPointsAudit([before]), 1259,
  )]);
  assert.equal(applied.after.points, 1259);

  const resetBefore = playerPointsAudit({
    profileRating: 4601,
    points: 4601,
    peak: 4601,
    rankedPoolTier: 'ivory',
  });
  const resetAfter = playerPointsAudit({
    profileRating: 299,
    points: 299,
    peak: 299,
    rankedPoolTier: 'stone',
  });
  const resetPreviewLogs: string[] = [];
  const resetPreview = await rolloutProductionPlayerPoints({
    points: 299,
    resetHighWater: true,
    read: async () => [resetBefore],
    verifyEnvironment: () => undefined,
    execute: () => { throw new Error('reset preview wrote'); },
    log: (message) => { resetPreviewLogs.push(message); },
  });
  assert.equal(resetPreview.applied, false);
  assert.match(resetPreviewLogs.join('\n'),
    /HIGH-WATER RESET[\s\S]*peak 4601 → 299; permanent pool ivory → stone/);
  assert.match(resetPreviewLogs.join('\n'),
    /1 point below BONE; any win crosses it because the minimum win gain is 30/);
  assert.match(resetPreviewLogs.join('\n'), new RegExp(
    `${PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN}=RESET_BADRANDOLF_HIGH_WATER_TO_299`,
  ));
  assert.match(resetPreviewLogs.join('\n'), /--reset-high-water --apply/);

  const resetApplyReads = [resetBefore, resetBefore, resetAfter];
  const resetWrites: Array<{ sql: string; resetHighWater: boolean }> = [];
  const resetApplied = await rolloutProductionPlayerPoints({
    points: 299,
    resetHighWater: true,
    apply: true,
    optIn: productionPlayerHighWaterResetOptInValue(299),
    read: async () => [resetApplyReads.shift()],
    verifyEnvironment: () => undefined,
    execute: (sql, _before, _points, options) => {
      resetWrites.push({ sql, resetHighWater: options.resetHighWater });
    },
    log: () => undefined,
  });
  assert.equal(resetApplied.applied, true);
  assert.equal(resetApplyReads.length, 0);
  assert.deepEqual(resetWrites, [{
    sql: buildProductionPlayerPointsSql(
      validateProductionPlayerPointsAudit([resetBefore]), 299, { resetHighWater: true },
    ),
    resetHighWater: true,
  }]);
  assert.equal(resetApplied.after.peak, 299);
  assert.equal(resetApplied.after.rankedPoolTier, 'stone');

  let rejectedResetWork = 0;
  await assert.rejects(() => rolloutProductionPlayerPoints({
    points: 299,
    resetHighWater: true,
    apply: true,
    optIn: '299',
    read: async () => { rejectedResetWork++; return [resetBefore]; },
    verifyEnvironment: () => { rejectedResetWork++; },
    execute: () => { rejectedResetWork++; },
    log: () => undefined,
  }), new RegExp(`${PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN}=`));
  assert.equal(rejectedResetWork, 0, 'a mismatched reset opt-in reached live work');
}
