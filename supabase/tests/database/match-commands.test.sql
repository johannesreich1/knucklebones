begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(27);

select ok(
  not has_function_privilege(
    'anon',
    'public.commit_match_command(uuid,uuid,uuid,smallint,boolean,integer,smallint,smallint,jsonb,smallint,smallint,jsonb,jsonb,timestamp with time zone)',
    'execute'
  ),
  'anonymous callers cannot commit authoritative match commands'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.commit_match_command(uuid,uuid,uuid,smallint,boolean,integer,smallint,smallint,jsonb,smallint,smallint,jsonb,jsonb,timestamp with time zone)',
    'execute'
  ),
  'authenticated callers cannot commit authoritative match commands directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.commit_match_command(uuid,uuid,uuid,smallint,boolean,integer,smallint,smallint,jsonb,smallint,smallint,jsonb,jsonb,timestamp with time zone)',
    'execute'
  ),
  'the move Edge Function can commit the atomic command'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.match_command_result(uuid,uuid,uuid,smallint,boolean,integer)',
    'execute'
  ),
  'authenticated callers cannot read private command responses'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.settle_match_checked(uuid,smallint,timestamp with time zone,integer,text,uuid,integer,integer,integer,integer,jsonb,jsonb,jsonb,jsonb)',
    'execute'
  ),
  'the timeout Edge paths can execute checked settlement'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('90000000-0000-0000-0000-000000000001', 'command-1@example.invalid', now(), now()),
  ('90000000-0000-0000-0000-000000000002', 'command-2@example.invalid', now(), now()),
  ('90000000-0000-0000-0000-000000000003', 'command-3@example.invalid', now(), now()),
  ('90000000-0000-0000-0000-000000000004', 'command-4@example.invalid', now(), now()),
  ('90000000-0000-0000-0000-000000000005', 'command-5@example.invalid', now(), now()),
  ('90000000-0000-0000-0000-000000000006', 'command-6@example.invalid', now(), now());

insert into public.season_ratings (season_id, player)
select 1, id from public.profiles
where id between
  '90000000-0000-0000-0000-000000000001'::uuid and
  '90000000-0000-0000-0000-000000000006'::uuid
on conflict (season_id, player) do nothing;

insert into public.matches (id, p1, p2, status, turn, next_die, season_id)
values
  ('91000000-0000-0000-0000-000000000001',
   '90000000-0000-0000-0000-000000000001',
   '90000000-0000-0000-0000-000000000002', 'active', 1, 4, 1),
  ('91000000-0000-0000-0000-000000000002',
   '90000000-0000-0000-0000-000000000003',
   '90000000-0000-0000-0000-000000000004', 'active', 1, 2, 1),
  ('91000000-0000-0000-0000-000000000003',
   '90000000-0000-0000-0000-000000000005',
   '90000000-0000-0000-0000-000000000006', 'active', 1, 6, 1);

create temporary table first_command (payload jsonb);
grant insert on first_command to service_role;
set local role service_role;
insert into first_command (payload)
select public.commit_match_command(
  '91000000-0000-0000-0000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  1::smallint, false, 0, 1::smallint, 4::smallint,
  '[{"idx":0,"who":1,"col":1,"die":4}]',
  0::smallint, 5::smallint, null, '{"your_die":4}'
);
reset role;

select is(
  (select concat(payload->'match'->>'turn', '/', payload->'match'->>'next_die', '/', payload->>'your_die')
     from first_command),
  '0/5/4',
  'a nonterminal command returns the committed match projection and metadata'
);
select is(
  (select concat(idx, '/', who, '/', col, '/', die)
     from public.match_moves
    where match_id = '91000000-0000-0000-0000-000000000001'),
  '0/1/1/4',
  'the move log append commits with the projected turn and die'
);
select is(
  (select count(*)::integer from private.match_commands
    where match_id = '91000000-0000-0000-0000-000000000001'),
  1,
  'the exact response is recorded in the private idempotency ledger'
);

