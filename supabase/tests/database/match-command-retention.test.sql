begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(19);

select ok(
  exists (select 1 from pg_extension where extname = 'pg_cron'),
  'pg_cron is installed for command retention'
);
select ok(
  exists (
    select 1
      from pg_proc
     where oid = to_regprocedure(
       'private.purge_expired_match_commands(timestamp with time zone,integer)'
     )
       and not prosecdef
       and provolatile = 'v'
       and prorettype = 'integer'::regtype
       and pronargs = 2
       and pronargdefaults = 1
       and oidvectortypes(proargtypes) = 'timestamp with time zone, integer'
       and 'search_path=""' = any(coalesce(proconfig, array[]::text[]))
  ),
  'the cleanup has the exact bounded security-invoker signature'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.purge_expired_match_commands(timestamp with time zone,integer)',
    'execute'
  ),
  'anonymous callers cannot purge command receipts'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.purge_expired_match_commands(timestamp with time zone,integer)',
    'execute'
  ),
  'authenticated callers cannot purge command receipts'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.purge_expired_match_commands(timestamp with time zone,integer)',
    'execute'
  ),
  'the Edge Function service role cannot purge command receipts'
);
select is(
  (select pg_get_indexdef(indexrelid)
     from pg_index
    where indexrelid = to_regclass('private.match_commands_retention_idx')),
  'CREATE INDEX match_commands_retention_idx ON private.match_commands USING btree (created_at, match_id, command_id)',
  'the cleanup index starts at the retention boundary and covers command keys'
);
select is(
  (select count(*)::integer from cron.job
    where jobname = 'purge-expired-match-commands'),
  1,
  'exactly one named cleanup job is scheduled'
);
select is(
  (select concat(
     schedule, '/', active, '/',
     btrim(regexp_replace(command, '[[:space:]]+', ' ', 'g'))
   ) from cron.job where jobname = 'purge-expired-match-commands'),
  '0 * * * */t/select private.purge_expired_match_commands( clock_timestamp() - interval ''7 days'', 5000 );',
  'the active hourly job applies the seven-day boundary and 5000-row batch'
);
select throws_ok(
  $$select private.purge_expired_match_commands(null, 5000)$$,
  '22023',
  'invalid match-command retention boundary',
  'a null retention boundary is rejected'
);
select throws_ok(
  $$select private.purge_expired_match_commands(now(), 5001)$$,
  '22023',
  'invalid match-command retention boundary',
  'a batch larger than 5000 rows is rejected'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', 'retention-1@example.invalid', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', 'retention-2@example.invalid', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', 'retention-3@example.invalid', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', 'retention-4@example.invalid', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', 'retention-5@example.invalid', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', 'retention-6@example.invalid', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', 'retention-7@example.invalid', now(), now()),
  ('a0000000-0000-0000-0000-000000000008', 'retention-8@example.invalid', now(), now());

insert into public.matches (id, p1, p2, status, next_die, finished_at, season_id)
values
  ('a1000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000002', 'active', 4, null, 1),
  ('a1000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000004', 'done', null, now() - interval '8 days', 1),
  ('a1000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000005',
   'a0000000-0000-0000-0000-000000000006', 'done', null, now() - interval '6 days', 1),
  ('a1000000-0000-0000-0000-000000000004',
   'a0000000-0000-0000-0000-000000000007',
   'a0000000-0000-0000-0000-000000000008', 'forfeit', null, now() - interval '8 days', 1);

insert into private.match_commands (
  match_id, command_id, actor, requested_col, auto,
  expected_move_count, response, created_at
)
values
  ('a1000000-0000-0000-0000-000000000001',
   'a2000000-0000-4000-8000-000000000001',
   'a0000000-0000-0000-0000-000000000001', 0, false, 0,
   '{"match":{"id":"a1000000-0000-0000-0000-000000000001"},"your_die":4}',
   now() - interval '30 days'),
  ('a1000000-0000-0000-0000-000000000002',
   'a2000000-0000-4000-8000-000000000002',
   'a0000000-0000-0000-0000-000000000003', 1, false, 0,
   '{"match":{"id":"a1000000-0000-0000-0000-000000000002"},"your_die":2}',
   now() - interval '8 days'),
  ('a1000000-0000-0000-0000-000000000003',
   'a2000000-0000-4000-8000-000000000003',
   'a0000000-0000-0000-0000-000000000005', 2, false, 0,
   '{"match":{"id":"a1000000-0000-0000-0000-000000000003"},"your_die":3}',
   now() - interval '8 days'),
  ('a1000000-0000-0000-0000-000000000004',
   'a2000000-0000-4000-8000-000000000004',
   'a0000000-0000-0000-0000-000000000007', 0, true, 0,
   '{"match":{"id":"a1000000-0000-0000-0000-000000000004"},"your_die":6}',
   now() - interval '8 days'),
  ('a1000000-0000-0000-0000-000000000004',
   'a2000000-0000-4000-8000-000000000005',
   'a0000000-0000-0000-0000-000000000007', 1, false, 1,
   '{"match":{"id":"a1000000-0000-0000-0000-000000000004"},"your_die":5}',
   now() - interval '6 days');

select is(
  private.purge_expired_match_commands(now() - interval '7 days', 1),
  1,
  'one cleanup invocation obeys its requested batch limit'
);
select is(
  (select count(*)::integer
     from private.match_commands command
     join public.matches match on match.id = command.match_id
    where command.created_at < now() - interval '7 days'
      and match.finished_at < now() - interval '7 days'),
  1,
  'one eligible receipt remains for the next batch'
);
select is(
  (select count(*)::integer from private.match_commands
    where match_id = 'a1000000-0000-0000-0000-000000000001'),
  1,
  'old receipts for active matches never expire'
);
select is(
  (select count(*)::integer from private.match_commands
    where match_id = 'a1000000-0000-0000-0000-000000000003'),
  1,
  'receipts survive until seven days after match completion'
);
select is(
  (select count(*)::integer from private.match_commands
    where command_id = 'a2000000-0000-4000-8000-000000000005'),
  1,
  'a recent receipt survives even for an older terminal match'
);
select is(
  private.purge_expired_match_commands(now() - interval '7 days'),
  1,
  'the next bounded cleanup drains the remaining eligible receipt'
);
select is(
  public.match_command_result(
    'a1000000-0000-0000-0000-000000000002',
    'a2000000-0000-4000-8000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    1::smallint, false, 0
  ),
  null::jsonb,
  'an expired command no longer has a cached response'
);
select is(
  public.match_command_result(
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    0::smallint, false, 0
  ),
  '{"match":{"id":"a1000000-0000-0000-0000-000000000001"},"your_die":4}'::jsonb,
  'a retained command still replays its exact response'
);
select is(
  (select count(*)::integer from public.matches
    where id::text like 'a1000000-0000-0000-0000-%'),
  4,
  'receipt cleanup preserves authoritative match rows'
);

select * from finish();
rollback;
