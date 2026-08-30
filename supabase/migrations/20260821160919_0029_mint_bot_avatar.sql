-- A minted bot gets a FACE, not only a name. mint_bot (0011) left the profile
-- trigger's default avatar in place, so every bot the thin-pool path created
-- after 0023's one-time backfill wore the identical cyan five again — found
-- live: the single bot minted since the backfill was the one default die on
-- the board. Same deterministic spread as 0023, now applied at mint time.
create or replace function public.mint_bot(target_rating int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
          'bot-' || uid || '@internal.invalid', now(), now());
  update public.profiles
  set is_bot = true, rating = target_rating,
      avatar = 'die:' || (1 + (abs(hashtext(uid::text)) % 6))::text || ':' ||
               (array['cy','mg','gold','green','violet','orange'])[1 + ((abs(hashtext(uid::text)) / 6) % 6)]
  where id = uid;
  return uid;
end $$;

-- ACL restated (the replace keeps it, but the file should read complete)
revoke all on function public.mint_bot(int) from public, anon, authenticated;
grant execute on function public.mint_bot(int) to service_role;

-- ...and the bots already minted onto the default catch up — 0023's spread,
-- re-run: a no-op for anyone varied, and it never touches a human's pick.
update public.profiles
set avatar = 'die:' || (1 + (abs(hashtext(id::text)) % 6))::text || ':' ||
             (array['cy','mg','gold','green','violet','orange'])[1 + ((abs(hashtext(id::text)) / 6) % 6)]
where is_bot and avatar = 'die:5:cy';;
