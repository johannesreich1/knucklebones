-- Match history, joined SERVER-side.
--
-- The client cannot read another player's profile — profiles is own-row only
-- (profiles_select_own) — so a client-side join for opponent nicknames returns
-- nothing and every row reads "???". The leaderboard already solved this the
-- same way: a security-definer function that returns exactly the columns a
-- player is allowed to see about somebody else, and nothing more.
--
-- The delta is what the match ACTUALLY paid. It is the only place a points
-- number is honest, because what a match is worth depends on the opponent —
-- which is why nothing is ever previewed before one.
create or replace function public.match_history(limit_n integer default 40)
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
  order by m.finished_at desc nulls last
  limit least(greatest(limit_n, 1), 100);
$function$;

revoke execute on function public.match_history(integer) from public;
grant execute on function public.match_history(integer) to authenticated;
