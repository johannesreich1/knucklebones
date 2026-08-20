-- The leaderboard becomes a SEASON leaderboard, and learns the apex.
--
-- Spec: docs/LADDER.md §2 and §3. This one IS visible — it changes what the
-- ladder screen shows — so it lands with the client that reads it.
--
-- The return type changes, and Postgres will not replace a function's return
-- type in place, so this drops and recreates. A DROP also takes the grants and
-- the PUBLIC revoke with it, so both are restated (the same trap as 0015).
drop function if exists public.leaderboard(integer);

create function public.leaderboard(limit_n integer default 50, season smallint default null)
returns table(nickname text, points integer, wins bigint, losses bigint, games bigint,
              rank bigint, apex boolean)
language sql
stable security definer
set search_path to ''
as $function$
  with s as (select coalesce(season, public.current_season()) as id),
  -- while the human pool is small, bots stand in the ladder under their
  -- generated nicknames (migration 0013's call: an empty ladder is a worse lie
  -- than a populated one). At 100 rated humans it becomes human-only, with no
  -- deploy and no flag to remember.
  humans as (
    select count(*) as n
    from public.season_ratings sr
    join public.profiles p on p.id = sr.player
    where sr.season_id = (select id from s) and p.is_bot = false and sr.wins + sr.losses + sr.draws > 0
  ),
  board as (
    select p.nickname, sr.points, sr.wins::bigint, sr.losses::bigint,
           (sr.wins + sr.losses + sr.draws)::bigint as games,
           rank() over (order by sr.points desc, sr.wins desc) as rnk,
           count(*) over () as pop
    from public.season_ratings sr
    join public.profiles p on p.id = sr.player
    where sr.season_id = (select id from s)
      and sr.wins + sr.losses + sr.draws > 0
      and (p.is_bot = false or (select n from humans) < 100)
  )
  select nickname, points, wins, losses, games, rnk,
         -- NEON is a POSITION, not a threshold: the top 1% of the season. A
         -- population too small to have a meaningful 1% falls back to the point
         -- floor from core/ladder.ts, so the group is never empty by accident.
         case when pop < 100 then points >= 4350
              else rnk <= greatest(1, floor(pop * 0.01)) end as apex
  from board
  order by rnk
  limit least(greatest(limit_n, 1), 100);
$function$;

revoke execute on function public.leaderboard(integer, smallint) from public;
grant execute on function public.leaderboard(integer, smallint) to anon, authenticated;
