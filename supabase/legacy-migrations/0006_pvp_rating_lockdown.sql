-- Applied 2026-08-16 via MCP (pvp_rating_lockdown).
-- A profile's owner may rename themselves - and change NOTHING else. rating
-- and is_bot are server-written only. Inserts happen via the signup trigger.
revoke insert, update on public.profiles from authenticated;
grant update (nickname) on public.profiles to authenticated;
drop policy profiles_insert_own on public.profiles;
