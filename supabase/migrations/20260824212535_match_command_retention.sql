-- Idempotency responses are transport receipts, not the authoritative match
-- history. Keep them long enough for delayed retries, then remove them in
-- bounded batches after the match itself has been terminal for seven days.

create extension if not exists pg_cron with schema pg_catalog;

create index match_commands_retention_idx
  on private.match_commands (created_at, match_id, command_id);

create function private.purge_expired_match_commands(
  p_cutoff timestamptz,
  p_limit integer default 5000
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_deleted integer;
begin
  if p_cutoff is null or p_limit not between 1 and 5000 then
    raise exception 'invalid match-command retention boundary'
      using errcode = '22023';
  end if;

  with expired as materialized (
    select c.match_id, c.command_id
      from private.match_commands c
     where c.created_at < p_cutoff
       -- Keep command age as the driving index range. A regular join lets the
       -- planner start by rescanning every historical match; this scalar
       -- primary-key lookup keeps work proportional to retained receipts.
       and coalesce((
         select m.status <> 'active'
                and m.finished_at is not null
                and m.finished_at < p_cutoff
           from public.matches m
          where m.id = c.match_id
       ), false)
     order by c.created_at, c.match_id, c.command_id
     limit p_limit
  ), deleted as (
    delete from private.match_commands c
     using expired
     where c.match_id = expired.match_id
       and c.command_id = expired.command_id
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;

  return v_deleted;
end;
$function$;

revoke all on function private.purge_expired_match_commands(timestamptz, integer)
  from public, anon, authenticated, service_role;

select cron.schedule(
  'purge-expired-match-commands',
  '0 * * * *',
  $cron$
    select private.purge_expired_match_commands(
      clock_timestamp() - interval '7 days',
      5000
    );
  $cron$
);
