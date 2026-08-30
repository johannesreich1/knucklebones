-- The board now draws every player's die (0022), and all 13 bots wore the
-- default die:5:cy — a column of identical cyan fives, which reads as a
-- rendering bug, not a population. Spread them across the avatar space the
-- same way their nicknames were generated: deterministically, from the id.
-- Only rows still ON the default move; a bot never overwrites a human, and
-- re-running is a no-op for anyone already varied.
update public.profiles
set avatar = 'die:' || (1 + (abs(hashtext(id::text)) % 6))::text || ':' ||
             (array['cy','mg','gold','green','violet','orange'])[1 + ((abs(hashtext(id::text)) / 6) % 6)]
where is_bot and avatar = 'die:5:cy';;
