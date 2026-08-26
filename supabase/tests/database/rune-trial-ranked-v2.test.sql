begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(59);

select is(private.ranked_pool_tier_for_peak(299), 'stone',
  'STONE owns peaks below 300');
select is(private.ranked_pool_tier_for_peak(300), 'bone',
  'BONE begins at peak 300');
select is(private.ranked_pool_tier_for_peak(720), 'ivory',
  'IVORY begins at peak 720');
select ok(has_table_privilege('authenticated', 'public.player_runes', 'select'),
  'authenticated players can read their RLS-filtered collection');
select ok(not has_table_privilege('authenticated', 'public.player_runes', 'insert'),
  'clients cannot award themselves runes');
select ok(not has_table_privilege('authenticated', 'public.player_runes', 'update'),
  'clients cannot mutate reward metadata directly');
select ok(not (
  has_table_privilege('service_role', 'public.player_runes', 'select')
  or has_table_privilege('service_role', 'public.player_runes', 'insert')
  or has_table_privilege('service_role', 'public.player_runes', 'update')
  or has_table_privilege('service_role', 'public.player_runes', 'delete')
), 'the service role reaches rune rewards only through validated RPCs');
select ok(not (
  has_table_privilege('service_role', 'public.player_runes', 'truncate')
  or has_table_privilege('service_role', 'public.player_runes', 'references')
  or has_table_privilege('service_role', 'public.player_runes', 'trigger')
  or has_table_privilege('service_role', 'public.player_runes', 'maintain')
), 'the settlement service has no schema-administration privileges');
select ok(has_table_privilege('authenticated', 'public.match_actions', 'select'),
  'participants can read the public protocol-v2 action log');
select ok(not has_table_privilege('authenticated', 'public.match_actions', 'insert'),
  'clients cannot append authoritative actions directly');
select ok(
  has_table_privilege('service_role', 'public.match_actions', 'select')
  and not has_table_privilege('service_role', 'public.match_actions', 'insert')
  and not has_table_privilege('service_role', 'public.match_actions', 'update')
  and not has_table_privilege('service_role', 'public.match_actions', 'delete')
  and not has_table_privilege('service_role', 'public.match_actions', 'truncate')
  and not has_table_privilege('service_role', 'public.match_actions', 'references')
  and not has_table_privilege('service_role', 'public.match_actions', 'trigger')
  and not has_table_privilege('service_role', 'public.match_actions', 'maintain'),
  'the action service can read replay rows but cannot forge or administer them'
);
select ok(not has_table_privilege('authenticated', 'private.rune_trial_choices', 'select'),
  'private choices are not directly readable by clients');
select ok(has_function_privilege(
  'authenticated', 'public.acknowledge_rune_reward(text)', 'execute'
), 'authenticated players can acknowledge their own reward');
select ok(not has_function_privilege(
  'anon', 'public.acknowledge_rune_reward(text)', 'execute'
), 'anonymous callers cannot acknowledge rewards');
select ok(has_function_privilege(
  'service_role', 'public.commit_rune_trial_choice(uuid,uuid,uuid,text,boolean)', 'execute'
), 'the selection Edge Function can commit a private choice');
select ok(not has_function_privilege(
  'authenticated', 'public.commit_rune_trial_choice(uuid,uuid,uuid,text,boolean)', 'execute'
), 'clients cannot bypass the selection Edge Function');
select ok(has_function_privilege(
  'service_role',
  'public.commit_match_action(uuid,uuid,uuid,boolean,integer,smallint,smallint,timestamp with time zone,jsonb,jsonb,smallint,smallint,jsonb,jsonb)',
  'execute'
), 'the action Edge Function can commit an atomic protocol-v2 command');
select ok(not has_function_privilege(
  'authenticated',
  'public.commit_match_action(uuid,uuid,uuid,boolean,integer,smallint,smallint,timestamp with time zone,jsonb,jsonb,smallint,smallint,jsonb,jsonb)',
  'execute'
), 'clients cannot bypass authoritative action replay');

