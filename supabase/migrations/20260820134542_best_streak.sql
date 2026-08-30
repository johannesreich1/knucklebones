-- The longest run of wins this season. A profile's "record" is W–L, which says
-- how you have done in total; a streak says how well it has ever GONE, and
-- that is the number a player quotes. Computed over the whole season rather
-- than a recent window, so it cannot shrink as older matches scroll away.
create or replace function public.best_streak()
returns integer
language sql
stable security definer
set search_path to ''
as $function$
  with played as (
    select (m.winner = auth.uid()) as won,
           row_number() over (order by m.finished_at) as n
    from public.matches m
    where (m.p1 = auth.uid() or m.p2 = auth.uid())
      and m.status <> 'active'
      and m.season_id = public.current_season()
  ),
  -- the classic gaps-and-islands trick: within a run of equal `won`, the
  -- difference between the row number and the per-value row number is constant
  runs as (
    select won, n - row_number() over (partition by won order by n) as grp
    from played
  )
  select coalesce((select count(*)::integer from runs where won group by grp
                   order by count(*) desc limit 1), 0);
$function$;

revoke execute on function public.best_streak() from public;
grant execute on function public.best_streak() to authenticated;;
