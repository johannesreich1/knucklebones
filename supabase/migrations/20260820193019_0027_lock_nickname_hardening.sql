-- Hardening for 0026: search_path pinned per repo convention. Moderation of a
-- claimed name is a documented two-step in the repo copy of this migration
-- (set named_at null, then rewrite nickname — the second stamp denies a fresh claim).
alter function public.lock_nickname() set search_path = pg_catalog;;
