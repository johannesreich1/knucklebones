-- Express the two participant predicates as independent branches. The former
-- `(p1 = uid OR p2 = uid)` shape could make PostgreSQL scan one participant
-- index and filter the other side; each branch below has equality on the
-- leading key of its matching partial history index.

drop function if exists public.match_history(integer, timestamptz, uuid);

create function public.match_history(
  limit_n integer default 40,
  before_t timestamptz default null,
  before_id uuid default null
)
returns table(id uuid, finished_at timestamptz, opponent text, mode text,
              mine integer, theirs integer, delta integer, result text)
language sql
stable
security definer
set search_path = ''
as $function$
  with history as (
    select m.id,
           m.finished_at,
           opponent.nickname as opponent,
           coalesce(m.modifier, 'classic') as mode,
           m.p1_score as mine,
           m.p2_score as theirs,
           m.p1_rating_delta as delta,
           case when m.winner is null then 'draw'
                when m.winner = auth.uid() then 'win' else 'loss' end as result
      from public.matches m
      join public.profiles opponent on opponent.id = m.p2
     where m.p1 = auth.uid()
       and m.status <> 'active'
       and m.season_id = public.current_season()
       and (
         before_t is null
         or m.finished_at < before_t
         or (before_id is not null and m.finished_at = before_t and m.id < before_id)
       )

    union all

    select m.id,
           m.finished_at,
           opponent.nickname as opponent,
           coalesce(m.modifier, 'classic') as mode,
           m.p2_score as mine,
           m.p1_score as theirs,
           m.p2_rating_delta as delta,
           case when m.winner is null then 'draw'
                when m.winner = auth.uid() then 'win' else 'loss' end as result
      from public.matches m
      join public.profiles opponent on opponent.id = m.p1
     where m.p2 = auth.uid()
       and m.status <> 'active'
       and m.season_id = public.current_season()
       and (
         before_t is null
         or m.finished_at < before_t
         or (before_id is not null and m.finished_at = before_t and m.id < before_id)
       )
  )
  select history.id,
         history.finished_at,
         history.opponent,
         history.mode,
         history.mine,
         history.theirs,
         history.delta,
         history.result
    from history
   order by history.finished_at desc nulls last, history.id desc
   limit least(greatest(limit_n, 1), 100);
$function$;

revoke execute on function public.match_history(integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.match_history(integer, timestamptz, uuid)
  to authenticated;
