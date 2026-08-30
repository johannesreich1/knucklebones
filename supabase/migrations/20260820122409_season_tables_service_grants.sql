-- The Edge Functions run as service_role, and 0016 created these tables
-- without granting it anything: every ladder read came back empty (so
-- ladderRow() fell to its 0 default and two live matches settled 0-vs-0 as if
-- both players were unrated) and every write was discarded. RLS was never the
-- problem — service_role bypasses that; plain table privileges were.
grant select, insert, update, delete on public.season_ratings to service_role;
grant select, insert, update, delete on public.seasons        to service_role;
-- anon/authenticated keep read-only, exactly as 0016 intended: a client that
-- could write its own points would award itself the season.
grant select on public.season_ratings to anon, authenticated;
grant select on public.seasons        to anon, authenticated;;
