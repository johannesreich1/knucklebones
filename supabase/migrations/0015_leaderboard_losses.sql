-- Applied 2026-08-20 via MCP. The ladder printed "42W/103" — wins over games,
-- so a LOSS never appeared anywhere on it, while the HUD and the account card
-- have always said W · L. The ladder now returns the same fact those two
-- state, and the client says it the same way.
--
-- Losses are counted exactly as myRecord() counts them client-side: a decided
-- match this profile did not win. A draw (winner is null) is neither, so it
-- shows in neither column — and a forfeit DOES name a winner, so it lands on
-- the correct side by itself. games stays: wins + losses + draws = games is
-- the invariant that makes the row auditable.
--
-- The return type changes and Postgres will not replace a function's return
-- type in place, so this drops and recreates. A DROP also takes the grants and
-- the PUBLIC revoke with it — a fresh CREATE hands EXECUTE back to PUBLIC by
-- default — so both are restated below. This whole file runs in one
-- transaction; the function is never missing to a live client.
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
grant execute on function public.leaderboard(integer) to anon, authenticated;
