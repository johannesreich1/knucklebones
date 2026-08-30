-- Applied 2026-08-16 via MCP (pvp_pivot_v2_lockdown).
-- Trigger bodies and the nickname generator are not API surface.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.generate_nickname() from public, anon, authenticated;
