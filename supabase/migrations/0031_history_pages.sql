-- Match history learns to page: the list was capped at 40 with no way to
-- reach anything older — fine for performance, silently wrong for a player
-- with a season of games (user call: lazy-load, the group can become huge).
-- Keyset on finished_at: `before_t` fetches the page strictly OLDER than the
-- last row the client holds. Null keeps the old behaviour bit-for-bit, so
-- shipped clients calling the one-argument form are untouched — CREATE OR
-- REPLACE cannot add a parameter to an existing signature, so the old
-- function is dropped and both grants restated.
drop function if exists public.match_history(integer);
create function public.match_history(limit_n integer default 40,
                                     before_t timestamptz default null)
returns table(id uuid, finished_at timestamptz, opponent text, mode text,
              mine integer, theirs integer, delta integer, result text)
language sql
stable security definer
set search_path to ''
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
    and (before_t is null or m.finished_at < before_t)
  order by m.finished_at desc nulls last
  limit least(greatest(limit_n, 1), 100);
$function$;

revoke execute on function public.match_history(integer, timestamptz) from public;
grant execute on function public.match_history(integer, timestamptz) to authenticated;
