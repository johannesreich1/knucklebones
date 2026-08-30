-- 0016 seeded the bots across the ladder in season_ratings but left
-- profiles.rating (the MIRROR that matchmaking reads) at 0, so pvp-join saw a
-- flat pool and the spread it was given had no effect on pairing. The mirror
-- is derived data; this makes it agree with the ladder it mirrors.
update public.profiles p
   set rating = sr.points
  from public.season_ratings sr
 where sr.player = p.id
   and sr.season_id = public.current_season()
   and p.rating is distinct from sr.points;;
