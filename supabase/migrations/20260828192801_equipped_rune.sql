alter table public.profiles
  add column if not exists equipped_rune text;

alter table public.profiles
  drop constraint if exists profiles_equipped_rune_owned;
alter table public.profiles
  add constraint profiles_equipped_rune_owned
  foreign key (id, equipped_rune)
  references public.player_runes (player_id, rune_id)
  on delete set null (equipped_rune)
  on update cascade;

alter table public.profiles
  drop constraint if exists profiles_equipped_rune_known;
alter table public.profiles
  add constraint profiles_equipped_rune_known
  check (equipped_rune is null
    or equipped_rune in ('fate','nudge','ward','sunder','pilfer','anvil'));

comment on column public.profiles.equipped_rune is
  'The one collected rune carried into ordinary ranked from SILVER upward. NULL means nothing equipped, which is a deliberate choice and not an error. Rune Trial ignores this and never overwrites it.';;
