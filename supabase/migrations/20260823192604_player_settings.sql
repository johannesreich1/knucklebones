-- Private, cross-device Settings. This is deliberately separate from the
-- profile/avatar surface: no leaderboard or identity query touches it, and
-- RLS exposes exactly one row to its owner.
create table public.player_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  sound boolean not null default true,
  numerals boolean not null default false,
  p1_hue text not null default 'cy'
    check (p1_hue in ('cy', 'mg', 'gold', 'green', 'violet', 'orange', 'blue')),
  p2_hue text not null default 'mg'
    check (p2_hue in ('cy', 'mg', 'gold', 'green', 'violet', 'orange', 'blue')),
  colorblind boolean not null default false,
  -- Null means "follow the current device"; a boolean is an app override.
  reduced_motion boolean,
  check (p1_hue <> p2_hue)
);

alter table public.player_settings enable row level security;

create policy player_settings_select_own on public.player_settings
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy player_settings_insert_own on public.player_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy player_settings_update_own on public.player_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table public.player_settings from public, anon, authenticated;
grant select, insert, update on table public.player_settings to authenticated;
grant all on table public.player_settings to service_role;
