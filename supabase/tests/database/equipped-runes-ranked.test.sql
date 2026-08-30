begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(15);

select ok(
  has_function_privilege(
    'service_role',
    'public.start_ranked_match_v3(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamp with time zone,text,text,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.start_ranked_match_v3(uuid,uuid,uuid,text,smallint,text,smallint,uuid,smallint,smallint,smallint,smallint,smallint,text,text,text[],timestamp with time zone,text,text,boolean)',
    'execute'
  ),
  'only the matchmaking service can snapshot equipped runes into a match'
);

insert into auth.users (id, email, created_at, updated_at)
select
  format('98000000-0000-0000-0000-%s', lpad(ordinal::text, 12, '0'))::uuid,
  format('equipped-ranked-%s@example.invalid', ordinal),
  now(), now()
from generate_series(1, 12) ordinal;

update public.profiles
   set ranked_pool_tier = 'ivory',
       rating = case id
         when '98000000-0000-0000-0000-000000000001' then 1260
         when '98000000-0000-0000-0000-000000000002' then 1600
         when '98000000-0000-0000-0000-000000000003' then 1259
         when '98000000-0000-0000-0000-000000000004' then 1260
         when '98000000-0000-0000-0000-000000000005' then 2000
         when '98000000-0000-0000-0000-000000000006' then 2100
         when '98000000-0000-0000-0000-000000000011' then 0
         when '98000000-0000-0000-0000-000000000012' then 1259
         else 0
       end;
update public.profiles
   set is_bot = true
 where id = '98000000-0000-0000-0000-000000000007';

insert into public.player_runes (player_id, rune_id, source_match_id)
values
  ('98000000-0000-0000-0000-000000000001', 'ward', null),
  ('98000000-0000-0000-0000-000000000001', 'nudge', null),
  ('98000000-0000-0000-0000-000000000002', 'fate', null),
  ('98000000-0000-0000-0000-000000000003', 'fate', null),
  ('98000000-0000-0000-0000-000000000004', 'anvil', null),
  ('98000000-0000-0000-0000-000000000005', 'ward', null),
  ('98000000-0000-0000-0000-000000000006', 'nudge', null),
  ('98000000-0000-0000-0000-000000000007', 'fate', null),
  ('98000000-0000-0000-0000-000000000007', 'ward', null),
  ('98000000-0000-0000-0000-000000000009', 'fate', null),
  ('98000000-0000-0000-0000-000000000011', 'sunder', null),
  ('98000000-0000-0000-0000-000000000012', 'pilfer', null);

update public.profiles
   set equipped_rune = case id
     when '98000000-0000-0000-0000-000000000001' then 'ward'
     when '98000000-0000-0000-0000-000000000003' then 'fate'
     when '98000000-0000-0000-0000-000000000004' then 'anvil'
     when '98000000-0000-0000-0000-000000000005' then 'ward'
     when '98000000-0000-0000-0000-000000000006' then 'nudge'
     when '98000000-0000-0000-0000-000000000011' then 'sunder'
     when '98000000-0000-0000-0000-000000000012' then 'pilfer'
     else equipped_rune
   end;

set local role service_role;
select public.enqueue_ranked_player_v2(
  player, 2::smallint, array['rune_trial_v1','equipped_rune_v1']
)
from unnest(array[
  '98000000-0000-0000-0000-000000000001'::uuid,
  '98000000-0000-0000-0000-000000000002'::uuid
]) player;
reset role;

select is(
  (select string_agg(array_to_string(capabilities, '+'), ',' order by player_id)
     from public.matchmaking_queue
    where player_id in (
      '98000000-0000-0000-0000-000000000001',
      '98000000-0000-0000-0000-000000000002'
    )),
  'rune_trial_v1+equipped_rune_v1,rune_trial_v1+equipped_rune_v1',
  'the queue persists the distinct equipped-rune capability for both peers'
);

