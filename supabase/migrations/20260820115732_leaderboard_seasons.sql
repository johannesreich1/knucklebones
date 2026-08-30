drop function if exists public.leaderboard(integer);

create function public.leaderboard(limit_n integer default 50, season smallint default null)
returns table(nickname text, points integer, wins bigint, losses bigint, games bigint,
              rank bigint, apex boolean)
language sql
stable security definer
set search_path to ''
as $function$
  with s as (select coalesce(season, public.current_season()) as id),
  humans as (
    select count(*) as n
    from public.season_ratings sr
    join public.profiles p on p.id = sr.player
    where sr.season_id = (select id from s) and p.is_bot = false
      and sr.wins + sr.losses + sr.draws > 0
  ),
  board as (
    select p.nickname, sr.points, sr.wins::bigint as wins, sr.losses::bigint as losses,
           (sr.wins + sr.losses + sr.draws)::bigint as games,
           rank() over (order by sr.points desc, sr.wins desc) as rnk,
           count(*) over () as pop
    from public.season_ratings sr
    join public.profiles p on p.id = sr.player
    where sr.season_id = (select id from s)
      and sr.wins + sr.losses + sr.draws > 0
      and (p.is_bot = false or (select n from humans) < 100)
  )
  select board.nickname, board.points, board.wins, board.losses, board.games, board.rnk,
         case when board.pop < 100 then board.points >= 4350
              else board.rnk <= greatest(1, floor(board.pop * 0.01)) end as apex
  from board
  order by board.rnk
  limit least(greatest(limit_n, 1), 100);
$function$;

revoke execute on function public.leaderboard(integer, smallint) from public;
grant execute on function public.leaderboard(integer, smallint) to anon, authenticated;;
