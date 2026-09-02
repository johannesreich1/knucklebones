// Pure guards and the one generated SQL program for repositioning the owner's
// production account before a ranked transition test. Transport and credentials
// live in production-player-points.mjs; no client/admin RPC is exposed.

import {
  highestRankedPoolTier,
  rankedCompatibilityPoolTierForPeak,
  rankedPoolTiersForCurve,
} from '../../src/core/ranked-outcomes.ts';
import { LADDER_CURVE_V1 } from '../../src/core/ladder.ts';

export const PRODUCTION_PLAYER_NICKNAME = 'BadRandolf';
export const PRODUCTION_PLAYER_POINTS_OPT_IN = 'KB_ALLOW_PRODUCTION_PLAYER_POINTS';
export const PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN =
  'KB_ALLOW_PRODUCTION_PLAYER_HIGH_WATER_RESET';
export const PRODUCTION_PLAYER_POINTS_MAX = 100_000;

export class ProductionPlayerPointsGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductionPlayerPointsGuardError';
  }
}

const fail = message => { throw new ProductionPlayerPointsGuardError(message); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNT_FIELDS = Object.freeze([
  'openSeasons', 'profileMatches', 'humanMatches', 'seasonRows',
  'activeMatches', 'queueRows', 'unseenEvents',
]);
const NULLABLE_INTEGER_FIELDS = Object.freeze([
  'currentSeason', 'profileRating', 'points', 'peak',
]);
const AUDIT_FIELDS = Object.freeze([
  ...COUNT_FIELDS,
  ...NULLABLE_INTEGER_FIELDS,
  'playerId', 'nickname', 'rankedPoolTier',
].sort());
const COMPATIBILITY_POOL_TIERS = rankedPoolTiersForCurve(LADDER_CURVE_V1);
const POOL_IDS = new Set(COMPATIBILITY_POOL_TIERS.map(tier => tier.id));

export const PRODUCTION_PLAYER_POINTS_AUDIT_SQL = `
with open_season as (
  select season.id
    from public.seasons season
   where season.ends_at is null
   order by season.id desc
), target as (
  select profile.id, profile.nickname, profile.rating, profile.ranked_pool_tier,
         profile.is_bot
    from public.profiles profile
   where lower(profile.nickname) = lower($1)
), chosen as (
  select * from target order by id limit 1
)
select
  (select count(*) from open_season)::integer as "openSeasons",
  (select id::integer from open_season limit 1) as "currentSeason",
  (select count(*) from target)::integer as "profileMatches",
  (select count(*) from target where not is_bot)::integer as "humanMatches",
  (select count(*) from public.season_ratings rating
    where rating.season_id = (select id from open_season limit 1)
      and rating.player = (select id from chosen))::integer as "seasonRows",
  (select id::text from chosen) as "playerId",
  (select nickname from chosen) as nickname,
  (select rating::integer from chosen) as "profileRating",
  (select rating.points::integer from public.season_ratings rating
    where rating.season_id = (select id from open_season limit 1)
      and rating.player = (select id from chosen)) as points,
  (select rating.peak::integer from public.season_ratings rating
    where rating.season_id = (select id from open_season limit 1)
      and rating.player = (select id from chosen)) as peak,
  (select ranked_pool_tier from chosen) as "rankedPoolTier",
  (select count(*) from public.matches ranked_match
    where ranked_match.status = 'active'
      and ((ranked_match.p1 = (select id from chosen))
        or (ranked_match.p2 = (select id from chosen))))::integer as "activeMatches",
  (select count(*) from public.matchmaking_queue queued
    where queued.player_id = (select id from chosen))::integer as "queueRows",
  (select count(*) from public.ranked_progression_events event
    where event.player_id = (select id from chosen)
      and event.seen_at is null)::integer as "unseenEvents";
`;

export function parseProductionPlayerPoints(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail(`Production player points must be a canonical integer from 0 to ${PRODUCTION_PLAYER_POINTS_MAX}.`);
  }
  const points = Number(value);
  if (!Number.isSafeInteger(points) || points < 0 || points > PRODUCTION_PLAYER_POINTS_MAX) {
    fail(`Production player points must be a canonical integer from 0 to ${PRODUCTION_PLAYER_POINTS_MAX}.`);
  }
  return points;
}

export function productionPlayerHighWaterResetOptInValue(points) {
  const parsed = typeof points === 'number'
    ? parseProductionPlayerPoints(String(points))
    : parseProductionPlayerPoints(points);
  return `RESET_BADRANDOLF_HIGH_WATER_TO_${parsed}`;
}

function assertResetHighWater(resetHighWater) {
  if (typeof resetHighWater !== 'boolean') {
    fail('Production player high-water reset intent must be boolean.');
  }
  return resetHighWater;
}

