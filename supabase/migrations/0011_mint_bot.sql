-- Applied 2026-08-18 via MCP. When matchmaking finds no free bot within Elo
-- range of the human (pvp-join v11: ±150), it mints one: the same auth-user
-- pattern as the 0007 pool seed, the signup trigger hands it a generated
-- nickname, then it is flagged and rated. Service-only.
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
  update public.profiles set is_bot = true, rating = target_rating where id = uid;
  return uid;
end $$;

revoke all on function public.mint_bot(int) from public, anon, authenticated;
grant execute on function public.mint_bot(int) to service_role;
