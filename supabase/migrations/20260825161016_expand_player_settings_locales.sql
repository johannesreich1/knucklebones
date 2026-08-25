-- Persist stable catalog identifiers only. Presentation-specific language tags
-- such as pt-BR stay at the HTML/native boundary and never enter this column.
alter table public.player_settings
  drop constraint player_settings_locale_check,
  add constraint player_settings_locale_check
    check (locale is null or locale in ('en', 'pt', 'es', 'de', 'fr', 'it'));