create temporary table equipped_start (payload jsonb);
grant insert, select on equipped_start to service_role;
set local role service_role;
insert into equipped_start (payload)
select public.start_ranked_match_v3(
  '98000000-0000-0000-0000-000000000001',
  '98000000-0000-0000-0000-000000000001',
  '98000000-0000-0000-0000-000000000002',
  'equipped-standard-seed', 4::smallint, 'classic', 1::smallint,
  '98000000-0000-0000-0000-000000000002',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'standard', null::text[], null::timestamptz,
  null::text, null::text, true
);
reset role;

select is(
  (select concat(
    payload->>'created', '/', payload->'match'->>'format', '/',
    payload->'match'->>'protocol_version', '/',
    payload->'match'->>'rune_rules_version', '/',
    payload->'match'->>'p1_rune', '/',
    coalesce(payload->'match'->>'p2_rune', 'none')
  ) from equipped_start),
  'true/standard/2/1/ward/none',
  'SILVER standard start snapshots an equipped seat and an honest empty seat'
);

update public.profiles
   set equipped_rune = 'nudge'
 where id = '98000000-0000-0000-0000-000000000001';
select is(
  (select p1_rune from public.matches
    where id = (select (payload->'match'->>'id')::uuid from equipped_start)),
  'ward',
  'changing the profile after matchmaking cannot rewrite the match snapshot'
);

create temporary table equipped_action (payload jsonb);
grant insert, select on equipped_action to service_role;
set local role service_role;
insert into equipped_action (payload)
select public.commit_match_action(
  (select (payload->'match'->>'id')::uuid from equipped_start),
  '98200000-0000-4000-8000-000000000001',
  '98000000-0000-0000-0000-000000000001',
  false, 0, 1::smallint, 4::smallint, null,
  '{"kind":"place","placed_col":0}'::jsonb,
  '[{"idx":0,"move_idx":0,"who":1,"kind":"place","rune_id":null,"target_col":null,"placed_col":0,"die_before":4,"die_after":5}]'::jsonb,
  0::smallint, 5::smallint, null, '{}'::jsonb
);
reset role;
select is(
  (select concat(payload->>'action_version', '/', payload->'match'->>'turn')
     from equipped_action),
  '1/0',
  'ordinary equipped ranked commits its mandatory placement through the action log'
);

select throws_ok(
  $$select public.commit_match_action(
    (select (payload->'match'->>'id')::uuid from equipped_start),
    '98200000-0000-4000-8000-000000000002',
    '98000000-0000-0000-0000-000000000002',
    false, 1, 0::smallint, 5::smallint, null,
    '{"kind":"cast","rune_id":"fate","target_col":-1}'::jsonb,
    '[{"idx":1,"move_idx":null,"who":0,"kind":"cast","rune_id":"fate","target_col":-1,"placed_col":null,"die_before":5,"die_after":6}]'::jsonb,
    0::smallint, 6::smallint, null, '{}'::jsonb
  )$$,
  '22023', 'invalid cast action',
  'a participant with no match rune cannot cast a profile-owned rune'
);

select throws_ok(
  $$select public.commit_match_action(
    (select (payload->'match'->>'id')::uuid from equipped_start),
    '98200000-0000-4000-8000-000000000003',
    '98000000-0000-0000-0000-000000000002',
    false, 1, 0::smallint, 5::smallint, null,
    '{"kind":"cast","rune_id":null,"target_col":-1}'::jsonb,
    '[{"idx":1,"move_idx":null,"who":0,"kind":"cast","rune_id":null,"target_col":-1,"placed_col":null,"die_before":5,"die_after":6}]'::jsonb,
    0::smallint, 6::smallint, null, '{}'::jsonb
  )$$,
  '22023', 'invalid cast action',
  'a bare participant cannot persist a null-rune cast'
);

