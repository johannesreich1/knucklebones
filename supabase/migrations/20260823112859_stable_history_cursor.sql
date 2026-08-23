-- Give match-history pagination a total order. `finished_at` alone can tie
-- when concurrent matches settle in the same clock tick; using the match id
-- as the second key prevents a row from being skipped between pages. The
-- partial indexes follow the participant predicates used by the RPC and omit
-- active matches, which never appear in history.

create index if not exists matches_p1_history_idx
  on public.matches (p1, season_id, finished_at desc, id desc)
  where status <> 'active';

create index if not exists matches_p2_history_idx
  on public.matches (p2, season_id, finished_at desc, id desc)
  where status <> 'active';

drop function if exists public.match_history(integer, timestamptz);

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
  select m.id,
         m.finished_at,
         opp.nickname,
         coalesce(m.modifier, 'classic'),
         (case when m.p1 = auth.uid() then m.p1_score else m.p2_score end),
         (case when m.p1 = auth.uid() then m.p2_score else m.p1_score end),
         (case when m.p1 = auth.uid() then m.p1_rating_delta else m.p2_rating_delta end),
         (case when m.winner is null then 'draw'
               when m.winner = auth.uid() then 'win' else 'loss' end)
    from public.matches m
    join public.profiles opp
      on opp.id = (case when m.p1 = auth.uid() then m.p2 else m.p1 end)
   where (m.p1 = auth.uid() or m.p2 = auth.uid())
     and m.status <> 'active'
     and m.season_id = public.current_season()
     and (
       before_t is null
       or m.finished_at < before_t
       or (before_id is not null and m.finished_at = before_t and m.id < before_id)
     )
   order by m.finished_at desc nulls last, m.id desc
   limit least(greatest(limit_n, 1), 100);
$function$;

revoke execute on function public.match_history(integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.match_history(integer, timestamptz, uuid)
  to authenticated;
