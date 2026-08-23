begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

select ok(
  not has_table_privilege('anon', 'public.season_ratings', 'select'),
  'anonymous clients cannot scan raw ladder rows'
);
select ok(
  has_table_privilege('authenticated', 'public.season_ratings', 'select'),
  'authenticated clients retain the table grant needed for own-row reads'
);
select ok(
  has_table_privilege('service_role', 'public.season_ratings', 'select,insert,update,delete'),
  'service role retains ladder settlement privileges'
);
select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anonymous clients cannot use the internal policy schema'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated clients cannot use the internal policy schema'
);
select ok(
  not has_function_privilege('anon', 'private.ladder_board(smallint)', 'execute'),
  'anonymous clients cannot call the internal board function'
);
select ok(
  not has_function_privilege('authenticated', 'private.ladder_board(smallint)', 'execute'),
  'authenticated clients cannot call the internal board function'
);
select ok(
  has_function_privilege('anon', 'public.leaderboard(integer,smallint)', 'execute'),
  'the shaped public leaderboard remains anonymous'
);
select ok(
  has_function_privilege('anon', 'public.player_card(text)', 'execute'),
  'the shaped public player card remains anonymous'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('50000000-0000-0000-0000-000000000001', 'ladder-one@example.invalid', now(), now()),
  ('50000000-0000-0000-0000-000000000002', 'ladder-two@example.invalid', now(), now());

update public.profiles
   set nickname = case id
     when '50000000-0000-0000-0000-000000000001' then 'BoundaryOne'
     else 'BoundaryTwo'
   end
 where id in (
   '50000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000002'
 );

insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
values
  (1, '50000000-0000-0000-0000-000000000001', 4444, 4444, 8, 1, 0),
  (1, '50000000-0000-0000-0000-000000000002', 2222, 2500, 4, 3, 1);

select set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.season_ratings),
  1,
  'authenticated table reads see only the caller ladder row'
);
select is(
  (select player from public.season_ratings),
  '50000000-0000-0000-0000-000000000001'::uuid,
  'the visible ladder row belongs to the caller'
);
reset role;

select is(
  (select pc.rank from public.player_card('BoundaryOne') pc),
  (select lb.rank from public.leaderboard(100, 1::smallint) lb where lb.nickname = 'BoundaryOne'),
  'player card and leaderboard share one rank policy'
);
select is(
  (select pc.apex from public.player_card('BoundaryOne') pc),
  (select lb.apex from public.leaderboard(100, 1::smallint) lb where lb.nickname = 'BoundaryOne'),
  'player card and leaderboard share one apex policy'
);

select * from finish();
rollback;