export function assertProductionPlayerPointsOptIn(
  points,
  apply,
  value,
  { resetHighWater = false } = {},
) {
  if (!Number.isSafeInteger(points) || points < 0 || points > PRODUCTION_PLAYER_POINTS_MAX) {
    fail('Production player points are outside the reviewed range.');
  }
  if (typeof apply !== 'boolean') fail('Production player-points apply intent must be boolean.');
  assertResetHighWater(resetHighWater);
  const optInName = resetHighWater
    ? PRODUCTION_PLAYER_HIGH_WATER_RESET_OPT_IN
    : PRODUCTION_PLAYER_POINTS_OPT_IN;
  const optInValue = resetHighWater
    ? productionPlayerHighWaterResetOptInValue(points)
    : String(points);
  if (apply && value !== optInValue) {
    const flag = resetHighWater ? ' --reset-high-water' : '';
    fail(`Applying ${PRODUCTION_PLAYER_NICKNAME}=${points} requires ${optInName}=${optInValue} and${flag} --apply.`);
  }
  return apply;
}

export function validateProductionPlayerPointsAudit(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]
      || typeof rows[0] !== 'object' || Array.isArray(rows[0])) {
    fail('Production player-points audit must return exactly one object.');
  }
  const row = rows[0];
  const keys = Object.keys(row).sort();
  if (JSON.stringify(keys) !== JSON.stringify(AUDIT_FIELDS)) {
    fail('Production player-points audit returned an unexpected shape.');
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isSafeInteger(row[field]) || row[field] < 0) {
      fail(`Production player-points audit field ${field} must be a non-negative integer.`);
    }
  }
  for (const field of NULLABLE_INTEGER_FIELDS) {
    if (row[field] !== null && (!Number.isSafeInteger(row[field]) || row[field] < 0)) {
      fail(`Production player-points audit field ${field} must be null or a non-negative integer.`);
    }
  }
  for (const field of ['playerId', 'nickname', 'rankedPoolTier']) {
    if (row[field] !== null && typeof row[field] !== 'string') {
      fail(`Production player-points audit field ${field} must be null or a string.`);
    }
  }
  return Object.freeze({ ...row });
}

export function assertProductionPlayerPointsReady(audit) {
  if (audit.openSeasons !== 1 || audit.currentSeason === null) {
    fail('Production player-points setup requires exactly one open season.');
  }
  if (audit.profileMatches !== 1) {
    fail(`Production player-points setup requires exactly one profile named ${PRODUCTION_PLAYER_NICKNAME}.`);
  }
  if (audit.humanMatches !== 1) {
    fail(`${PRODUCTION_PLAYER_NICKNAME} must resolve to one non-bot human account.`);
  }
  if (audit.seasonRows !== 1 || audit.points === null || audit.peak === null) {
    fail(`${PRODUCTION_PLAYER_NICKNAME} must have exactly one current-season rating row.`);
  }
  if (!UUID.test(audit.playerId ?? '')) fail('Production player-points target id is invalid.');
  if (audit.nickname?.toLowerCase() !== PRODUCTION_PLAYER_NICKNAME.toLowerCase()) {
    fail(`Production player-points target is not ${PRODUCTION_PLAYER_NICKNAME}.`);
  }
  if (audit.profileRating !== audit.points) {
    fail('Production player-points rating mirror is already inconsistent; refusing to hide drift.');
  }
  if (audit.peak < audit.points) {
    fail('Production player-points peak is below current points; refusing inconsistent ladder data.');
  }
  if (!POOL_IDS.has(audit.rankedPoolTier)) {
    fail('Production player-points permanent pool tier is invalid.');
  }
  if (audit.activeMatches !== 0) fail(`${PRODUCTION_PLAYER_NICKNAME} has an active match.`);
  if (audit.queueRows !== 0) fail(`${PRODUCTION_PLAYER_NICKNAME} is in the ranked queue.`);
  if (audit.unseenEvents !== 0) {
    fail(`${PRODUCTION_PLAYER_NICKNAME} has unseen progression events; open and finish them before repositioning.`);
  }
  return audit;
}

const poolTierCase = () => {
  const descending = [...COMPATIBILITY_POOL_TIERS].sort((a, b) => b.floor - a.floor);
  const lowest = descending.at(-1);
  return `case
${descending.slice(0, -1).map(tier =>
    `       when profile.ranked_pool_tier = '${tier.id}' or v_peak >= ${tier.floor} then '${tier.id}'`)
    .join('\n')}
       else '${lowest.id}'
     end`;
};

