create extension if not exists supabase_vault with schema vault;

create table private.apple_revocation_credentials (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  client_id text not null check (client_id = 'com.appavaria.knucklebones'),
  vault_secret_id uuid not null,
  state text not null default 'active'
    check (state in ('active', 'pending', 'processing')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  expires_at timestamptz,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.apple_revocation_credentials enable row level security;

create unique index apple_revocation_credentials_user_client_idx
  on private.apple_revocation_credentials (user_id, client_id)
  where user_id is not null;
create index apple_revocation_credentials_user_id_idx
  on private.apple_revocation_credentials (user_id)
  where user_id is not null;
create index apple_revocation_credentials_due_idx
  on private.apple_revocation_credentials (next_attempt_at, id)
  where state in ('pending', 'processing');

revoke all on table private.apple_revocation_credentials
  from public, anon, authenticated, service_role;
revoke all on sequence private.apple_revocation_credentials_id_seq
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on private.apple_revocation_credentials to service_role;
grant usage, select on sequence private.apple_revocation_credentials_id_seq to service_role;
grant usage on schema private, vault to service_role;
grant execute on function vault.create_secret(text, text, text) to service_role;
grant execute on function vault.update_secret(uuid, text, text, text) to service_role;
grant select, delete on vault.secrets to service_role;
grant select on vault.decrypted_secrets to service_role;

create function public.store_apple_revocation_credential(
  p_user uuid,
  p_client_id text,
  p_refresh_token text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row private.apple_revocation_credentials%rowtype;
  v_secret uuid;
begin
  if p_user is null or p_client_id <> 'com.appavaria.knucklebones'
    or length(p_refresh_token) < 16 or length(p_refresh_token) > 8192 then
    raise exception 'invalid apple credential';
  end if;

  select * into v_row
  from private.apple_revocation_credentials
  where user_id = p_user and client_id = p_client_id
  for update;

  if found then
    perform vault.update_secret(v_row.vault_secret_id, p_refresh_token, null, null);
    update private.apple_revocation_credentials
    set state = 'active', attempt_count = 0, next_attempt_at = null,
        expires_at = null, processing_started_at = null, updated_at = now()
    where id = v_row.id;
  else
    v_secret := vault.create_secret(p_refresh_token, null,
      'Sign in with Apple refresh token for account-deletion revocation');
    insert into private.apple_revocation_credentials (user_id, client_id, vault_secret_id)
    values (p_user, p_client_id, v_secret);
  end if;
end;
$$;

create function public.apple_revocation_ready(p_user uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from private.apple_revocation_credentials
    where user_id = p_user and state = 'active'
  );
$$;

create function public.stage_apple_revocation(p_user uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  update private.apple_revocation_credentials
  set state = 'pending', attempt_count = 0, next_attempt_at = now(),
      expires_at = now() + interval '7 days', processing_started_at = null,
      updated_at = now()
  where user_id = p_user and state = 'active'
  returning id into v_id;
  return v_id;
end;
$$;

create function public.take_apple_revocation(p_credential_id bigint)
returns table (credential_id bigint, client_id text, refresh_token text, expires_at timestamptz)
language sql
set search_path = ''
as $$
  with marked as (
    update private.apple_revocation_credentials credentials
    set state = 'processing', processing_started_at = now(), updated_at = now()
    where credentials.id = p_credential_id and credentials.state = 'pending'
    returning credentials.*
  )
  select marked.id, marked.client_id, secrets.decrypted_secret, marked.expires_at
  from marked
  join vault.decrypted_secrets secrets on secrets.id = marked.vault_secret_id;
$$;

create function public.claim_apple_revocations(p_limit integer default 10)
returns table (
  credential_id bigint,
  client_id text,
  refresh_token text,
  attempt_count integer,
  expires_at timestamptz
)
language sql
set search_path = ''
as $$
  with claimed as (
    select credentials.id
    from private.apple_revocation_credentials credentials
    where (
      credentials.state = 'pending'
      and credentials.next_attempt_at <= now()
    ) or (
      credentials.state = 'processing'
      and credentials.processing_started_at < now() - interval '10 minutes'
    )
    order by credentials.next_attempt_at nulls first, credentials.id
    limit least(greatest(p_limit, 1), 50)
    for update skip locked
  ), marked as (
    update private.apple_revocation_credentials credentials
    set state = 'processing', processing_started_at = now(), updated_at = now()
    from claimed
    where credentials.id = claimed.id
    returning credentials.*
  )
  select marked.id, marked.client_id, secrets.decrypted_secret,
         marked.attempt_count, marked.expires_at
  from marked
  join vault.decrypted_secrets secrets on secrets.id = marked.vault_secret_id;
$$;

create function public.finish_apple_revocation(
  p_credential_id bigint,
  p_result text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row private.apple_revocation_credentials%rowtype;
  v_delay interval;
begin
  select * into v_row from private.apple_revocation_credentials
  where id = p_credential_id and state = 'processing'
  for update;
  if not found then return; end if;

  if p_result in ('complete', 'terminal', 'expired') then
    delete from vault.secrets where id = v_row.vault_secret_id;
    delete from private.apple_revocation_credentials where id = v_row.id;
    return;
  end if;
  if p_result <> 'retry' then raise exception 'invalid apple revocation result'; end if;

  if v_row.expires_at <= now() then
    delete from vault.secrets where id = v_row.vault_secret_id;
    delete from private.apple_revocation_credentials where id = v_row.id;
    return;
  end if;
  v_delay := least(
    interval '24 hours',
    interval '15 minutes' * power(2::numeric, least(v_row.attempt_count, 7))
  );
  update private.apple_revocation_credentials
  set state = 'pending', attempt_count = attempt_count + 1,
      next_attempt_at = now() + v_delay, processing_started_at = null,
      updated_at = now()
  where id = v_row.id;
end;
$$;

revoke all on function public.store_apple_revocation_credential(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.apple_revocation_ready(uuid)
  from public, anon, authenticated;
revoke all on function public.stage_apple_revocation(uuid)
  from public, anon, authenticated;
revoke all on function public.take_apple_revocation(bigint)
  from public, anon, authenticated;
revoke all on function public.claim_apple_revocations(integer)
  from public, anon, authenticated;
revoke all on function public.finish_apple_revocation(bigint, text)
  from public, anon, authenticated;
grant execute on function public.store_apple_revocation_credential(uuid, text, text) to service_role;
grant execute on function public.apple_revocation_ready(uuid) to service_role;
grant execute on function public.stage_apple_revocation(uuid) to service_role;
grant execute on function public.take_apple_revocation(bigint) to service_role;
grant execute on function public.claim_apple_revocations(integer) to service_role;
grant execute on function public.finish_apple_revocation(bigint, text) to service_role;