create temporary table replayed_command as
select public.commit_match_command(
  '91000000-0000-0000-0000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  1::smallint, false, 0, 1::smallint, 4::smallint,
  '[{"idx":0,"who":1,"col":1,"die":4}]',
  0::smallint, 5::smallint, null, '{"your_die":4}'
) as payload;
select is(
  (select payload from replayed_command),
  (select payload from first_command),
  'the same command key replays the byte-equivalent committed response'
);
select is(
  (select count(*)::integer from public.match_moves
    where match_id = '91000000-0000-0000-0000-000000000001'),
  1,
  'replaying a committed command does not append another move'
);
select throws_ok(
  $$select public.match_command_result(
    '91000000-0000-0000-0000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '90000000-0000-0000-0000-000000000001',
    2::smallint, false, 0
  )$$,
  '22023',
  'command id was reused with different input',
  'a command key cannot be reused with different input'
);
select throws_ok(
  $$select public.commit_match_command(
    '91000000-0000-0000-0000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    '90000000-0000-0000-0000-000000000002',
    0::smallint, false, 0, 0::smallint, 5::smallint,
    '[{"idx":0,"who":0,"col":0,"die":5}]',
    1::smallint, 6::smallint, null, '{"your_die":5}'
  )$$,
  'P0001',
  'match changed before command commit',
  'a stale expected move version is rejected under the match lock'
);
select is(
  (select concat(
    (select count(*) from public.match_moves
      where match_id = '91000000-0000-0000-0000-000000000001'), '/',
    (select count(*) from private.match_commands
      where match_id = '91000000-0000-0000-0000-000000000001')
  )),
  '1/1',
  'a stale command leaves both the move log and idempotency ledger untouched'
);

select throws_ok(
  $$select public.commit_match_command(
    '91000000-0000-0000-0000-000000000002',
    '92000000-0000-4000-8000-000000000003',
    '90000000-0000-0000-0000-000000000003',
    0::smallint, false, 0, 1::smallint, 2::smallint,
    '[{"idx":0,"who":1,"col":0,"die":2}]',
    null, null,
    '{"status":"done","winner":"90000000-0000-0000-0000-000000000003","p1_score":12,"p2_score":4,"p1_delta":10,"p2_delta":0,"expected_p1":{"points":0,"peak":0,"wins":0,"losses":0,"draws":0},"expected_p2":{"points":0,"peak":0,"wins":0,"losses":0,"draws":0},"next_p1":{"points":null,"peak":10,"wins":1,"losses":0,"draws":0},"next_p2":{"points":0,"peak":0,"wins":0,"losses":1,"draws":0}}',
    '{"your_die":2}'
  )$$,
  '23502',
  null,
  'a terminal ladder write failure aborts the whole match command'
);
select is(
  (select concat(
    (select status from public.matches where id = '91000000-0000-0000-0000-000000000002'), '/',
    (select count(*) from public.match_moves where match_id = '91000000-0000-0000-0000-000000000002'), '/',
    (select count(*) from private.match_commands where match_id = '91000000-0000-0000-0000-000000000002'), '/',
    (select points from public.season_ratings where season_id = 1 and player = '90000000-0000-0000-0000-000000000003')
  )),
  'active/0/0/0',
  'failed terminal arithmetic rolls back move, match, payout, and command record'
);

