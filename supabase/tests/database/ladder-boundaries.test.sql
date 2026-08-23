begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

select ok(
  not has_table_privilege('anon', 'public.season_ratings', 'select'),
  'anonymous clients cannot scan raw ladder rows'
);
select ok(
  has_table_privilege('authenticated', 'public.season_ratings', 'select'),
  'authenticated clients retain the table grant needed for own-row reads'
);
select ok(
  has_table_privilege('service_role', 'public.season_ratings', 'select'),
  'service role can read ladder rows for settlement'
);
select ok(
  has_table_privilege('service_role', 'public.season_ratings', 'insert'),
  'service role can insert ladder rows for settlement'
);
select ok(
  has_table_privilege('service_role', 'public.season_ratings', 'update'),
  'service role can update ladder rows for settlement'
);
select ok(
  has_table_privilege('service_role', 'public.season_ratings', 'delete'),
  'service role can delete ladder rows for account cleanup'
);
select ok(
  has_function_privilege('service_role', 'public.current_season()', 'execute'),
  'matchmaking can read the current season through the service role'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.players_near(uuid,integer)',
    'execute'
  ),
  'matchmaking can measure the ladder band through the service role'
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
  has_function_privilege('anon', 'public.leaderboard(integer,integer,text)', 'execute'),
  'the shaped public leaderboard remains anonymous'
);
select ok(
  has_function_privilege('anon', 'public.leaderboard_before(integer,integer,text)', 'execute'),
  'the reverse shaped public leaderboard remains anonymous'
);
select ok(
  to_regprocedure('public.leaderboard(integer,smallint)') is null,
  'the obsolete season-argument leaderboard overload is gone'
);
select ok(
  to_regprocedure('public.leaderboard(integer,smallint,integer)') is null,
  'the obsolete production ladder-window overload is gone'
);
select ok(
  has_function_privilege('anon', 'public.player_card(text)', 'execute'),
  'the shaped public player card remains anonymous'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('50000000-0000-0000-0000-000000000001', 'ladder-one@example.invalid', now(), now()),
  ('50000000-0000-0000-0000-000000000002', 'ladder-two@example.invalid', now(), now()),
  ('50000000-0000-0000-0000-000000000003', 'ladder-peer@example.invalid', now(), now());

update public.profiles
   set nickname = case id
     when '50000000-0000-0000-0000-000000000001' then 'BoundaryOne'
     when '50000000-0000-0000-0000-000000000002' then 'BoundaryTwo'
     else 'BoundaryPeer'
   end
 where id in (
   '50000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000003'
 );

insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
values
  (1, '50000000-0000-0000-0000-000000000001', 4444, 4444, 8, 1, 0),
  (1, '50000000-0000-0000-0000-000000000002', 2222, 2500, 4, 3, 1),
  (1, '50000000-0000-0000-0000-000000000003', 4444, 4444, 8, 2, 0);

-- One tied rank spans more than the client page size. This is the case that
-- numeric rank subtraction cannot traverse because rank() jumps from 1 to 61.
insert into auth.users (id, email, created_at, updated_at)
select ('80000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       'ladder-tie-' || n || '@example.invalid',
       now(),
       now()
  from generate_series(1, 60) n;

update public.profiles
   set nickname = 'Tie' || lpad(right(id::text, 12)::integer::text, 4, '0')
 where id::text like '80000000-0000-0000-0000-%';

insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
select 1,
       ('80000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       5000,
       5000,
       10,
       1,
       0
  from generate_series(1, 60) n;

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
  (select lb.rank from public.leaderboard(100, 1, null) lb where lb.nickname = 'BoundaryOne'),
  'player card and leaderboard share one rank policy'
);
select is(
  (select pc.apex from public.player_card('BoundaryOne') pc),
  (select lb.apex from public.leaderboard(100, 1, null) lb where lb.nickname = 'BoundaryOne'),
  'player card and leaderboard share one apex policy'
);
select is(
  (select standing.rank
     from public.player_standing('50000000-0000-0000-0000-000000000001') standing),
  (select lb.rank
     from public.leaderboard(100, 1, null) lb
    where lb.nickname = 'BoundaryOne'),
  'player standing and leaderboard share one rank policy'
);
select is(
  (select lb.nickname
     from public.leaderboard(
       1,
       (select ranked.rank::integer
          from public.leaderboard(100, 1, null) ranked
         where ranked.nickname = 'BoundaryTwo'),
       null
     ) lb),
  'BoundaryTwo'::text,
  'leaderboard windows begin at the requested rank'
);
select is(
  (select lb.nickname
     from public.leaderboard(
       1,
       (select ranked.rank::integer
          from public.leaderboard(100, 1, null) ranked
         where ranked.nickname = 'BoundaryOne'),
       'BoundaryOne'
     ) lb),
  'BoundaryPeer'::text,
  'the nickname cursor advances across a tied rank without repeating a row'
);
select is(
  (select count(*)::text || '/' || min(lb.nickname) || '/' || max(lb.nickname)
     from public.leaderboard_before(50, 2, '') lb),
  '50/Tie0011/Tie0060'::text,
  'reverse paging selects the nearest full page within a tied rank'
);
select is(
  (with first_page as (
     select * from public.leaderboard_before(50, 2, '')
   ),
   cursor_row as (
     select page.rank, page.nickname
       from first_page page
      order by page.rank, page.nickname
      limit 1
   ),
   second_page as (
     select prior.*
       from cursor_row cursor
       cross join lateral public.leaderboard_before(
         50,
         cursor.rank::integer,
         cursor.nickname
       ) prior
   ),
   walked as (
     select page.nickname from first_page page
     union all
     select page.nickname from second_page page
   )
   select array_agg(walked.nickname order by walked.nickname) from walked),
  (select array_agg('Tie' || lpad(n::text, 4, '0') order by n)
     from generate_series(1, 60) n),
  'a tied rank larger than one page is traversed backward without gaps or duplicates'
);

select * from finish();
rollback;