insert into auth.users (id, email, created_at, updated_at)
values
  ('96000000-0000-0000-0000-000000000001', 'trial-1@example.invalid', now(), now()),
  ('96000000-0000-0000-0000-000000000002', 'trial-2@example.invalid', now(), now()),
  ('96000000-0000-0000-0000-000000000003', 'trial-3@example.invalid', now(), now()),
  ('96000000-0000-0000-0000-000000000004', 'trial-4@example.invalid', now(), now()),
  ('96000000-0000-0000-0000-000000000005', 'trial-5@example.invalid', now(), now()),
  ('96000000-0000-0000-0000-000000000006', 'trial-6@example.invalid', now(), now()),
  ('96000000-0000-0000-0000-000000000007', 'trial-7@example.invalid', now(), now()),
  ('96000000-0000-0000-0000-000000000008', 'trial-8@example.invalid', now(), now()),
  ('96000000-0000-0000-0000-000000000009', 'trial-9@example.invalid', now(), now()),
  ('96000000-0000-0000-0000-000000000010', 'trial-10@example.invalid', now(), now());

update public.profiles
   set ranked_pool_tier = 'ivory'
 where id in (
   '96000000-0000-0000-0000-000000000001',
   '96000000-0000-0000-0000-000000000002'
 );

set local role service_role;
select public.enqueue_ranked_player('96000000-0000-0000-0000-000000000010');
select public.enqueue_ranked_player_v2(
  '96000000-0000-0000-0000-000000000001', 2::smallint, array['rune_trial_v1']
);
select public.enqueue_ranked_player_v2(
  '96000000-0000-0000-0000-000000000002', 2::smallint, array['rune_trial_v1']
);
reset role;

select is(
  (select concat(protocol_version, '/', cardinality(capabilities), '/', pool_tier)
     from public.matchmaking_queue
    where player_id = '96000000-0000-0000-0000-000000000010'),
  '1/0/stone',
  'the legacy queue path remains protocol v1 with no Trial capability'
);
select is(
  (select string_agg(
      concat(protocol_version, '/', capabilities[1], '/', pool_tier), ','
      order by player_id
    )
     from public.matchmaking_queue
    where player_id in (
      '96000000-0000-0000-0000-000000000001',
      '96000000-0000-0000-0000-000000000002'
    )),
  '2/rune_trial_v1/ivory,2/rune_trial_v1/ivory',
  'the v2 queue stores each participant capability and permanent pool tier'
);

create temporary table started_trial (payload jsonb);
grant select, insert on started_trial to service_role;
set local role service_role;
insert into started_trial (payload)
select public.start_ranked_match_v2(
  '96000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000002',
  'trial-start-seed', 4::smallint, 'classic', 1::smallint,
  '96000000-0000-0000-0000-000000000002',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'rune_trial', array['fate','nudge','ward'],
  clock_timestamp() + interval '30 seconds', 'fate', 'nudge'
);
reset role;

select is(
  (select concat(
      payload->>'created', '/', payload->'match'->>'format', '/',
      payload->'match'->>'protocol_version', '/', payload->'match'->>'phase', '/',
      payload->'match'->>'pool_tier'
    ) from started_trial),
  'true/rune_trial/2/selection/ivory',
  'v2 start atomically creates an unrevealed IVORY Rune Trial'
);
select is(
  (select concat(p1_auto_rune, '/', p2_auto_rune, '/', p1_choice, '/', p2_choice)
     from private.rune_trial_choices
    where match_id = (select (payload->'match'->>'id')::uuid from started_trial)),
  'fate/nudge//',
  'v2 start stores only deterministic fallbacks in the private choice row'
);
select is(
  (select count(*)::integer from public.matchmaking_queue
    where player_id in (
      '96000000-0000-0000-0000-000000000001',
      '96000000-0000-0000-0000-000000000002'
    )),
  0,
  'match start consumes both v2 queue claims in the same transaction'
);

