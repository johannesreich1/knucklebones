-- Base table privileges (RLS then narrows rows). The migration role has no
-- default-privilege chain to anon/authenticated, so grants are explicit —
-- which is also the least-privilege posture we want:
--   anon: nothing (leaderboards go through the definer functions)
--   authenticated: exactly what the policies moderate
--   service_role: full access for the Edge Functions
grant select, insert, update on public.profiles to authenticated;
grant select on public.ranked_sessions to authenticated;
grant select on public.games to authenticated;

grant all on public.profiles, public.ranked_sessions, public.games to service_role;;
