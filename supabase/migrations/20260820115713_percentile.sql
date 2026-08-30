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

create or replace function public.player_standing(p uuid)
returns table(points integer, rank bigint, population bigint, percentile numeric)
language sql
stable security definer
set search_path to ''
as $function$
  with pop as (
    select sr.player, sr.points,
           rank() over (order by sr.points desc) as rnk,
           count(*) over () as n,
           percent_rank() over (order by sr.points) as pr
    from public.season_ratings sr
    where sr.season_id = public.current_season()
  )
  select pop.points, pop.rnk, pop.n, pop.pr from pop where pop.player = p;
$function$;

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
grant execute on function public.players_near(uuid, integer) to authenticated;;