-- A candidate snapshot read by the Edge Function is not authority. Re-enqueue
-- may replace that row from another tab before start takes its locks; the RPC
-- must reject the stale Trial draw without consuming either current claim.
update public.profiles
   set ranked_pool_tier = 'ivory'
 where id in (
   '96000000-0000-0000-0000-000000000003',
   '96000000-0000-0000-0000-000000000004'
 );
set local role service_role;
select public.enqueue_ranked_player_v2(
  '96000000-0000-0000-0000-000000000003', 2::smallint, array['rune_trial_v1']
);
select public.enqueue_ranked_player_v2(
  '96000000-0000-0000-0000-000000000004', 2::smallint, array['rune_trial_v1']
);
update public.matchmaking_queue
   set protocol_version = 1, capabilities = '{}'::text[]
 where player_id = '96000000-0000-0000-0000-000000000004';
reset role;
select throws_ok(
  $$select public.start_ranked_match_v2(
    '96000000-0000-0000-0000-000000000003',
    '96000000-0000-0000-0000-000000000003',
    '96000000-0000-0000-0000-000000000004',
    'stale-capability-seed', 2::smallint, 'classic', 1::smallint,
    '96000000-0000-0000-0000-000000000004',
    null::smallint, null::smallint, null::smallint, null::smallint,
    2::smallint, 'ivory', 'rune_trial', array['fate','ward','anvil'],
    clock_timestamp() + interval '30 seconds', 'fate', 'ward'
  )$$,
  'P0001', 'ranked queue metadata changed before match start',
  'match start rejects a Trial drawn from stale queue capabilities'
);
select is(
  (select count(*)::integer from public.matchmaking_queue
    where player_id in (
      '96000000-0000-0000-0000-000000000003',
      '96000000-0000-0000-0000-000000000004'
    )),
  2,
  'a rejected stale Trial leaves both current queue claims intact'
);
delete from public.matchmaking_queue
 where player_id in (
   '96000000-0000-0000-0000-000000000003',
   '96000000-0000-0000-0000-000000000004'
 );

create temporary table first_choice (payload jsonb);
grant insert on first_choice to service_role;
set local role service_role;
insert into first_choice (payload)
select public.commit_rune_trial_choice(
  (select (payload->'match'->>'id')::uuid from started_trial),
  '97000000-0000-4000-8000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  'ward', false
);
reset role;

select is(
  (select concat(
      payload->'trial'->>'your_choice', '/',
      payload->'trial'->>'opponent_committed', '/',
      payload->'match'->>'p1_rune', '/', payload->'match'->>'p2_rune'
    ) from first_choice),
  'ward/false//',
  'the first response returns only the actor choice and no public reveal'
);
select is(
  (select concat(phase, '/', p1_rune, '/', p2_rune, '/', selection_version)
     from public.matches
    where id = (select (payload->'match'->>'id')::uuid from started_trial)),
  'selection///1',
  'one private commitment advances the realtime version without revealing either rune'
);
select is(
  public.commit_rune_trial_choice(
    (select (payload->'match'->>'id')::uuid from started_trial),
    '97000000-0000-4000-8000-000000000001',
    '96000000-0000-0000-0000-000000000001',
    'ward', false
  ),
  (select payload from first_choice),
  'the same selection command replays its exact redacted response'
);
select throws_ok(
  $$select public.commit_rune_trial_choice(
    (select (payload->'match'->>'id')::uuid from started_trial),
    '97000000-0000-4000-8000-000000000001',
    '96000000-0000-0000-0000-000000000001',
    'fate', false
  )$$,
  '22023',
  'selection command id was reused with different input',
  'a selection command key cannot be reused with different input'
);

