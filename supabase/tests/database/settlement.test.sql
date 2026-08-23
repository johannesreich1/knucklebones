begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(21);

select has_index(
  'public', 'season_ratings', 'season_ratings_player_idx',
  'season rating player foreign-key lookups are indexed'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.settle_match(uuid,text,uuid,integer,integer,integer,integer,jsonb,jsonb,jsonb,jsonb)',
    'execute'
  ),
  'anon cannot execute atomic settlement'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.settle_match(uuid,text,uuid,integer,integer,integer,integer,jsonb,jsonb,jsonb,jsonb)',
    'execute'
  ),
  'authenticated clients cannot execute atomic settlement'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.settle_match(uuid,text,uuid,integer,integer,integer,integer,jsonb,jsonb,jsonb,jsonb)',
    'execute'
  ),
  'service role can execute atomic settlement'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'settle-p1@example.invalid', now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'settle-p2@example.invalid', now(), now()),
  ('10000000-0000-0000-0000-000000000003', 'delete-p1@example.invalid', now(), now()),
  ('10000000-0000-0000-0000-000000000004', 'delete-p2@example.invalid', now(), now());

insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
values
  (1, '10000000-0000-0000-0000-000000000001', 80, 90, 2, 1, 0),
  (1, '10000000-0000-0000-0000-000000000002', 40, 40, 1, 2, 0),
  (1, '10000000-0000-0000-0000-000000000003', 10, 10, 0, 1, 0),
  (1, '10000000-0000-0000-0000-000000000004', 20, 20, 1, 0, 0);

insert into public.matches (id, p1, p2, status, turn, season_id)
values
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000002', 'active', 1, 1),
  ('20000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000002', 'active', 1, 1),
  ('20000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000004', 'active', 1, 1);

create temporary table settlement_result as
select public.settle_match(
  '20000000-0000-0000-0000-000000000001',
  'done',
  '10000000-0000-0000-0000-000000000001',
  24, 12, 30, -20,
  '{"points":80,"peak":90,"wins":2,"losses":1,"draws":0}',
  '{"points":40,"peak":40,"wins":1,"losses":2,"draws":0}',
  '{"points":110,"peak":110,"wins":3,"losses":1,"draws":0}',
  '{"points":20,"peak":40,"wins":1,"losses":3,"draws":0}'
) as payload;

select is((select (payload->>'applied')::boolean from settlement_result), true,
  'first terminal caller claims the match');
select is((select status from public.matches where id = '20000000-0000-0000-0000-000000000001'),
  'done', 'match is terminal');
select is((select winner from public.matches where id = '20000000-0000-0000-0000-000000000001'),
  '10000000-0000-0000-0000-000000000001'::uuid, 'winner is stored');
select is((select p1_rating_delta from public.matches where id = '20000000-0000-0000-0000-000000000001'),
  30, 'p1 delta is stored');
select is((select points from public.season_ratings where season_id = 1 and player = '10000000-0000-0000-0000-000000000001'),
  110, 'p1 ladder row is updated');
select is((select points from public.season_ratings where season_id = 1 and player = '10000000-0000-0000-0000-000000000002'),
  20, 'p2 ladder row is updated');
select is((select rating from public.profiles where id = '10000000-0000-0000-0000-000000000001'),
  110, 'p1 profile mirror is updated');
select is((select rating from public.profiles where id = '10000000-0000-0000-0000-000000000002'),
  20, 'p2 profile mirror is updated');

select is(
  (public.settle_match(
    '20000000-0000-0000-0000-000000000001',
    'forfeit',
    '10000000-0000-0000-0000-000000000002',
    0, 0, -99, 99,
    '{}', '{}', '{}', '{}'
  )->>'applied')::boolean,
  false,
  'a racing terminal caller cannot pay the same match twice'
);
select is((select points from public.season_ratings where season_id = 1 and player = '10000000-0000-0000-0000-000000000001'),
  110, 'race loser leaves the first payout untouched');

select throws_ok(
  $$select public.settle_match(
    '20000000-0000-0000-0000-000000000002', 'done', null,
    12, 12, 0, 0,
    '{"points":999,"peak":999,"wins":0,"losses":0,"draws":0}',
    '{"points":20,"peak":40,"wins":1,"losses":3,"draws":0}',
    '{}', '{}'
  )$$,
  '40001',
  'ladder changed while match 20000000-0000-0000-0000-000000000002 was settling',
  'stale ladder snapshots fail as a serialization conflict'
);
select is((select status from public.matches where id = '20000000-0000-0000-0000-000000000002'),
  'active', 'stale settlement leaves the match active');

select throws_ok(
  $$select public.settle_match(
    '20000000-0000-0000-0000-000000000002', 'done', null,
    12, 12, 0, 0,
    '{"points":110,"peak":110,"wins":3,"losses":1,"draws":0}',
    '{"points":20,"peak":40,"wins":1,"losses":3,"draws":0}',
    '{"points":null,"peak":110,"wins":3,"losses":1,"draws":1}',
    '{"points":20,"peak":40,"wins":1,"losses":3,"draws":1}'
  )$$,
  '23502',
  null,
  'a ladder write failure aborts the whole settlement'
);
select is((select status from public.matches where id = '20000000-0000-0000-0000-000000000002'),
  'active', 'failed payout rolls the match claim back');

select lives_ok(
  $$select public.settle_match(
    '20000000-0000-0000-0000-000000000003', 'forfeit',
    '10000000-0000-0000-0000-000000000004',
    0, 0, -10, 30,
    '{"points":10,"peak":10,"wins":0,"losses":1,"draws":0}',
    '{"points":20,"peak":20,"wins":1,"losses":0,"draws":0}',
    '{"points":0,"peak":10,"wins":0,"losses":2,"draws":0}',
    '{"points":50,"peak":50,"wins":2,"losses":0,"draws":0}'
  )$$,
  'active-account deletion match can be paid first'
);
delete from auth.users where id = '10000000-0000-0000-0000-000000000003';
select is((select rating from public.profiles where id = '10000000-0000-0000-0000-000000000004'),
  50, 'opponent payout survives deleted account cascade');
select is((select count(*)::integer from public.matches where id = '20000000-0000-0000-0000-000000000003'),
  0, 'privacy deletion removes match history through the existing cascade');

select * from finish();
rollback;