create temporary table terminal_command as
select public.commit_match_command(
  '91000000-0000-0000-0000-000000000003',
  '92000000-0000-4000-8000-000000000004',
  '90000000-0000-0000-0000-000000000005',
  2::smallint, false, 0, 1::smallint, 6::smallint,
  '[{"idx":0,"who":1,"col":2,"die":6}]',
  null, null,
  '{"status":"done","winner":"90000000-0000-0000-0000-000000000005","p1_score":18,"p2_score":7,"p1_delta":30,"p2_delta":0,"expected_p1":{"points":0,"peak":0,"wins":0,"losses":0,"draws":0},"expected_p2":{"points":0,"peak":0,"wins":0,"losses":0,"draws":0},"next_p1":{"points":30,"peak":30,"wins":1,"losses":0,"draws":0},"next_p2":{"points":0,"peak":0,"wins":0,"losses":1,"draws":0}}',
  '{"your_die":6}'
) as payload;
select is(
  (select payload->'match'->>'status' from terminal_command),
  'done',
  'a terminal command returns the atomically settled match'
);
select is(
  (select concat(
    (select count(*) from public.match_moves where match_id = '91000000-0000-0000-0000-000000000003'), '/',
    (select count(*) from private.match_commands where match_id = '91000000-0000-0000-0000-000000000003'), '/',
    (select count(*) from private.active_match_players where match_id = '91000000-0000-0000-0000-000000000003'), '/',
    (select points from public.season_ratings where season_id = 1 and player = '90000000-0000-0000-0000-000000000005')
  )),
  '1/1/0/30',
  'terminal move, response, seat release, and ladder payout commit together'
);
select is(
  public.commit_match_command(
    '91000000-0000-0000-0000-000000000003',
    '92000000-0000-4000-8000-000000000004',
    '90000000-0000-0000-0000-000000000005',
    2::smallint, false, 0, 1::smallint, 6::smallint,
    '[{"idx":0,"who":1,"col":2,"die":6}]',
    null, null,
    '{"status":"done","winner":"90000000-0000-0000-0000-000000000005","p1_score":18,"p2_score":7,"p1_delta":30,"p2_delta":0,"expected_p1":{},"expected_p2":{},"next_p1":{},"next_p2":{}}',
    '{"your_die":6}'
  ),
  (select payload from terminal_command),
  'a terminal command replay returns before attempting a second payout'
);
select throws_ok(
  $$insert into public.match_moves (match_id, idx, who, col, die)
    values ('91000000-0000-0000-0000-000000000003', 1, 0, 0, 1)$$,
  'P0001',
  'match is no longer active',
  'the move guard rejects a legacy append after terminal settlement'
);

create temporary table match_two_before as
select last_move_at from public.matches where id = '91000000-0000-0000-0000-000000000002';
do $block$
begin
  perform public.commit_match_command(
    '91000000-0000-0000-0000-000000000002',
    '92000000-0000-4000-8000-000000000005',
    '90000000-0000-0000-0000-000000000003',
    0::smallint, false, 0, 1::smallint, 2::smallint,
    '[{"idx":0,"who":1,"col":0,"die":2}]',
    0::smallint, 3::smallint, null, '{"your_die":2}'
  );
end;
$block$;
create temporary table stale_claim as
select public.settle_match_checked(
  '91000000-0000-0000-0000-000000000002',
  1::smallint,
  (select last_move_at from match_two_before),
  0,
  'forfeit',
  '90000000-0000-0000-0000-000000000003',
  0, 0, 10, 0,
  '{}', '{}', '{}', '{}'
) as payload;
select is(
  (select concat(payload->>'applied', '/', payload->>'changed', '/', payload->'match'->>'status')
     from stale_claim),
  'false/true/active',
  'a move committed before the checked forfeit invalidates the stale claim'
);
select is(
  (select concat(
    (select count(*) from public.match_moves where match_id = '91000000-0000-0000-0000-000000000002'), '/',
    (select points from public.season_ratings where season_id = 1 and player = '90000000-0000-0000-0000-000000000003')
  )),
  '1/0',
  'the rejected stale claim preserves the winning move and does not pay a forfeit'
);

create temporary table legacy_before as
select last_move_at
  from public.matches
 where id = '91000000-0000-0000-0000-000000000001';
insert into public.match_moves (match_id, idx, who, col, die)
values (
  '91000000-0000-0000-0000-000000000001', 1, 0, 2, 5
);
select ok(
  (select m.last_move_at > b.last_move_at
     from public.matches m cross join legacy_before b
    where m.id = '91000000-0000-0000-0000-000000000001'),
  'a legacy split-write append advances the stall clock in the log transaction'
);
create temporary table legacy_split_claim as
select public.settle_match_checked(
  '91000000-0000-0000-0000-000000000001',
  0::smallint,
  (select last_move_at from legacy_before),
  1,
  'forfeit',
  '90000000-0000-0000-0000-000000000001',
  0, 0, 10, 0,
  '{}', '{}', '{}', '{}'
) as payload;
select is(
  (select concat(payload->>'applied', '/', payload->>'changed', '/', payload->'match'->>'status')
     from legacy_split_claim),
  'false/true/active',
  'checked settlement rejects a legacy append before its separate projection write'
);

