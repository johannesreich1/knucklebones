begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

select has_index(
  'public', 'matches', 'matches_p1_history_idx',
  'p1 history lookup has a partial keyset index'
);
select has_index(
  'public', 'matches', 'matches_p2_history_idx',
  'p2 history lookup has a partial keyset index'
);
select alike(
  pg_get_indexdef('public.matches_p1_history_idx'::regclass),
  '%finished_at DESC NULLS LAST, id DESC%',
  'p1 history index physically matches the API order'
);
select alike(
  pg_get_indexdef('public.matches_p2_history_idx'::regclass),
  '%finished_at DESC NULLS LAST, id DESC%',
  'p2 history index physically matches the API order'
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
  ),
  (
    '40000000-0000-0000-0000-000000000004',
    '30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    'active', 1, null,
    null, null, null, null, 1, null
  ),
  (
    '40000000-0000-0000-0000-000000000005',
    '30000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000003',
    'done', 1, '30000000-0000-0000-0000-000000000002',
    21, 8, 20, -10, 1, '2026-08-23 11:31:00+00'
  );

select set_config('knucklebones.progression_v2_start', '1', true);
update public.matches
   set curve_version = 2, scoring_version = 2,
       p1_base_rating_delta = 25, p2_base_rating_delta = -15,
       p1_finish_rating_delta = 5, p2_finish_rating_delta = -5
 where id = '40000000-0000-0000-0000-000000000001';
update public.matches
   set curve_version = 2, scoring_version = 2,
       p1_base_rating_delta = -6, p2_base_rating_delta = 36,
       p1_finish_rating_delta = -4, p2_finish_rating_delta = 4
 where id = '40000000-0000-0000-0000-000000000003';

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000001',
  true
);

select is(
  (select jsonb_build_object(
      'base', base_delta, 'finish', finish_delta, 'version', scoring_version
    )
     from public.match_history(10, null, null)
    where id = '40000000-0000-0000-0000-000000000001'),
  '{"base":25,"finish":5,"version":2}'::jsonb,
  'history returns p1 formula-v2 components in the existing RPC row'
);
select is(
  (select jsonb_build_object(
      'base', base_delta, 'finish', finish_delta, 'version', scoring_version
    )
     from public.match_history(10, null, null)
    where id = '40000000-0000-0000-0000-000000000003'),
  '{"base":36,"finish":4,"version":2}'::jsonb,
  'history swaps formula-v2 components for the p2 participant'
);

-- Keep the query-plan requirement durable without depending on the current
-- fixture size. These are the two SQL-function branches verbatim at the
-- participant/index boundary; disabling sequential scans makes an accidental
-- index-shape regression fail instead of disappearing on a tiny test table.
set local enable_seqscan = off;
set local enable_mergejoin = off;
set local enable_hashjoin = off;
analyze public.matches;
analyze public.profiles;
create function pg_temp.explain_json(p_query text)
returns jsonb
language plpgsql
as $function$
declare
  v_plan jsonb;
begin
  execute 'explain (format json, costs off) ' || p_query into v_plan;
  return v_plan;
end;
$function$;

select alike(
  pg_temp.explain_json($query$
    select m.id, m.finished_at, opponent.nickname
      from public.matches m
      join public.profiles opponent on opponent.id = m.p2
     where m.p1 = '30000000-0000-0000-0000-000000000001'::uuid
       and m.status <> 'active'
       and m.season_id = 1
       and (m.finished_at, m.id) < (
         '2026-08-23 11:30:00+00'::timestamptz,
         '40000000-0000-0000-0000-000000000002'::uuid
       )
     order by m.finished_at desc nulls last, m.id desc
     limit 10
  $query$)::text,
  '%matches_p1_history_idx%',
  'the p1 branch uses its participant-first keyset index'
);
select unalike(
  pg_temp.explain_json($query$
    select m.id, m.finished_at, opponent.nickname
      from public.matches m
      join public.profiles opponent on opponent.id = m.p2
     where m.p1 = '30000000-0000-0000-0000-000000000001'::uuid
       and m.status <> 'active'
       and m.season_id = 1
       and (m.finished_at, m.id) < (
         '2026-08-23 11:30:00+00'::timestamptz,
         '40000000-0000-0000-0000-000000000002'::uuid
       )
     order by m.finished_at desc nulls last, m.id desc
     limit 10
  $query$)::text,
  '%"Node Type": "Sort"%',
  'the p1 keyset branch does not add an explicit sort'
);
select alike(
  pg_temp.explain_json($query$
    select m.id, m.finished_at, opponent.nickname
      from public.matches m
      join public.profiles opponent on opponent.id = m.p1
     where m.p2 = '30000000-0000-0000-0000-000000000001'::uuid
       and m.status <> 'active'
       and m.season_id = 1
       and (m.finished_at, m.id) < (
         '2026-08-23 11:30:00+00'::timestamptz,
         '40000000-0000-0000-0000-000000000002'::uuid
       )
     order by m.finished_at desc nulls last, m.id desc
     limit 10
  $query$)::text,
  '%matches_p2_history_idx%',
  'the p2 branch uses its participant-first keyset index'
);
select unalike(
  pg_temp.explain_json($query$
    select m.id, m.finished_at, opponent.nickname
      from public.matches m
      join public.profiles opponent on opponent.id = m.p1
     where m.p2 = '30000000-0000-0000-0000-000000000001'::uuid
       and m.status <> 'active'
       and m.season_id = 1
       and (m.finished_at, m.id) < (
         '2026-08-23 11:30:00+00'::timestamptz,
         '40000000-0000-0000-0000-000000000002'::uuid
       )
     order by m.finished_at desc nulls last, m.id desc
     limit 10
  $query$)::text,
  '%"Node Type": "Sort"%',
  'the p2 keyset branch does not add an explicit sort'
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
  (select count(*)::integer
     from public.match_history(10, null, null)
    where id = '40000000-0000-0000-0000-000000000004'),
  0,
  'active participant matches are excluded from history'
);
select is(
  (select count(*)::integer
     from public.match_history(10, null, null)
    where id = '40000000-0000-0000-0000-000000000005'),
  0,
  'finished matches between unrelated players are excluded from history'
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
