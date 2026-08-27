begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

-- The away allowance is a COUNT, kept per seat on the match row, because every
-- automatic placement writes last_move_at and would reset any wall clock
-- measured from it. These pin the transitions the commit RPC owns; the
-- threshold itself lives in TypeScript (_shared/match-timing.ts) alongside the
-- ladder arithmetic, so there is no interval literal here to drift.

select ok(
  (select column_default = '0' and is_nullable = 'NO' and data_type = 'smallint'
     from information_schema.columns
    where table_schema = 'public' and table_name = 'matches'
      and column_name = 'p1_auto_streak'),
  'p1_auto_streak is a non-null smallint that starts an untouched allowance'
);
select ok(
  (select column_default = '0' and is_nullable = 'NO' and data_type = 'smallint'
     from information_schema.columns
    where table_schema = 'public' and table_name = 'matches'
      and column_name = 'p2_auto_streak'),
  'p2_auto_streak is a non-null smallint that starts an untouched allowance'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('93000000-0000-0000-0000-000000000001', 'streak-1@example.invalid', now(), now()),
  ('93000000-0000-0000-0000-000000000002', 'streak-2@example.invalid', now(), now());

insert into public.season_ratings (season_id, player)
select 1, id from public.profiles
where id between
  '93000000-0000-0000-0000-000000000001'::uuid and
  '93000000-0000-0000-0000-000000000002'::uuid
on conflict (season_id, player) do nothing;

insert into public.matches (id, p1, p2, status, turn, next_die, season_id)
values
  ('94000000-0000-0000-0000-000000000001',
   '93000000-0000-0000-0000-000000000001',
   '93000000-0000-0000-0000-000000000002', 'active', 1, 4, 1);

create or replace function pg_temp.streaks() returns text
language sql stable as $$
  select concat(p1_auto_streak, '/', p2_auto_streak)
    from public.matches where id = '94000000-0000-0000-0000-000000000001';
$$;

set local role service_role;

-- A genuine tap by p1.
select public.commit_match_command(
  '94000000-0000-0000-0000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  0::smallint, false, 0, 1::smallint, 4::smallint,
  '[{"idx":0,"who":1,"col":0,"die":4}]',
  0::smallint, 5::smallint, null, '{"your_die":4}'
);
reset role;
select is(pg_temp.streaks(), '0/0', 'a genuine placement spends none of the allowance');

-- p2's own turn clock runs out. A self placement carries no stall
-- precondition, so AUTO_MS never gates it and only turn ownership is checked.
set local role service_role;
select public.commit_match_command(
  '94000000-0000-0000-0000-000000000001',
  '95000000-0000-4000-8000-000000000002',
  '93000000-0000-0000-0000-000000000002',
  -1::smallint, true, 1, 0::smallint, 5::smallint,
  '[{"idx":1,"who":0,"col":0,"die":5}]',
  1::smallint, 3::smallint, null, '{"your_die":5}', null
);
reset role;
select is(pg_temp.streaks(), '0/1',
  'an own-turn automatic placement spends only the mover''s allowance');

-- p1's own turn clock runs out too; the seats count independently.
set local role service_role;
select public.commit_match_command(
  '94000000-0000-0000-0000-000000000001',
  '95000000-0000-4000-8000-000000000003',
  '93000000-0000-0000-0000-000000000001',
  -1::smallint, true, 2, 1::smallint, 3::smallint,
  '[{"idx":2,"who":1,"col":1,"die":3}]',
  0::smallint, 2::smallint, null, '{"your_die":3}', null
);
reset role;
select is(pg_temp.streaks(), '1/1', 'each seat carries its own independent allowance');

-- p2 comes back and actually plays: their count resets, p1's is untouched.
set local role service_role;
select public.commit_match_command(
  '94000000-0000-0000-0000-000000000001',
  '95000000-0000-4000-8000-000000000004',
  '93000000-0000-0000-0000-000000000002',
  1::smallint, false, 3, 0::smallint, 2::smallint,
  '[{"idx":3,"who":0,"col":1,"die":2}]',
  1::smallint, 6::smallint, null, '{"your_die":2}'
);
reset role;
select is(pg_temp.streaks(), '1/0',
  'returning to the board restores only that player''s allowance');

-- A null stall precondition MEANS "this is my own turn". It must not become a
-- way to move somebody else's die without proving they are gone.
set local role service_role;
select throws_ok(
  $$select public.commit_match_command(
    '94000000-0000-0000-0000-000000000001',
    '95000000-0000-4000-8000-000000000005',
    '93000000-0000-0000-0000-000000000002',
    -1::smallint, true, 4, 1::smallint, 6::smallint,
    '[{"idx":4,"who":1,"col":2,"die":6}]',
    0::smallint, 4::smallint, null, '{"your_die":6}', null
  )$$,
  '22023',
  'auto command actor does not own the turn',
  'an ungated auto command cannot take a turn its actor does not own'
);

-- The gated recovery path is unchanged: a fresh last_move_at is still refused.
select throws_ok(
  $$select public.commit_match_command(
    '94000000-0000-0000-0000-000000000001',
    '95000000-0000-4000-8000-000000000006',
    '93000000-0000-0000-0000-000000000002',
    -1::smallint, true, 4, 1::smallint, 6::smallint,
    '[{"idx":4,"who":1,"col":2,"die":6}]',
    0::smallint, 4::smallint, null, '{"your_die":6}',
    (select last_move_at from public.matches
      where id = '94000000-0000-0000-0000-000000000001')
  )$$,
  'P0001',
  'command is not stalled yet',
  'recovering another player''s turn still waits out the stall gate'
);
reset role;

select * from finish();
rollback;
