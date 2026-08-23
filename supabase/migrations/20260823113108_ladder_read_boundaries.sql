-- Keep raw ladder rows private to their owner. Public ladder/profile surfaces
-- already go through narrowly-shaped SECURITY DEFINER RPCs; granting anonymous
-- SELECT on season_ratings exposed player UUIDs and every row without helping
-- those surfaces.

drop policy if exists season_ratings_read on public.season_ratings;
create policy season_ratings_read_own on public.season_ratings
  for select to authenticated
  using (player = (select auth.uid()));

revoke select on public.season_ratings from anon;
grant select on public.season_ratings to authenticated;

-- leaderboard() and player_card() previously duplicated the bot-visibility,
-- rank, population, and apex CTE. Put that policy in a non-exposed schema so
-- both public projections stay identical by construction.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.ladder_board(p_season smallint)
returns table(
  player uuid,
  nickname text,
  points integer,
  wins bigint,
  losses bigint,
  games bigint,
  rank bigint,
  apex boolean,
  avatar text,
  peak integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with humans as (
    select count(*) as n
      from public.season_ratings sr
      join public.profiles p on p.id = sr.player
     where sr.season_id = p_season
       and p.is_bot = false
       and sr.wins + sr.losses + sr.draws > 0
  ),
  board as (
    select sr.player,
           p.nickname,
           sr.points,
           sr.wins::bigint as wins,
           sr.losses::bigint as losses,
           (sr.wins + sr.losses + sr.draws)::bigint as games,
           rank() over (order by sr.points desc, sr.wins desc) as rnk,
           count(*) over () as pop,
           p.avatar,
           sr.peak
      from public.season_ratings sr
      join public.profiles p on p.id = sr.player
     where sr.season_id = p_season
       and sr.wins + sr.losses + sr.draws > 0
       and (p.is_bot = false or (select n from humans) < 100)
  )
  select board.player,
         board.nickname,
         board.points,
         board.wins,
         board.losses,
         board.games,
         board.rnk,
         case when board.pop < 100 then board.points >= 4350
              else board.rnk <= greatest(1, floor(board.pop * 0.01)) end,
         board.avatar,
         board.peak
    from board;
$function$;

revoke execute on function private.ladder_board(smallint)
  from public, anon, authenticated;

create or replace function public.leaderboard(
  limit_n integer default 50,
  season smallint default null
)
returns table(nickname text, points integer, wins bigint, losses bigint, games bigint,
              rank bigint, apex boolean, avatar text, peak integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select board.nickname,
         board.points,
         board.wins,
         board.losses,
         board.games,
         board.rank,
         board.apex,
         board.avatar,
         board.peak
    from private.ladder_board(coalesce(season, public.current_season())) board
   order by board.rank
   limit least(greatest(limit_n, 1), 100);
$function$;

revoke execute on function public.leaderboard(integer, smallint) from public;
grant execute on function public.leaderboard(integer, smallint) to anon, authenticated;

create or replace function public.player_card(nick text)
returns table(streak integer, since timestamptz, points integer,
              wins bigint, losses bigint, games bigint,
              rank bigint, apex boolean, peak integer)
language sql
stable
security definer
set search_path = ''
as $function$
  with who as (
    select id, created_at
      from public.profiles
     where nickname = nick
     limit 1
  ),
  played as (
    select (m.winner = (select id from who)) as won,
           row_number() over (order by m.finished_at, m.id) as n
      from public.matches m
     where (m.p1 = (select id from who) or m.p2 = (select id from who))
       and m.status <> 'active'
       and m.season_id = public.current_season()
  ),
  runs as (
    select won, n - row_number() over (partition by won order by n) as grp
      from played
  ),
  mine as (
    select *
      from private.ladder_board(public.current_season())
     where player = (select id from who)
  )
  select coalesce((select count(*)::integer
                     from runs
                    where won
                    group by grp
                    order by count(*) desc
                    limit 1), 0),
         (select created_at from who),
         (select mine.points from mine),
         (select mine.wins from mine),
         (select mine.losses from mine),
         (select mine.games from mine),
         (select mine.rank from mine),
         (select mine.apex from mine),
         (select mine.peak from mine);
$function$;

revoke execute on function public.player_card(text) from public;
grant execute on function public.player_card(text) to anon, authenticated;
