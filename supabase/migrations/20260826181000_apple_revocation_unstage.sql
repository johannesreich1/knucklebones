-- Held Apple/Game Center rollout follow-up: compensate a failed auth deletion.
-- stage_apple_revocation flips the vault credential active -> pending BEFORE
-- auth.admin.deleteUser so a crash after the deletion still revokes the Apple
-- grant. When deleteUser itself fails the account lives on, and the staged row
-- must return to 'active' before the retry cron claims it — otherwise a live
-- user's Sign in with Apple authorization is revoked. A row the cron already
-- moved to 'processing' is deliberately left alone: its revocation is in
-- flight and no longer compensable here.
create function public.unstage_apple_revocation(p_user uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  update private.apple_revocation_credentials
  set state = 'active', attempt_count = 0, next_attempt_at = null,
      expires_at = null, processing_started_at = null, updated_at = now()
  where user_id = p_user and state = 'pending'
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.unstage_apple_revocation(uuid)
  from public, anon, authenticated;
grant execute on function public.unstage_apple_revocation(uuid) to service_role;
