-- Percentile, and the bot difficulty that rides on it.
--
-- Spec: docs/LADDER.md §4. Additive and invisible — nothing calls this until
-- pvp-move v11.
--
-- Absolute point thresholds stop meaning anything the moment the ladder
-- inflates, and this ladder inflates by design. pvp-move currently keys its
-- bot difficulty off the literals 820 / 1080 / 1150; under the new ladder
-- those quietly become nonsense within a season. A player's SHARE of the
-- population does not, and it survives a season reset for free.

-- Where a player sits in the current season: 0 at the bottom, 1 at the top.
-- A player with no ladder row yet is brand new, and brand new is the bottom.
create or replace function public.player_percentile(p uuid)
returns numeric
language sql
stable security definer
set search_path to ''
as $function$
  with pop as (
    select player, points
    from public.season_ratings
    where season_id = public.current_season()
  )
  select case
    when (select count(*) from pop) < 2 then 0::numeric
    else coalesce(
      (select count(*)::numeric from pop
        where points < (select points from pop where player = p))
      / nullif((select count(*) - 1 from pop), 0), 0::numeric)
  end;
$function$;

-- 1-based position and the size of the field, in one round trip — the
-- leaderboard needs both to resolve the apex, which is a POSITION (top 1%)
-- rather than a point threshold. A fixed threshold cannot stay scarce on a
-- ladder that always climbs: 514 of 600 simulated players cleared one in a
-- long season (tests/ladderbench.test.ts asserts that premise still holds).
create or replace function public.player_standing(p uuid)
returns table(points integer, rank bigint, population bigint, percentile numeric)
language sql
stable security definer
set search_path to ''
as $function$
  with pop as (
    select player, sr.points,
           rank() over (order by sr.points desc) as rnk,
           count(*) over () as n,
           percent_rank() over (order by sr.points) as pr
    from public.season_ratings sr
    where sr.season_id = public.current_season()
  )
  select pop.points, pop.rnk, pop.n, pop.pr from pop where pop.player = p;
$function$;

-- How many rated players sit within `band` points of this one. Matchmaking
-- reads it from the other end of the same axis: a crowded band can stay tight,
-- a sparse one has to widen or nobody is ever paired.
create or replace function public.players_near(p uuid, band integer)
returns bigint
language sql
stable security definer
set search_path to ''
as $function$
  select count(*) - 1
  from public.season_ratings me
  join public.season_ratings other
    on other.season_id = me.season_id
   and abs(other.points - me.points) <= band
  where me.season_id = public.current_season() and me.player = p;
$function$;

revoke execute on function public.player_percentile(uuid) from public;
revoke execute on function public.player_standing(uuid)   from public;
revoke execute on function public.players_near(uuid, integer) from public;
grant execute on function public.player_percentile(uuid) to authenticated;
grant execute on function public.player_standing(uuid)   to anon, authenticated;
grant execute on function public.players_near(uuid, integer) to authenticated;