create temporary table second_choice as
select public.commit_rune_trial_choice(
  (select (payload->'match'->>'id')::uuid from started_trial),
  '97000000-0000-4000-8000-000000000002',
  '96000000-0000-0000-0000-000000000002',
  'nudge', false
) as payload;
select is(
  (select concat(
      payload->'match'->>'phase', '/', payload->'match'->>'p1_rune', '/',
      payload->'match'->>'p2_rune', '/', payload->'trial'->>'your_choice'
    ) from second_choice),
  'playing/ward/nudge/nudge',
  'the second commitment reveals both assignments and starts play'
);
select is(
  (select concat(selection_version, '/', selection_deadline is null)
     from public.matches
    where id = (select (payload->'match'->>'id')::uuid from started_trial)),
  '3/t',
  'selection commits and reveal advance the public version and clear the deadline'
);

insert into public.matches (
  id, p1, p2, status, turn, next_die, modifier, season_id,
  format, protocol_version, rune_rules_version, pool_tier, phase,
  trial_offer, selection_deadline
) values (
  '96100000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000003',
  '96000000-0000-0000-0000-000000000004',
  'active', 1, 2, 'classic', 1,
  'rune_trial', 2, 1, 'ivory', 'selection',
  array['fate','ward','anvil'], clock_timestamp() - interval '1 second'
);
insert into private.rune_trial_choices (
  match_id, p1_auto_rune, p2_auto_rune
) values (
  '96100000-0000-0000-0000-000000000001', 'fate', 'anvil'
);

create temporary table auto_choice as
select public.commit_rune_trial_choice(
  '96100000-0000-0000-0000-000000000001',
  '97000000-0000-4000-8000-000000000003',
  '96000000-0000-0000-0000-000000000003',
  null, true
) as payload;
select is(
  (select concat(
      payload->'match'->>'p1_rune', '/', payload->'match'->>'p2_rune', '/',
      payload->'trial'->>'your_choice'
    ) from auto_choice),
  'fate/anvil/fate',
  'deadline recovery uses the precomputed deterministic choices for both seats'
);
select is(
  (select concat(phase, '/', selection_version, '/', selection_deadline is null)
     from public.matches where id = '96100000-0000-0000-0000-000000000001'),
  'playing/1/t',
  'deadline recovery atomically publishes the reveal exactly once'
);

insert into public.season_ratings (season_id, player)
values
  (1, '96000000-0000-0000-0000-000000000005'),
  (1, '96000000-0000-0000-0000-000000000006'),
  (1, '96000000-0000-0000-0000-000000000007'),
  (1, '96000000-0000-0000-0000-000000000008'),
  (1, '96000000-0000-0000-0000-000000000009')
on conflict (season_id, player) do nothing;

insert into public.matches (
  id, p1, p2, status, turn, next_die, modifier, season_id,
  format, protocol_version, rune_rules_version, pool_tier, phase,
  trial_offer, p1_rune, p2_rune
) values (
  '96100000-0000-0000-0000-000000000002',
  '96000000-0000-0000-0000-000000000005',
  '96000000-0000-0000-0000-000000000006',
  'active', 1, 4, 'classic', 1,
  'rune_trial', 2, 1, 'ivory', 'playing',
  array['nudge','ward','fate'], 'nudge', 'ward'
);
insert into private.rune_trial_choices (
  match_id, p1_choice, p2_choice, p1_auto_rune, p2_auto_rune
) values (
  '96100000-0000-0000-0000-000000000002',
  'nudge', 'ward', 'nudge', 'ward'
);

create temporary table cast_action (payload jsonb);
grant insert on cast_action to service_role;
set local role service_role;
insert into cast_action (payload)
select public.commit_match_action(
  '96100000-0000-0000-0000-000000000002',
  '97000000-0000-4000-8000-000000000004',
  '96000000-0000-0000-0000-000000000005',
  false, 0, 1::smallint, 4::smallint, null,
  '{"kind":"cast","rune_id":"nudge","target_col":-1}',
  '[{"idx":0,"move_idx":null,"who":1,"kind":"cast","rune_id":"nudge","target_col":-1,"placed_col":null,"die_before":4,"die_after":5}]',
  1::smallint, 5::smallint, null, '{"your_die":4}'
);
reset role;

