-- Hardening for 0026, and the moderation runbook it implied.
--
-- search_path pinned per this repo's convention for owned functions (0001 set
-- the pattern). The body touches no tables, but conventions exist so nobody
-- has to re-derive which functions are exempt.
alter function public.lock_nickname() set search_path = pg_catalog;

-- MODERATION RUNBOOK (SQL editor / service role only — by design there is NO
-- API path that can rewrite a nickname, service_role included; the trigger
-- refuses everyone). To clean an offensive claimed name:
--
--   update public.profiles set named_at = null      where id = '<uuid>';
--   update public.profiles set nickname = 'Cleaned' where id = '<uuid>';
--
-- The first statement does not fire the OF-nickname trigger; the second
-- stamps named_at again, so the player is NOT handed a fresh claim.
