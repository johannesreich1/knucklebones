begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

select has_index(
  'public', 'matches', 'matches_p1_history_idx',
  'p1 history lookup has a partial keyset index'
);
select has_index(
  'public', 'matches', 'matches_p2_history_idx',
  'p2 history lookup has a partial keyset index'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.match_history(integer,timestamp with time zone,uuid)',
    'execute'
  ),
  'anonymous clients cannot read private match history'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.match_history(integer,timestamp with time zone,uuid)',
    'execute'
  ),
  'authenticated clients can read their match history'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('30000000-0000-0000-0000-000000000001', 'history-me@example.invalid', now(), now()),
  ('30000000-0000-0000-0000-000000000002', 'history-a@example.invalid', now(), now()),
  ('30000000-0000-0000-0000-000000000003', 'history-b@example.invalid', now(), now());

insert into public.matches (
  id, p1, p2, status, turn, winner, p1_score, p2_score,
  p1_rating_delta, p2_rating_delta, season_id, finished_at
)
values
  (
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    'done', 1, '30000000-0000-0000-0000-000000000001',
    24, 12, 30, -20, 1, '2026-08-23 11:30:00+00'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000003',
    'done', 1, '30000000-0000-0000-0000-000000000003',
    9, 18, -20, 30, 1, '2026-08-23 11:30:00+00'
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    'done', 1, '30000000-0000-0000-0000-000000000001',
    20, 25, -10, 40, 1, '2026-08-23 11:29:00+00'
  );

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000001',
  true
);

select is(
  (select id from public.match_history(1, null, null)),
  '40000000-0000-0000-0000-000000000002'::uuid,
  'equal timestamps are ordered by descending match id'
);
select is(
  (select id from public.match_history(
    1,
    '2026-08-23 11:30:00+00',
    '40000000-0000-0000-0000-000000000002'
  )),
  '40000000-0000-0000-0000-000000000001'::uuid,
  'the compound cursor reaches the tied row on the next page'
);
select is(
  (select id from public.match_history(
    1,
    '2026-08-23 11:30:00+00',
    '40000000-0000-0000-0000-000000000001'
  )),
  '40000000-0000-0000-0000-000000000003'::uuid,
  'the cursor advances from a timestamp tie to the next older row'
);
select is(
  (select count(*)::integer from public.match_history(
    10,
    '2026-08-23 11:30:00+00',
    null
  )),
  1,
  'legacy time-only cursors retain strictly-older behavior'
);
select is(
  (select array_agg(id order by finished_at desc, id desc)
     from public.match_history(10, null, null)),
  array[
    '40000000-0000-0000-0000-000000000002'::uuid,
    '40000000-0000-0000-0000-000000000001'::uuid,
    '40000000-0000-0000-0000-000000000003'::uuid
  ],
  'a full page contains every tied row once in total order'
);
select is(
  (select count(*)::integer from public.match_history(
    10,
    '2026-08-23 11:29:00+00',
    '40000000-0000-0000-0000-000000000003'
  )),
  0,
  'the final compound cursor does not repeat a row'
);
select is(
  (select concat(mine, '/', theirs, '/', delta, '/', result)
     from public.match_history(10, null, null)
    where id = '40000000-0000-0000-0000-000000000003'),
  '25/20/40/win',
  'the p2 branch projects scores, delta, and result from the caller side'
);
select is(
  (select count(*)::integer
     from pg_proc
    where oid = 'public.match_history(integer,timestamp with time zone,uuid)'::regprocedure),
  1,
  'only the stable three-argument history signature is installed'
);

select * from finish();
rollback;