export function buildProductionPlayerPointsSql(
  before,
  requestedPoints,
  { resetHighWater = false } = {},
) {
  const audit = assertProductionPlayerPointsReady(before);
  const points = typeof requestedPoints === 'number'
    ? parseProductionPlayerPoints(String(requestedPoints))
    : parseProductionPlayerPoints(requestedPoints);
  assertResetHighWater(resetHighWater);
  const playerId = audit.playerId.toLowerCase();
  const peakAssignment = resetHighWater ? String(points) : `greatest(rating.peak, ${points})`;
  const poolAssignment = resetHighWater
    ? `'${rankedCompatibilityPoolTierForPeak(points, LADDER_CURVE_V1)}'`
    : poolTierCase();
  const poolPostcheck = resetHighWater
    ? `
       and profile.ranked_pool_tier = ${poolAssignment}`
    : '';
  return `begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $player_points$
declare
  v_player constant uuid := '${playerId}'::uuid;
  v_season constant smallint := ${audit.currentSeason};
  v_profile public.profiles%rowtype;
  v_rating public.season_ratings%rowtype;
  v_peak integer;
  v_active_curve smallint;
begin
  if to_regprocedure('public.active_ranked_curve_version()') is not null then
    execute 'select public.active_ranked_curve_version()' into strict v_active_curve;
    if v_active_curve <> 1 then
      raise exception 'legacy production player-points helper is disabled after curve-v2 activation';
    end if;
  end if;

  select profile.* into strict v_profile
    from public.profiles profile
   where profile.id = '${playerId}'::uuid
     and lower(profile.nickname) = lower('${PRODUCTION_PLAYER_NICKNAME}')
     and not profile.is_bot
   for update;

  if (select count(*) from public.seasons season where season.ends_at is null) <> 1
     or not exists (
       select 1 from public.seasons season
        where season.id = v_season and season.ends_at is null
     ) then
    raise exception 'production player-points open season changed after preview';
  end if;
  if exists (select 1 from private.active_match_players active where active.player = v_player) then
    raise exception 'production player-points target has an active match';
  end if;
  if exists (select 1 from public.matchmaking_queue queued where queued.player_id = v_player) then
    raise exception 'production player-points target is queued';
  end if;
  if exists (select 1 from private.deleting_accounts deleting where deleting.player = v_player) then
    raise exception 'production player-points target is deleting';
  end if;
  if exists (
    select 1 from public.ranked_progression_events event
     where event.player_id = v_player and event.seen_at is null
  ) then
    raise exception 'production player-points target has unseen progression';
  end if;

  select rating.* into strict v_rating
    from public.season_ratings rating
   where rating.season_id = v_season and rating.player = v_player
   for update;
  if v_rating.points is distinct from ${audit.points}
     or v_rating.peak is distinct from ${audit.peak}
     or v_profile.rating is distinct from ${audit.profileRating}
     or v_profile.ranked_pool_tier is distinct from '${audit.rankedPoolTier}' then
    raise exception 'production player-points state changed after preview';
  end if;

  update public.season_ratings rating
     set points = ${points},
         peak = ${peakAssignment}
   where rating.season_id = v_season and rating.player = v_player
   returning rating.peak into strict v_peak;

  update public.profiles profile
     set rating = ${points},
         ranked_pool_tier = ${poolAssignment}
   where profile.id = v_player;
  if not found then raise exception 'production player-points profile disappeared'; end if;

  if not exists (
    select 1
      from public.profiles profile
      join public.season_ratings rating
        on rating.player = profile.id and rating.season_id = v_season
     where profile.id = v_player
       and profile.rating = ${points}
       and rating.points = ${points}
       and rating.peak = v_peak${poolPostcheck}
  ) then
    raise exception 'production player-points postcheck failed';
  end if;
end;
$player_points$;

commit;
`;
}

export function assertProductionPlayerPointsApplied(
  before,
  after,
  requestedPoints,
  { resetHighWater = false } = {},
) {
  const initial = assertProductionPlayerPointsReady(before);
  const final = assertProductionPlayerPointsReady(after);
  const points = typeof requestedPoints === 'number'
    ? parseProductionPlayerPoints(String(requestedPoints))
    : parseProductionPlayerPoints(requestedPoints);
  assertResetHighWater(resetHighWater);
  if (final.playerId !== initial.playerId || final.currentSeason !== initial.currentSeason) {
    fail('Production player-points target or season changed during apply.');
  }
  if (final.points !== points || final.profileRating !== points) {
    fail('Production player-points value or profile rating mirror did not apply exactly.');
  }
  const expectedPeak = resetHighWater ? points : Math.max(initial.peak, points);
  if (final.peak !== expectedPeak) {
    fail(resetHighWater
      ? 'Production player-points peak did not reset exactly.'
      : 'Production player-points peak was not preserved monotonically.');
  }
  const expectedPool = resetHighWater
    ? rankedCompatibilityPoolTierForPeak(expectedPeak, LADDER_CURVE_V1)
    : highestRankedPoolTier(
      initial.rankedPoolTier,
      rankedCompatibilityPoolTierForPeak(expectedPeak, LADDER_CURVE_V1),
    );
  if (final.rankedPoolTier !== expectedPool) {
    fail(resetHighWater
      ? 'Production player-points permanent pool tier did not reset exactly.'
      : 'Production player-points permanent pool tier moved backwards or failed to advance.');
  }
  if (final.unseenEvents !== 0) {
    fail('Production player-points apply left an unseen progression event before the test match.');
  }
  return after;
}
