begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(31);

select ok(
  not has_function_privilege('anon', 'public.enqueue_ranked_player(uuid)', 'execute'),
  'anonymous callers cannot enqueue through the lifecycle command'
);
select ok(
  not has_function_privilege('authenticated', 'public.enqueue_ranked_player(uuid)', 'execute'),
  'authenticated callers cannot impersonate another queue participant'
);
select ok(
  has_function_privilege('service_role', 'public.enqueue_ranked_player(uuid)', 'execute'),
  'the matchmaking Edge Function can enqueue through the lifecycle command'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.start_ranked_match(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint)',
    'execute'
  ),
  'anonymous callers cannot start ranked matches'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.start_ranked_match(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint)',
    'execute'
  ),
  'authenticated callers cannot bypass matchmaking'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.start_ranked_match(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint)',
    'execute'
  ),
  'the matchmaking Edge Function can execute the atomic start command'
);
select ok(
  not has_function_privilege('anon', 'public.prepare_account_deletion(uuid)', 'execute'),
  'anonymous callers cannot establish account-deletion barriers'
);
select ok(
  not has_function_privilege('authenticated', 'public.prepare_account_deletion(uuid)', 'execute'),
  'authenticated callers cannot establish another account deletion barrier'
);
select ok(
  has_function_privilege('service_role', 'public.prepare_account_deletion(uuid)', 'execute'),
  'the account-delete Edge Function can establish its durable barrier'
);
select ok(
  not has_function_privilege('anon', 'public.leave_ranked_queue()', 'execute'),
  'anonymous callers cannot cancel a ranked queue claim'
);
select ok(
  has_function_privilege('authenticated', 'public.leave_ranked_queue()', 'execute'),
  'authenticated callers can use the linearizable queue cancellation command'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('81000000-0000-0000-0000-000000000001', 'lifecycle-1@example.invalid', now(), now()),
  ('81000000-0000-0000-0000-000000000002', 'lifecycle-2@example.invalid', now(), now()),
  ('81000000-0000-0000-0000-000000000003', 'lifecycle-3@example.invalid', now(), now()),
  ('81000000-0000-0000-0000-000000000004', 'lifecycle-4@example.invalid', now(), now()),
  ('81000000-0000-0000-0000-000000000005', 'lifecycle-5@example.invalid', now(), now()),
  ('81000000-0000-0000-0000-000000000006', 'lifecycle-6@example.invalid', now(), now());

insert into public.matchmaking_queue (player_id)
values
  ('81000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000002');

insert into public.matches (id, p1, p2, status, turn, next_die, season_id)
values (
  '82000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000002',
  'active', 1, 4, 1
);

select is(
  (select count(*)::integer
     from private.active_match_players
    where match_id = '82000000-0000-0000-0000-000000000001'),
  2,
  'the match trigger claims both active participant seats'
);
select is(
  (select count(*)::integer from public.matchmaking_queue
    where player_id in (
      '81000000-0000-0000-0000-000000000001',
      '81000000-0000-0000-0000-000000000002'
    )),
  0,
  'a legacy active insert removes both participants from matchmaking'
);

insert into public.matchmaking_queue (player_id)
values ('81000000-0000-0000-0000-000000000001');
create temporary table active_enqueue as
select public.enqueue_ranked_player(
  '81000000-0000-0000-0000-000000000001'
) as payload;
select is(
  concat(
    (select payload->>'status' from active_enqueue), '/',
    (select count(*) from public.matchmaking_queue
      where player_id = '81000000-0000-0000-0000-000000000001')
  ),
  'active/0',
  'enqueue reports the active match and cleans a stale queue row'
);
select throws_ok(
  $$insert into public.matches (p1, p2, status, turn, next_die, season_id)
    values (
      '81000000-0000-0000-0000-000000000001',
      '81000000-0000-0000-0000-000000000003',
      'active', 1, 4, 1
    )$$,
  '23505',
  null,
  'the database invariant rejects a second active match for either player'
);
update public.matches
   set status = 'done', finished_at = now()
 where id = '82000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::integer
     from private.active_match_players
    where match_id = '82000000-0000-0000-0000-000000000001'),
  0,
  'a terminal transition releases both active participant seats'
);

insert into public.matchmaking_queue (player_id)
values ('81000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  public.leave_ranked_queue()->>'status',
  'left',
  'queue cancellation reports that the leave serialized before any match start'
);
reset role;
select is(
  (select count(*)::integer from public.matchmaking_queue
    where player_id = '81000000-0000-0000-0000-000000000001'),
  0,
  'a successful queue cancellation removes the durable claim'
);

do $block$
begin
  perform public.prepare_account_deletion('81000000-0000-0000-0000-000000000002');
end;
$block$;
select throws_ok(
  $$insert into public.matches (p1, p2, status, turn, next_die, season_id)
    values (
      '81000000-0000-0000-0000-000000000001',
      '81000000-0000-0000-0000-000000000002',
      'active', 1, 4, 1
    )$$,
  'P0001',
  'ranked participant is deleting their account',
  'the trigger blocks a legacy direct writer after account deletion starts'
);