-- The classic auto path carries the projection it judged stalled; the database
-- clock is then the authority on the 12-second gate. A null precondition is
-- the deployed legacy caller and skips the re-check entirely (covered above:
-- every earlier command in this file omits the trailing parameter).
insert into auth.users (id, email, created_at, updated_at)
values
  ('90000000-0000-0000-0000-000000000007', 'command-7@example.invalid', now(), now()),
  ('90000000-0000-0000-0000-000000000008', 'command-8@example.invalid', now(), now());
insert into public.matches (id, p1, p2, status, turn, next_die, season_id)
values
  ('91000000-0000-0000-0000-000000000004',
   '90000000-0000-0000-0000-000000000007',
   '90000000-0000-0000-0000-000000000008', 'active', 1, 3, 1);

select throws_ok(
  $$select public.commit_match_command(
    '91000000-0000-0000-0000-000000000004',
    '92000000-0000-4000-8000-000000000006',
    '90000000-0000-0000-0000-000000000008',
    (-1)::smallint, true, 0, 1::smallint, 3::smallint,
    '[{"idx":0,"who":1,"col":0,"die":3}]',
    0::smallint, 2::smallint, null, '{"your_die":3,"auto":true}',
    (select last_move_at from public.matches
      where id = '91000000-0000-0000-0000-000000000004')
  )$$,
  'P0001',
  'command is not stalled yet',
  'the database clock rejects an auto move before twelve authoritative seconds'
);
select throws_ok(
  $$select public.commit_match_command(
    '91000000-0000-0000-0000-000000000004',
    '92000000-0000-4000-8000-000000000007',
    '90000000-0000-0000-0000-000000000008',
    0::smallint, false, 0, 1::smallint, 3::smallint,
    '[{"idx":0,"who":1,"col":0,"die":3}]',
    0::smallint, 2::smallint, null, '{"your_die":3}',
    clock_timestamp()
  )$$,
  '22023',
  'manual command carries a stall precondition',
  'a manual command cannot smuggle the auto stall waiver'
);
update public.matches
   set last_move_at = clock_timestamp() - interval '13 seconds'
 where id = '91000000-0000-0000-0000-000000000004';
select throws_ok(
  $$select public.commit_match_command(
    '91000000-0000-0000-0000-000000000004',
    '92000000-0000-4000-8000-000000000008',
    '90000000-0000-0000-0000-000000000008',
    (-1)::smallint, true, 0, 1::smallint, 3::smallint,
    '[{"idx":0,"who":1,"col":0,"die":3}]',
    0::smallint, 2::smallint, null, '{"your_die":3,"auto":true}',
    clock_timestamp()
  )$$,
  'P0001',
  'command is not stalled yet',
  'a drifted stall projection is rejected even after the interval elapses'
);
create temporary table stalled_auto as
select public.commit_match_command(
  '91000000-0000-0000-0000-000000000004',
  '92000000-0000-4000-8000-000000000009',
  '90000000-0000-0000-0000-000000000008',
  (-1)::smallint, true, 0, 1::smallint, 3::smallint,
  '[{"idx":0,"who":1,"col":0,"die":3}]',
  0::smallint, 2::smallint, null, '{"your_die":3,"auto":true}',
  (select last_move_at from public.matches
    where id = '91000000-0000-0000-0000-000000000004')
) as payload;
select is(
  (select concat(payload->'match'->>'turn', '/', payload->>'auto')
     from stalled_auto),
  '0/true',
  'a genuinely stalled auto move passes the database stall gate'
);

select * from finish();
rollback;