select is(
  (select concat(
      payload->>'action_version', '/', payload->'match'->>'turn', '/',
      payload->'match'->>'next_die', '/', payload->'actions'->0->>'kind', '/',
      payload->'actions'->0 ? 'match_id'
    ) from cast_action),
  '1/1/5/cast/f',
  'a cast commits its public transition without leaking an internal match_id field'
);
select is(
  (select concat(
      (select count(*) from public.match_actions
        where match_id = '96100000-0000-0000-0000-000000000002'), '/',
      (select count(*) from public.match_moves
        where match_id = '96100000-0000-0000-0000-000000000002')
    )),
  '1/0',
  'a cast advances action_version without masquerading as a placement'
);

create temporary table place_action (payload jsonb);
grant insert on place_action to service_role;
set local role service_role;
insert into place_action (payload)
select public.commit_match_action(
  '96100000-0000-0000-0000-000000000002',
  '97000000-0000-4000-8000-000000000005',
  '96000000-0000-0000-0000-000000000005',
  false, 1, 1::smallint, 5::smallint, null,
  '{"kind":"place","placed_col":0}',
  '[{"idx":1,"move_idx":0,"who":1,"kind":"place","rune_id":null,"target_col":null,"placed_col":0,"die_before":5,"die_after":null}]',
  null::smallint, null::smallint,
  '{"status":"done","winner":"96000000-0000-0000-0000-000000000005","p1_score":20,"p2_score":10,"p1_delta":740,"p2_delta":0,"expected_p1":{"points":0,"peak":0,"wins":0,"losses":0,"draws":0},"expected_p2":{"points":0,"peak":0,"wins":0,"losses":0,"draws":0},"next_p1":{"points":740,"peak":740,"wins":1,"losses":0,"draws":0},"next_p2":{"points":0,"peak":0,"wins":0,"losses":1,"draws":0}}',
  '{"your_die":5}'
);
reset role;

select is(
  (select concat(
      payload->>'action_version', '/', payload->'match'->>'status', '/',
      payload->'actions'->0->>'move_idx', '/', payload->'reward'->>'rune_id'
    ) from place_action),
  '2/done/0/nudge',
  'a terminal placement atomically commits action, settlement, and rune reward'
);
select is(
  (select concat(idx, '/', who, '/', col, '/', die)
     from public.match_moves
    where match_id = '96100000-0000-0000-0000-000000000002'),
  '0/1/0/5',
  'protocol-v2 placements remain mirrored into the legacy move log'
);
select is(
  public.commit_match_action(
    '96100000-0000-0000-0000-000000000002',
    '97000000-0000-4000-8000-000000000005',
    '96000000-0000-0000-0000-000000000005',
    false, 1, 1::smallint, 5::smallint, null,
    '{"kind":"place","placed_col":0}',
    '[{"idx":1,"move_idx":0,"who":1,"kind":"place","rune_id":null,"target_col":null,"placed_col":0,"die_before":5,"die_after":null}]',
    null::smallint, null::smallint,
    '{"status":"done","winner":"96000000-0000-0000-0000-000000000005","p1_score":20,"p2_score":10,"p1_delta":740,"p2_delta":0,"expected_p1":{"points":0,"peak":0,"wins":0,"losses":0,"draws":0},"expected_p2":{"points":0,"peak":0,"wins":0,"losses":0,"draws":0},"next_p1":{"points":740,"peak":740,"wins":1,"losses":0,"draws":0},"next_p2":{"points":0,"peak":0,"wins":0,"losses":1,"draws":0}}',
    '{"your_die":5}'
  ),
  (select payload from place_action),
  'the same action command replays its exact committed response'
);
select throws_ok(
  $$select public.match_action_result(
    '96100000-0000-0000-0000-000000000002',
    '97000000-0000-4000-8000-000000000005',
    '96000000-0000-0000-0000-000000000005',
    false, 1, '{"kind":"place","placed_col":1}'
  )$$,
  '22023',
  'action command id was reused with different input',
  'an action command key cannot be reused with different input'
);