insert into public.matchmaking_queue (player_id)
values
  ('81000000-0000-0000-0000-000000000003'),
  ('81000000-0000-0000-0000-000000000004');

create temporary table human_start as
select public.start_ranked_match(
  '81000000-0000-0000-0000-000000000003',
  '81000000-0000-0000-0000-000000000003',
  '81000000-0000-0000-0000-000000000004',
  'human-seed', 3::smallint, 'classic', 1::smallint,
  '81000000-0000-0000-0000-000000000004',
  null, null, null, null
) as payload;

select is(
  (select (payload->>'created')::boolean from human_start),
  true,
  'the atomic start command reports that it created the match'
);
select is(
  (select concat(
    (select count(*) from public.matches where id = (payload->'match'->>'id')::uuid), '/',
    (select count(*) from public.match_seeds where match_id = (payload->'match'->>'id')::uuid), '/',
    (select count(*) from private.active_match_players where match_id = (payload->'match'->>'id')::uuid), '/',
    (select count(*) from public.matchmaking_queue
      where player_id in (
        '81000000-0000-0000-0000-000000000003',
        '81000000-0000-0000-0000-000000000004'
      ))
  ) from human_start),
  '1/1/2/0',
  'match, seed, seats, and both queue claims commit together'
);
select is(
  (select count(*)::integer
     from public.match_moves
    where match_id = (select (payload->'match'->>'id')::uuid from human_start)),
  0,
  'a human-vs-human start does not invent an opening move'
);

update public.matches
   set status = 'done', finished_at = now()
 where id = (select (payload->'match'->>'id')::uuid from human_start);
select throws_ok(
  $$select public.start_ranked_match(
    '81000000-0000-0000-0000-000000000003',
    '81000000-0000-0000-0000-000000000003',
    '81000000-0000-0000-0000-000000000004',
    'missing-queue-seed', 3::smallint, 'classic', 1::smallint,
    '81000000-0000-0000-0000-000000000004',
    null, null, null, null
  )$$,
  'P0001',
  'ranked queue claim is no longer available',
  'a stale matchmaking read cannot start after either queue claim disappears'
);

insert into public.matchmaking_queue (player_id)
values ('81000000-0000-0000-0000-000000000005');
create temporary table bot_start as
select public.start_ranked_match(
  '81000000-0000-0000-0000-000000000005',
  '81000000-0000-0000-0000-000000000005',
  '81000000-0000-0000-0000-000000000006',
  'bot-seed', 4::smallint, 'classic', 1::smallint,
  null, 2::smallint, 4::smallint, 0::smallint, 5::smallint
) as payload;
grant select on bot_start to authenticated;

select is(
  (select concat(
    payload->'match'->>'turn', '/', payload->'match'->>'next_die', '/',
    (select concat(who, '/', col, '/', die)
       from public.match_moves
      where match_id = (payload->'match'->>'id')::uuid)
  ) from bot_start),
  '0/5/1/2/4',
  'the TypeScript-projected bot opener and resulting turn persist together'
);
select is(
  (select concat(
    (select count(*) from public.match_seeds where match_id = (payload->'match'->>'id')::uuid), '/',
    (select count(*) from private.active_match_players where match_id = (payload->'match'->>'id')::uuid), '/',
    (select count(*) from public.matchmaking_queue
      where player_id = '81000000-0000-0000-0000-000000000005')
  ) from bot_start),
  '1/2/0',
  'bot match seed, active seats, and requester queue claim are atomic'
);

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is(
  (public.leave_ranked_queue()->>'status') || '/' ||
    (public.leave_ranked_queue()->>'match_id'),
  'matched/' || (select payload->'match'->>'id' from bot_start),
  'queue cancellation reports the match when match creation serialized first'
);
reset role;

create temporary table deletion_snapshot as
select public.prepare_account_deletion(
  '81000000-0000-0000-0000-000000000005'
) as payload;
select is(
  (select jsonb_array_length(payload) from deletion_snapshot),
  1,
  'the deletion barrier returns every active match it froze'
);
select is(
  (select concat(
    (select count(*) from private.deleting_accounts
      where player = '81000000-0000-0000-0000-000000000005'), '/',
    (select count(*) from public.matchmaking_queue
      where player_id = '81000000-0000-0000-0000-000000000005')
  )),
  '1/0',
  'preparing deletion persists the barrier and dequeues the account atomically'
);
select is(
  public.enqueue_ranked_player('81000000-0000-0000-0000-000000000005')->>'status',
  'deleting',
  'the durable deletion marker prevents a later enqueue'
);

insert into public.matchmaking_queue (player_id)
values ('81000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.start_ranked_match(
    '81000000-0000-0000-0000-000000000005',
    '81000000-0000-0000-0000-000000000005',
    '81000000-0000-0000-0000-000000000001',
    'deleting-seed', 2::smallint, 'classic', 1::smallint,
    null, null, null, null, null
  )$$,
  'P0001',
  'ranked participant is deleting their account',
  'match creation cannot cross an established account-deletion barrier'
);
select is(
  (select count(*)::integer
     from private.active_match_players
    where player = '81000000-0000-0000-0000-000000000005'),
  1,
  'the rejected post-barrier start does not create a second active seat'
);

select * from finish();
rollback;
