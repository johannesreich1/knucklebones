-- Install and validate the expanded allow-list before replacing the canonical
-- constraint, so there is no interval in which player settings are unchecked.
begin;

set local lock_timeout = '5s';

alter table public.player_settings
  add constraint player_settings_locale_check_11
    check (locale is null or locale in
      ('en', 'pt', 'es', 'de', 'fr', 'it', 'pl', 'tr', 'id', 'ja', 'ko'))
    not valid;

alter table public.player_settings
  validate constraint player_settings_locale_check_11;

alter table public.player_settings
  drop constraint player_settings_locale_check;

alter table public.player_settings
  rename constraint player_settings_locale_check_11
  to player_settings_locale_check;

commit;
