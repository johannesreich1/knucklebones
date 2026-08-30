-- The face-off, openable from the RESULT screen (design 36f follow-up): the
-- card there has no leaderboard row to paint from, so player_card(nick) grows
-- from "the one fact the rows cannot carry" (0022) into the WHOLE row —
-- points, record, rank, apex, peak — beside the streak it already computed.
-- The rank/apex arithmetic MIRRORS leaderboard() (0022) on purpose: a player
-- must hold the same rank whichever door opened the card. Old clients read
-- streak/since by name and keep working; a player with no season row (never
-- paired this season) answers nulls, and the client shows no door.

drop function public.player_card(text);

create function public.player_card(nick text)
returns table(streak integer, since timestamptz, points integer,
              wins bigint, losses bigint, games bigint,
              rank bigint, apex boolean, peak integer)
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
  ),
  humans as (
    select count(*) as n
    from public.season_ratings sr
    join public.profiles p on p.id = sr.player
    where sr.season_id = public.current_season() and p.is_bot = false
      and sr.wins + sr.losses + sr.draws > 0
  ),
  board as (
    select sr.player, sr.points, sr.wins::bigint as wins, sr.losses::bigint as losses,
           (sr.wins + sr.losses + sr.draws)::bigint as games,
           rank() over (order by sr.points desc, sr.wins desc) as rnk,
           count(*) over () as pop, sr.peak
    from public.season_ratings sr
    join public.profiles p on p.id = sr.player
    where sr.season_id = public.current_season()
      and sr.wins + sr.losses + sr.draws > 0
      and (p.is_bot = false or (select n from humans) < 100)
  ),
  mine as (select * from board where player = (select id from who))
  select coalesce((select count(*)::integer from runs where won group by grp
                   order by count(*) desc limit 1), 0) as streak,
         (select created_at from who) as since,
         (select points from mine) as points,
         (select wins from mine) as wins,
         (select losses from mine) as losses,
         (select games from mine) as games,
         (select rnk from mine) as rank,
         -- NEON is a POSITION (top 1%), same fallback as leaderboard() while
         -- the population is too small for a meaningful 1%
         (select case when pop < 100 then points >= 4350
                      else rnk <= greatest(1, floor(pop * 0.01)) end
          from mine) as apex,
         (select peak from mine) as peak;
$function$;

revoke execute on function public.player_card(text) from public;
grant execute on function public.player_card(text) to anon, authenticated;
