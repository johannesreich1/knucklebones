-- The ladder screen learns who it is looking at.
--
-- Design: study 33g (the board centres on YOU, groups as horizons) + 33e (a
-- tapped player is dealt as a face-off), picked 2026-08-20. Two additive
-- surfaces, public like the board itself — reading either must not cost the
-- reader an account:
--
--   · leaderboard() gains avatar + peak: the rows draw each player's die, and
--     the face-off states the season high-water mark.
--   · player_card(nick) hands the face-off the one fact the board rows cannot
--     carry — the player's best win streak — plus member-since. A definer
--     function keyed by NICKNAME, never by id: profiles is own-row only, and
--     the board deliberately exposes no account ids.
--
-- The return type changes, so leaderboard is dropped and recreated — a DROP
-- takes the grants and the PUBLIC revoke with it, so both are restated (the
-- same trap as 0015 and 0018).
drop function if exists public.leaderboard(integer, smallint);

create function public.leaderboard(limit_n integer default 50, season smallint default null)
returns table(nickname text, points integer, wins bigint, losses bigint, games bigint,
              rank bigint, apex boolean, avatar text, peak integer)
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
           count(*) over () as pop,
           p.avatar, sr.peak
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
              else rnk <= greatest(1, floor(pop * 0.01)) end as apex,
         avatar, peak
  from board
  order by rnk
  limit least(greatest(limit_n, 1), 100);
$function$;

revoke execute on function public.leaderboard(integer, smallint) from public;
grant execute on function public.leaderboard(integer, smallint) to anon, authenticated;

-- The streak, for ANY named player. Same gaps-and-islands as 0021's
-- best_streak(), which becomes a delegate below so the computation has one
-- home. An unknown nickname returns streak 0 and a null since — the face-off
-- shows a dash rather than an error.
create function public.player_card(nick text)
returns table(streak integer, since timestamptz)
language sql
stable security definer
set search_path to ''
as $function$
  with who as (select id, created_at from public.profiles where nickname = nick limit 1),
  played as (
    select (m.winner = (select id from who)) as won,
           row_number() over (order by m.finished_at) as n
    from public.matches m
    where (m.p1 = (select id from who) or m.p2 = (select id from who))
      and m.status <> 'active'
      and m.season_id = public.current_season()
  ),
  runs as (
    select won, n - row_number() over (partition by won order by n) as grp
    from played
  )
  select coalesce((select count(*)::integer from runs where won group by grp
                   order by count(*) desc limit 1), 0) as streak,
         (select created_at from who) as since;
$function$;

revoke execute on function public.player_card(text) from public;
grant execute on function public.player_card(text) to anon, authenticated;

-- best_streak() keeps its signature and its authenticated-only grant, but the
-- arithmetic now lives in player_card alone.
create or replace function public.best_streak()
returns integer
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce((select pc.streak from public.player_card(
    (select nickname from public.profiles where id = auth.uid())) pc), 0);
$function$;;