create temporary table first_reward as select payload from place_action;
select is(
  (select concat(
      payload->'match'->>'status', '/', payload->'reward'->>'rune_id', '/',
      payload->'reward'->>'newly_collected'
    ) from first_reward),
  'done/nudge/true',
  'atomic Trial settlement returns the winner selected rune as a new reward'
);
select is(
  (select concat(rune_id, '/', source_match_id, '/', seen_at is null)
     from public.player_runes
    where player_id = '96000000-0000-0000-0000-000000000005'),
  'nudge/96100000-0000-0000-0000-000000000002/t',
  'the collection stores a durable unseen reward and its source match'
);
select is(
  (select ranked_pool_tier from public.profiles
    where id = '96000000-0000-0000-0000-000000000005'),
  'ivory',
  'settlement promotes the permanent ranked pool tier from historical peak'
);
select is(
  concat(
    (public.settle_match(
      '96100000-0000-0000-0000-000000000002',
      'done', '96000000-0000-0000-0000-000000000005',
      20, 10, 0, 0, '{}', '{}', '{}', '{}'
    )->>'applied'), '/',
    (public.settle_match(
      '96100000-0000-0000-0000-000000000002',
      'done', '96000000-0000-0000-0000-000000000005',
      20, 10, 0, 0, '{}', '{}', '{}', '{}'
    ) ? 'reward'), '/',
    (select count(*) from public.player_runes
      where player_id = '96000000-0000-0000-0000-000000000005')
  ),
  'false/f/1',
  'a settlement retry cannot pay the match twice'
);

insert into public.matches (
  id, p1, p2, status, turn, next_die, modifier, season_id,
  format, protocol_version, rune_rules_version, pool_tier, phase,
  trial_offer, p1_rune, p2_rune
) values (
  '96100000-0000-0000-0000-000000000003',
  '96000000-0000-0000-0000-000000000005',
  '96000000-0000-0000-0000-000000000007',
  'active', 1, 6, 'classic', 1,
  'rune_trial', 2, 1, 'ivory', 'playing',
  array['nudge','ward','anvil'], 'nudge', 'anvil'
);
insert into private.rune_trial_choices (
  match_id, p1_choice, p2_choice, p1_auto_rune, p2_auto_rune
) values (
  '96100000-0000-0000-0000-000000000003',
  'nudge', 'anvil', 'nudge', 'anvil'
);

create temporary table repeated_reward as
select public.settle_match(
  '96100000-0000-0000-0000-000000000003',
  'done', '96000000-0000-0000-0000-000000000005',
  12, 3, -730, 0,
  '{"points":740,"peak":740,"wins":1,"losses":0,"draws":0}',
  '{"points":0,"peak":0,"wins":0,"losses":0,"draws":0}',
  '{"points":10,"peak":0,"wins":2,"losses":0,"draws":0}',
  '{"points":0,"peak":0,"wins":0,"losses":1,"draws":0}'
) as payload;
select is(
  (select concat(payload->'reward'->>'rune_id', '/',
                 payload->'reward'->>'newly_collected') from repeated_reward),
  'nudge/false',
  'winning a previously collected rune reports a non-new reward'
);
select is(
  (select concat(count(*), '/', min(source_match_id::text))
     from public.player_runes
    where player_id = '96000000-0000-0000-0000-000000000005'
      and rune_id = 'nudge'),
  '1/96100000-0000-0000-0000-000000000002',
  'repeat rewards do not replace the original collection receipt'
);
select is(
  (select ranked_pool_tier from public.profiles
    where id = '96000000-0000-0000-0000-000000000005'),
  'ivory',
  'a later lower peak cannot demote the permanent ranked pool tier'
);

