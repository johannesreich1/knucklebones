-- Device-gated with gc-auth and migration 0014. RLS bypass does not replace
-- ordinary table privileges: the Edge Function needs explicit access on clean
-- projects whose public entities are not auto-exposed.

revoke all on table public.game_center_ids
  from public, anon, authenticated, service_role;
grant select, insert on table public.game_center_ids to service_role;
