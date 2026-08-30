-- A profile's owner may rename themselves — and change NOTHING else. rating
-- and is_bot are server-written (Edge Functions via service role) only.
-- Inserts are not a client operation at all anymore: the signup trigger
-- creates every profile.
revoke insert, update on public.profiles from authenticated;
grant update (nickname) on public.profiles to authenticated;
drop policy profiles_insert_own on public.profiles;;