insert into public.matches (
  id, p1, p2, status, turn, next_die, modifier, season_id,
  format, protocol_version, rune_rules_version, pool_tier, phase,
  trial_offer, p1_rune, p2_rune
) values (
  '96100000-0000-0000-0000-000000000005',
  '96000000-0000-0000-0000-000000000008',
  '96000000-0000-0000-0000-000000000009',
  'active', 1, 4, 'classic', 1,
  'rune_trial', 2, 1, 'ivory', 'playing',
  array['anvil','ward','fate'], 'anvil', 'anvil'
);
insert into private.rune_trial_choices (
  match_id, p1_choice, p2_choice, p1_auto_rune, p2_auto_rune
) values (
  '96100000-0000-0000-0000-000000000005',
  'anvil', 'anvil', 'anvil', 'anvil'
);

select throws_ok(
  $$select public.commit_match_action(
    '96100000-0000-0000-0000-000000000005',
    '97000000-0000-4000-8000-000000000006',
    '96000000-0000-0000-0000-000000000008',
    false, 0, 1::smallint, 4::smallint, null,
    '{"kind":"cast","rune_id":"anvil","target_col":0}',
    '[{"idx":0,"move_idx":null,"who":1,"kind":"cast","rune_id":"anvil","target_col":0,"placed_col":null,"die_before":4,"die_after":4}]',
    1::smallint, 4::smallint, null, '{}'
  )$$,
  '22023', 'invalid cast action',
  'ANVIL cannot cast before its authoritative aim is persisted'
);

create temporary table aim_action as
select public.commit_match_action(
  '96100000-0000-0000-0000-000000000005',
  '97000000-0000-4000-8000-000000000007',
  '96000000-0000-0000-0000-000000000008',
  false, 0, 1::smallint, 4::smallint, null,
  '{"kind":"aim","rune_id":"anvil"}',
  '[{"idx":0,"move_idx":null,"who":1,"kind":"aim","rune_id":"anvil","target_col":null,"placed_col":null,"die_before":4,"die_after":4}]',
  1::smallint, 4::smallint, null, '{}'
) as payload;
select is(
  (select concat(
    payload->>'action_version', '/', payload->'match'->>'pending_aim', '/',
    payload->'actions'->0->>'kind', '/', payload->'actions'->0->>'die_after', '/',
    (select count(*) from public.match_moves
      where match_id = '96100000-0000-0000-0000-000000000005')
  ) from aim_action),
  '1/anvil/aim/4/0',
  'aim reserves ANVIL publicly without changing the die, turn, or move log'
);
select is(
  public.commit_match_action(
    '96100000-0000-0000-0000-000000000005',
    '97000000-0000-4000-8000-000000000007',
    '96000000-0000-0000-0000-000000000008',
    false, 0, 1::smallint, 4::smallint, null,
    '{"kind":"aim","rune_id":"anvil"}',
    '[{"idx":0,"move_idx":null,"who":1,"kind":"aim","rune_id":"anvil","target_col":null,"placed_col":null,"die_before":4,"die_after":4}]',
    1::smallint, 4::smallint, null, '{}'
  ),
  (select payload from aim_action),
  'the same aim command replays its exact committed response'
);
select throws_ok(
  $$select public.commit_match_action(
    '96100000-0000-0000-0000-000000000005',
    '97000000-0000-4000-8000-000000000008',
    '96000000-0000-0000-0000-000000000008',
    false, 1, 1::smallint, 4::smallint, null,
    '{"kind":"place","placed_col":0}',
    '[{"idx":1,"move_idx":0,"who":1,"kind":"place","rune_id":null,"target_col":null,"placed_col":0,"die_before":4,"die_after":5}]',
    0::smallint, 5::smallint, null, '{}'
  )$$,
  '22023', 'invalid placement action',
  'placement cannot bypass a persisted ANVIL reservation'
);

