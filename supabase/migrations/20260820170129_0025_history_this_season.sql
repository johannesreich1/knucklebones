-- Match history speaks the same season as the screen that opens it.
--
-- Player report (Johannes, 2026-08-20): the history header said 2 games while
-- the list ran to a hundred rows. The header tally reads season_ratings — the
-- CURRENT season — but 0020's list had no season filter, so it poured out the
-- whole retired Elo era (103 pre-season matches) under a Season-1 headline.
-- Nothing was leaking (the WHERE is self-only) and nothing was deleted (the
-- cutover retired matches into season 0 on purpose); the two halves of one
-- screen were just answering different questions.
--
-- The list now scopes to the live season, like every other number on the
-- profile. The client states what is held back — "Pre-season · N matches" —
-- so the retirement stays visible truth rather than a mystery. Same signature
-- and return type, so replace-in-place keeps the grants.
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
    and m.season_id = public.current_season()
  order by m.finished_at desc nulls last
  limit least(greatest(limit_n, 1), 100);
$function$;;