set local role service_role;
select public.enqueue_ranked_player_v2(
  player, 2::smallint, array['rune_trial_v1','equipped_rune_v1']
)
from unnest(array[
  '98000000-0000-0000-0000-000000000003'::uuid,
  '98000000-0000-0000-0000-000000000004'::uuid
]) player;
create temporary table threshold_start as
select public.start_ranked_match_v3(
  '98000000-0000-0000-0000-000000000003',
  '98000000-0000-0000-0000-000000000003',
  '98000000-0000-0000-0000-000000000004',
  'equipped-threshold-seed', 2::smallint, 'classic', 1::smallint,
  '98000000-0000-0000-0000-000000000004',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'standard', null::text[], null::timestamptz,
  null::text, null::text, true
) as payload;
reset role;
select is(
  (select concat(
    coalesce(payload->'match'->>'p1_rune', 'none'), '/',
    payload->'match'->>'p2_rune'
  ) from threshold_start),
  'none/anvil',
  'the 1259 seat is rune-free while the SILVER opponent carries its snapshot'
);

set local role service_role;
select public.enqueue_ranked_player_v2(
  player, 2::smallint, array['rune_trial_v1','equipped_rune_v1']
)
from unnest(array[
  '98000000-0000-0000-0000-000000000011'::uuid,
  '98000000-0000-0000-0000-000000000012'::uuid
]) player;
create temporary table below_start as
select public.start_ranked_match_v3(
  '98000000-0000-0000-0000-000000000011',
  '98000000-0000-0000-0000-000000000011',
  '98000000-0000-0000-0000-000000000012',
  'below-silver-seed', 3::smallint, 'classic', 1::smallint,
  '98000000-0000-0000-0000-000000000012',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'standard', null::text[], null::timestamptz,
  null::text, null::text, true
) as payload;
reset role;
select is(
  (select concat(
    payload->'match'->>'rune_rules_version', '/',
    coalesce(payload->'match'->>'p1_rune', 'none'), '/',
    coalesce(payload->'match'->>'p2_rune', 'none')
  ) from below_start),
  '1/none/none',
  'below SILVER both equipped profiles enter the game with empty hands'
);

set local role service_role;
select public.enqueue_ranked_player_v2(
  '98000000-0000-0000-0000-000000000005', 2::smallint,
  array['rune_trial_v1','equipped_rune_v1']
);
select public.enqueue_ranked_player_v2(
  '98000000-0000-0000-0000-000000000006', 2::smallint,
  array['rune_trial_v1']
);
create temporary table legacy_start as
select public.start_ranked_match_v3(
  '98000000-0000-0000-0000-000000000005',
  '98000000-0000-0000-0000-000000000005',
  '98000000-0000-0000-0000-000000000006',
  'mixed-client-seed', 6::smallint, 'classic', 1::smallint,
  '98000000-0000-0000-0000-000000000006',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'standard', null::text[], null::timestamptz,
  null::text, null::text, false
) as payload;
reset role;
select is(
  (select concat(
    coalesce(payload->'match'->>'rune_rules_version', 'legacy'), '/',
    coalesce(payload->'match'->>'p1_rune', 'none'), '/',
    coalesce(payload->'match'->>'p2_rune', 'none')
  ) from legacy_start),
  'legacy/none/none',
  'one old peer keeps ordinary ranked on the placement-only protocol'
);

select throws_ok(
  $$select public.enqueue_ranked_player_v2(
    '98000000-0000-0000-0000-000000000010', 2::smallint,
    array['rune_trial_v1','equipped_rune_v1','equipped_rune_v1']
  )$$,
  '22023', 'invalid ranked client capabilities',
  'duplicate equipped-rune capabilities are rejected at the database boundary'
);