create temporary table resolved_aim as
select public.commit_match_action(
  '96100000-0000-0000-0000-000000000005',
  '97000000-0000-4000-8000-000000000009',
  '96000000-0000-0000-0000-000000000008',
  false, 1, 1::smallint, 4::smallint, null,
  '{"kind":"cast","rune_id":"anvil","target_col":0}',
  '[{"idx":1,"move_idx":null,"who":1,"kind":"cast","rune_id":"anvil","target_col":0,"placed_col":null,"die_before":4,"die_after":4}]',
  1::smallint, 4::smallint, null, '{}'
) as payload;
select is(
  (select concat(
    payload->>'action_version', '/',
    coalesce(payload->'match'->>'pending_aim', 'clear'), '/',
    payload->'actions'->0->>'kind'
  ) from resolved_aim),
  '2/clear/cast',
  'the matching ANVIL cast clears the reservation without ending the turn'
);

create temporary table bot_aim as
select public.commit_match_action(
  '96100000-0000-0000-0000-000000000005',
  '97000000-0000-4000-8000-000000000010',
  '96000000-0000-0000-0000-000000000008',
  false, 2, 1::smallint, 4::smallint, null,
  '{"kind":"place","placed_col":0}',
  '[{"idx":2,"move_idx":0,"who":1,"kind":"place","rune_id":null,"target_col":null,"placed_col":0,"die_before":4,"die_after":5},{"idx":3,"move_idx":null,"who":0,"kind":"aim","rune_id":"anvil","target_col":null,"placed_col":null,"die_before":5,"die_after":5}]',
  0::smallint, 5::smallint, null, '{}'
) as payload;
select is(
  (select concat(
    payload->>'action_version', '/', payload->'match'->>'turn', '/',
    payload->'match'->>'pending_aim', '/', payload->'actions'->1->>'kind', '/',
    (select count(*) from public.match_moves
      where match_id = '96100000-0000-0000-0000-000000000005')
  ) from bot_aim),
  '4/0/anvil/aim/1',
  'a placement and bot aim can commit atomically while preserving the reservation'
);

create temporary table pending_settlement as
select public.settle_match(
  '96100000-0000-0000-0000-000000000005',
  'forfeit', '96000000-0000-0000-0000-000000000008',
  0, 0, 1, 0,
  '{"points":0,"peak":0,"wins":0,"losses":0,"draws":0}',
  '{"points":0,"peak":0,"wins":0,"losses":0,"draws":0}',
  '{"points":1,"peak":1,"wins":1,"losses":0,"draws":0}',
  '{"points":0,"peak":0,"wins":0,"losses":1,"draws":0}'
) as payload;
select is(
  (select concat(
    payload->'match'->>'status', '/',
    coalesce(payload->'match'->>'pending_aim', 'clear'), '/',
    payload->'reward'->>'rune_id'
  ) from pending_settlement),
  'forfeit/clear/anvil',
  'settlement clears a pending aim atomically before awarding the winner rune'
);

select set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000005',
  true
);
set local role authenticated;
select is((select count(*)::integer from public.player_runes), 1,
  'collection RLS reveals the owner reward');
select is((select count(*)::integer from public.match_actions), 2,
  'action-log RLS reveals actions from a participant match');
select ok(public.acknowledge_rune_reward('nudge'),
  'the owner can acknowledge the durable reward');
reset role;
select ok(
  (select seen_at is not null from public.player_runes
    where player_id = '96000000-0000-0000-0000-000000000005'
      and rune_id = 'nudge'),
  'reward acknowledgement persists seen_at'
);

select set_config(
  'request.jwt.claim.sub',
  '96000000-0000-0000-0000-000000000010',
  true
);
set local role authenticated;
select is(
  concat(
    (select count(*) from public.player_runes), '/',
    (select count(*) from public.match_actions)
  ),
  '0/0',
  'collection and action-log RLS hide another player matches and rewards'
);
reset role;

select lives_ok(
  $$insert into public.matches (
      id, p1, p2, status, turn, next_die, modifier, season_id
    ) values (
      '96100000-0000-0000-0000-000000000004',
      '96000000-0000-0000-0000-000000000008',
      '96000000-0000-0000-0000-000000000009',
      'done', 1, null, 'limited', 1
    )$$,
  'the ranked match constraint retains the existing LIMITED modifier'
);

select * from finish();
rollback;
