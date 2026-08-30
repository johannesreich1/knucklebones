-- The board learns to page (user call, straight after match history did):
-- a ladder of thousands is not one payload, and the old top-50 cap silently
-- hid every player ranked below it — their own centred row included. The
-- window opens at `from_rank` and runs limit_n rows; the defaults keep the
-- old call shape bit-for-bit for shipped clients. Signature changes, so the
-- function is dropped and both grants restated (the 0015/0018/0022 trap).
drop function if exists public.leaderboard(integer, smallint);

create function public.leaderboard(limit_n integer default 50, season smallint default null,
                                   from_rank integer default 1)
returns table(nickname text, points integer, wins bigint, losses bigint, games bigint,
              rank bigint, apex boolean, avatar text, peak integer)
language sql
stable security definer
set search_path to ''
as $function$
  with s as (select coalesce(season, public.current_season()) as id),
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
         case when pop < 100 then points >= 4350
              else rnk <= greatest(1, floor(pop * 0.01)) end as apex,
         avatar, peak
  from board
  where rnk >= greatest(from_rank, 1)
  order by rnk
  limit least(greatest(limit_n, 1), 100);
$function$;

revoke execute on function public.leaderboard(integer, smallint, integer) from public;
grant execute on function public.leaderboard(integer, smallint, integer) to anon, authenticated;;
