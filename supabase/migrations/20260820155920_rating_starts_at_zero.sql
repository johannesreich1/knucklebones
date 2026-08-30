-- The rating mirror starts at 0, like the season it mirrors.
--
-- profiles.rating kept its pre-ladder default of 1000 (the old Elo centre)
-- through the cutover: 0016 reset every EXISTING profile to 0 but never
-- touched the column default, so every signup since starts at 1000 until
-- their first settle overwrites the mirror. Found live on 2026-08-20: a
-- brand-new guest entered matchmaking showing rating 1000 — which, under the
-- honest-opponent model (LADDER.md §4), would hand every newcomer an
-- IVORY-strength first bot instead of a STONE one, and let them pair far
-- above their real standing against humans too.
alter table public.profiles alter column rating set default 0;

-- Re-mirror the profiles the stale default already touched. The season table
-- is the truth: a profile at 1000 either has a season row (mirror := its
-- points) or has never settled a match (mirror := 0). Guarded by the season
-- lookup so a player who someday genuinely sits at 1000 is left alone.
update public.profiles p
   set rating = coalesce((select sr.points
                            from public.season_ratings sr
                           where sr.season_id = public.current_season()
                             and sr.player = p.id), 0)
 where p.rating = 1000;;