insert into public.matches (
  id, p1, p2, status, turn, next_die, modifier, season_id,
  format, protocol_version, rune_rules_version, pool_tier, phase,
  trial_offer, p1_rune, p2_rune
) values (
  '98100000-0000-0000-0000-000000000007',
  '98000000-0000-0000-0000-000000000007',
  '98000000-0000-0000-0000-000000000008',
  'active', 1, 4, 'classic', 1,
  'rune_trial', 2, 1, 'ivory', 'playing',
  array['fate','nudge','ward'], 'nudge', 'ward'
);
set local role service_role;
select public.settle_match(
  '98100000-0000-0000-0000-000000000007',
  'done', '98000000-0000-0000-0000-000000000007',
  10, 5, 1, 0,
  '{"points":0,"peak":0,"wins":0,"losses":0,"draws":0}',
  '{"points":0,"peak":0,"wins":0,"losses":0,"draws":0}',
  '{"points":1,"peak":1,"wins":1,"losses":0,"draws":0}',
  '{"points":0,"peak":0,"wins":0,"losses":1,"draws":0}'
);
reset role;
select is(
  (select equipped_rune from public.profiles
    where id = '98000000-0000-0000-0000-000000000007'),
  private.bot_owned_rune_choice('98000000-0000-0000-0000-000000000007'),
  'a winning bot with no seat persists the stable pseudorandom owned choice'
);
select ok(
  exists (
    select 1
      from public.profiles profile
      join public.player_runes owned
        on owned.player_id = profile.id and owned.rune_id = profile.equipped_rune
     where profile.id = '98000000-0000-0000-0000-000000000007'
  ),
  'the bot equipped choice is one of its real winnings'
);

insert into public.matches (
  id, p1, p2, status, turn, next_die, modifier, season_id,
  format, protocol_version, rune_rules_version, pool_tier, phase,
  trial_offer, p1_rune, p2_rune
) values (
  '98100000-0000-0000-0000-000000000009',
  '98000000-0000-0000-0000-000000000009',
  '98000000-0000-0000-0000-000000000010',
  'active', 1, 4, 'classic', 1,
  'rune_trial', 2, 1, 'ivory', 'playing',
  array['fate','nudge','ward'], 'nudge', 'ward'
);
set local role service_role;
select public.settle_match(
  '98100000-0000-0000-0000-000000000009',
  'done', '98000000-0000-0000-0000-000000000009',
  10, 5, 1, 0,
  '{"points":0,"peak":0,"wins":0,"losses":0,"draws":0}',
  '{"points":0,"peak":0,"wins":0,"losses":0,"draws":0}',
  '{"points":1,"peak":1,"wins":1,"losses":0,"draws":0}',
  '{"points":0,"peak":0,"wins":0,"losses":1,"draws":0}'
);
reset role;
select is(
  (select equipped_rune from public.profiles
    where id = '98000000-0000-0000-0000-000000000009'),
  null,
  'a human reward never overwrites the deliberate empty equipped seat'
);

update public.matches
   set status = 'forfeit', finished_at = clock_timestamp()
 where id = (select (payload->'match'->>'id')::uuid from legacy_start);
set local role service_role;
select public.enqueue_ranked_player_v2(
  player, 2::smallint, array['rune_trial_v1','equipped_rune_v1']
)
from unnest(array[
  '98000000-0000-0000-0000-000000000005'::uuid,
  '98000000-0000-0000-0000-000000000006'::uuid
]) player;
create temporary table trial_start as
select public.start_ranked_match_v3(
  '98000000-0000-0000-0000-000000000005',
  '98000000-0000-0000-0000-000000000005',
  '98000000-0000-0000-0000-000000000006',
  'trial-ignores-equipped-seed', 3::smallint, 'classic', 1::smallint,
  '98000000-0000-0000-0000-000000000006',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'rune_trial', array['fate','nudge','anvil'],
  clock_timestamp() + interval '10 seconds', 'fate', 'nudge', false
) as payload;
reset role;
select is(
  (select concat(
    payload->'match'->>'phase', '/',
    coalesce(payload->'match'->>'p1_rune', 'hidden'), '/',
    coalesce(payload->'match'->>'p2_rune', 'hidden')
  ) from trial_start),
  'selection/hidden/hidden',
  'Rune Trial ignores both equipped profiles and starts with private choices'
);

select * from finish();
rollback;
