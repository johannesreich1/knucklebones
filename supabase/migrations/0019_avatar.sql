-- The profile picture.
--
-- Spec: docs/LADDER.md §5. A die face and a hue — "die:<1-6>:<hue>" — which is
-- 36 identities, needs no storage bucket, no moderation, and no
-- user-generated-image obligations at App Store review.
--
-- The string format is the seam, not an accident: a later value can be
-- "img:<storage-path>" with no schema change and no backfill.
alter table public.profiles
  add column if not exists avatar text not null default 'die:5:cy';

-- Shape only — this deliberately does NOT enumerate the hues, so adding one is
-- a client change rather than a migration. It exists to stop a client writing
-- a storage path (or anything else) before there is a bucket to serve it.
alter table public.profiles
  drop constraint if exists profiles_avatar_shape;
alter table public.profiles
  add constraint profiles_avatar_shape
  check (avatar ~ '^die:[1-6]:[a-z]{2,10}$');

-- The owner may change their own avatar. profiles' existing update policy
-- covers the row; the column grant is what actually decides, exactly as it
-- does for nickname — rating and is_bot stay service-role only, because a
-- client that could write its own points would award itself the season.
grant update (avatar) on public.profiles to authenticated;
