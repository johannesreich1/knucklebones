drop function if exists public.leaderboard(integer);

create function public.leaderboard(limit_n integer default 50)
returns table(nickname text, rating integer, wins bigint, losses bigint, games bigint)
language sql
stable security definer
set search_path to ''
as $function$
  with humans as (
    select count(*) as n
    from public.profiles p
    where p.is_bot = false
      and exists (select 1 from public.matches m
                  where m.status in ('done','forfeit') and (m.p1 = p.id or m.p2 = p.id))
  )
  select p.nickname, p.rating,
         count(m.id) filter (where m.winner = p.id) as wins,
         count(m.id) filter (where m.winner is not null and m.winner <> p.id) as losses,
         count(m.id) as games
  from public.profiles p
  left join public.matches m
    on m.status in ('done','forfeit') and (m.p1 = p.id or m.p2 = p.id)
  where p.is_bot = false or (select n from humans) < 100
  group by p.id, p.nickname, p.rating
  having count(m.id) > 0
  order by p.rating desc, wins desc
  limit least(greatest(limit_n, 1), 100);
$function$;

revoke execute on function public.leaderboard(integer) from public;
grant execute on function public.leaderboard(integer) to anon, authenticated;;
