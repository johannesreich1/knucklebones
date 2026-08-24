-- A null locale follows the current device/browser. Concrete values are the
-- user's cross-device override and deliberately use base language tags only.
alter table public.player_settings
  add column locale text default null,
  add constraint player_settings_locale_check
    check (locale is null or locale in ('en', 'de', 'fr'));

comment on column public.player_settings.locale is
  'Null follows the current device language; otherwise a supported base locale override.';
