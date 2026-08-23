begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

select ok(
  not has_table_privilege('authenticated', 'public.match_seeds', 'select'),
  'participants cannot read authoritative match seeds'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'rating', 'update'),
  'players cannot update their rating mirror'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'nickname', 'update'),
  'players retain the one-time nickname column grant'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'avatar', 'update'),
  'players can update their avatar column'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('60000000-0000-0000-0000-000000000001', 'rls-me@example.invalid', now(), now()),
  ('60000000-0000-0000-0000-000000000002', 'rls-opponent@example.invalid', now(), now()),
  ('60000000-0000-0000-0000-000000000003', 'rls-stranger@example.invalid', now(), now()),
  ('60000000-0000-0000-0000-000000000004', 'rls-stranger-opponent@example.invalid', now(), now());

insert into public.matches (id, p1, p2, status, turn, season_id)
values
  (
    '70000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000002',
    'active', 1, 1
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    '60000000-0000-0000-0000-000000000003',
    '60000000-0000-0000-0000-000000000004',
    'active', 1, 1
  );

insert into public.match_moves (match_id, idx, who, col)
values
  ('70000000-0000-0000-0000-000000000001', 0, 1, 0),
  ('70000000-0000-0000-0000-000000000002', 0, 1, 1);

insert into public.matchmaking_queue (player_id)
values
  ('60000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000003');

select set_config(
  'request.jwt.claim.sub',
  '60000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.profiles),
  1,
  'profile RLS reveals only the caller row'
);
select is(
  (select id from public.profiles),
  '60000000-0000-0000-0000-000000000001'::uuid,
  'the visible profile belongs to the caller'
);
select is(
  (select count(*)::integer from public.matches),
  1,
  'match RLS hides matches where the caller is not a participant'
);
select is(
  (select id from public.matches),
  '70000000-0000-0000-0000-000000000001'::uuid,
  'the visible match includes the caller'
);
select is(
  (select count(*)::integer from public.match_moves),
  1,
  'move RLS follows participant visibility through its match'
);
select is(
  (select match_id from public.match_moves),
  '70000000-0000-0000-0000-000000000001'::uuid,
  'the visible move belongs to the caller match'
);
select is(
  (select count(*)::integer from public.matchmaking_queue),
  1,
  'queue RLS reveals only the caller entry'
);
select lives_ok(
  $$delete from public.matchmaking_queue
     where player_id = '60000000-0000-0000-0000-000000000001'$$,
  'a player can leave their own queue entry'
);
select lives_ok(
  $$delete from public.matchmaking_queue
     where player_id = '60000000-0000-0000-0000-000000000003'$$,
  'deleting another queue entry is safely filtered to zero rows'
);
select lives_ok(
  $$update public.profiles
       set avatar = 'die:2:gold'
     where id = '60000000-0000-0000-0000-000000000001'$$,
  'a player can update their own granted avatar column'
);

reset role;

select is(
  (select count(*)::integer
     from public.matchmaking_queue
    where player_id = '60000000-0000-0000-0000-000000000001'),
  0,
  'the own queue deletion took effect'
);
select is(
  (select count(*)::integer
     from public.matchmaking_queue
    where player_id = '60000000-0000-0000-0000-000000000003'),
  1,
  'RLS preserved the unrelated queue entry'
);
select is(
  (select avatar
     from public.profiles
    where id = '60000000-0000-0000-0000-000000000001'),
  'die:2:gold'::text,
  'the caller avatar update took effect'
);

select * from finish();
rollback;
