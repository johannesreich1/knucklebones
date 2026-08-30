begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(27);

-- A settlement can reach the player through a command response, Realtime, a
-- reconnect, or the abandoned-bot cleanup path. The progression fact is
-- therefore an owner-readable durable row, not optional response metadata.
select has_table(
  'public', 'ranked_progression_events',
  'ranked settlement has a durable per-player progression event'
);
select ok(
  (select count(*) = 18
          and count(*) filter (where column_name = 'id' and data_type = 'uuid'
                                and is_nullable = 'NO') = 1
          and count(*) filter (where column_name = 'player_id' and data_type = 'uuid'
                                and is_nullable = 'NO') = 1
          and count(*) filter (where column_name = 'source_match_id' and data_type = 'uuid'
                                and is_nullable = 'YES') = 1
          and count(*) filter (where column_name = 'season_id' and data_type = 'smallint'
                                and is_nullable = 'NO') = 1
          and count(*) filter (where column_name in ('points_before', 'points_after')
                                and data_type = 'integer' and is_nullable = 'NO') = 2
          and count(*) filter (where column_name in ('apex_before', 'apex_after')
                                and data_type = 'boolean' and is_nullable = 'NO') = 2
          and count(*) filter (where column_name in ('pool_tier_before', 'pool_tier_after')
                                and data_type = 'text' and is_nullable = 'NO') = 2
          and count(*) filter (where column_name in ('equipped_rune_before', 'equipped_rune_after')
                                and data_type = 'text' and is_nullable = 'YES') = 2
          and count(*) filter (where column_name in
                                ('random_rune_mode_before', 'random_rune_mode_after',
                                 'rune_seat_active_before', 'rune_seat_active_after')
                                and data_type = 'boolean' and is_nullable = 'NO') = 4
          and count(*) filter (where column_name = 'created_at'
                                and data_type = 'timestamp with time zone'
                                and is_nullable = 'NO') = 1
          and count(*) filter (where column_name = 'seen_at'
                                and data_type = 'timestamp with time zone'
                                and is_nullable = 'YES') = 1
     from information_schema.columns
    where table_schema = 'public' and table_name = 'ranked_progression_events'),
  'progression rows retain exact ladder, permanent-pool, and equipment snapshots'
);
select ok(
  coalesce((select class.relrowsecurity
              from pg_class class
             where class.oid = to_regclass('public.ranked_progression_events')), false)
  and (select count(*) = 1
         from pg_policies
        where schemaname = 'public'
          and tablename = 'ranked_progression_events'
          and roles = array['authenticated']::name[]
          and cmd = 'SELECT'
          and qual like '%player_id%auth.uid()%'),
  'one owner-only SELECT policy is the complete client row surface'
);
select ok(
  coalesce(has_table_privilege(
    'authenticated', to_regclass('public.ranked_progression_events'), 'select'
  ), false)
  and not coalesce(has_table_privilege(
    'authenticated', to_regclass('public.ranked_progression_events'), 'insert'
  ), false)
  and not coalesce(has_table_privilege(
    'authenticated', to_regclass('public.ranked_progression_events'), 'update'
  ), false)
  and not coalesce(has_table_privilege(
    'authenticated', to_regclass('public.ranked_progression_events'), 'delete'
  ), false)
  and not coalesce(has_table_privilege(
    'anon', to_regclass('public.ranked_progression_events'), 'select'
  ), false)
  and not coalesce(has_table_privilege(
    'service_role', to_regclass('public.ranked_progression_events'), 'select'
  ), false),
  'clients can only read their RLS-filtered events and anonymous/service roles have no table API'
);
select ok(
  to_regprocedure('public.acknowledge_ranked_progression(uuid)') is not null
  and coalesce(has_function_privilege(
    'authenticated', to_regprocedure('public.acknowledge_ranked_progression(uuid)'), 'execute'
  ), false)
  and not coalesce(has_function_privilege(
    'anon', to_regprocedure('public.acknowledge_ranked_progression(uuid)'), 'execute'
  ), false)
  and not coalesce(has_function_privilege(
    'service_role', to_regprocedure('public.acknowledge_ranked_progression(uuid)'), 'execute'
  ), false),
  'only an authenticated owner can acknowledge a progression event'
);

insert into auth.users (id, email, created_at, updated_at)
select
  format('9b000000-0000-0000-0000-%s', lpad(ordinal::text, 12, '0'))::uuid,
  format('ranked-progression-%s@example.invalid', ordinal),
  now(), now()
from generate_series(1, 6) ordinal;

update public.profiles
   set rating = case id
         when '9b000000-0000-0000-0000-000000000001' then 299
         when '9b000000-0000-0000-0000-000000000002' then 100
         when '9b000000-0000-0000-0000-000000000003' then 1260
         when '9b000000-0000-0000-0000-000000000004' then 1300
         when '9b000000-0000-0000-0000-000000000005' then 40
         else 30
       end,
       ranked_pool_tier = case id
         when '9b000000-0000-0000-0000-000000000003' then 'ivory'
         when '9b000000-0000-0000-0000-000000000004' then 'ivory'
         else 'stone'
       end,
       is_bot = id = '9b000000-0000-0000-0000-000000000006';

insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
values
  (1, '9b000000-0000-0000-0000-000000000001', 299, 299, 1, 0, 0),
  (1, '9b000000-0000-0000-0000-000000000002', 100, 100, 0, 1, 0),
  (1, '9b000000-0000-0000-0000-000000000003', 1260, 1500, 2, 1, 0),
  (1, '9b000000-0000-0000-0000-000000000004', 1300, 1500, 2, 1, 0),
  (1, '9b000000-0000-0000-0000-000000000005', 40, 40, 1, 1, 0),
  (1, '9b000000-0000-0000-0000-000000000006', 30, 30, 1, 1, 0);

insert into public.player_runes (player_id, rune_id, source_match_id)
values ('9b000000-0000-0000-0000-000000000003', 'ward', null);
update public.profiles
   set equipped_rune = 'ward', random_rune_mode = true
 where id = '9b000000-0000-0000-0000-000000000003';

insert into public.matches (id, p1, p2, status, turn, season_id)
values
  ('9c000000-0000-0000-0000-000000000001',
   '9b000000-0000-0000-0000-000000000001',
   '9b000000-0000-0000-0000-000000000002', 'active', 1, 1),
  ('9c000000-0000-0000-0000-000000000002',
   '9b000000-0000-0000-0000-000000000003',
   '9b000000-0000-0000-0000-000000000004', 'active', 1, 1),
  ('9c000000-0000-0000-0000-000000000003',
   '9b000000-0000-0000-0000-000000000005',
   '9b000000-0000-0000-0000-000000000006', 'active', 1, 1);

create temporary table promotion_result (payload jsonb);
grant insert, select on promotion_result to service_role;
set local role service_role;
insert into promotion_result (payload)
select public.settle_match(
  '9c000000-0000-0000-0000-000000000001',
  'done', '9b000000-0000-0000-0000-000000000001',
  18, 7, 1, 0,
  '{"points":299,"peak":299,"wins":1,"losses":0,"draws":0}',
  '{"points":100,"peak":100,"wins":0,"losses":1,"draws":0}',
  '{"points":300,"peak":300,"wins":2,"losses":0,"draws":0}',
  '{"points":100,"peak":100,"wins":0,"losses":2,"draws":0}'
);
reset role;

select is(
  (select (payload->>'applied')::boolean from promotion_result), true,
  'the BONE-boundary settlement is applied'
);
select is(
  (select count(*)::integer
     from public.ranked_progression_events
    where source_match_id = '9c000000-0000-0000-0000-000000000001'),
  2,
  'one durable progression event is written for each human participant'
);
select is(
  (select jsonb_build_object(
      'points', jsonb_build_array(points_before, points_after),
      'apex', jsonb_build_array(apex_before, apex_after),
      'pool', jsonb_build_array(pool_tier_before, pool_tier_after),
      'equipped', jsonb_build_array(equipped_rune_before, equipped_rune_after),
      'random', jsonb_build_array(random_rune_mode_before, random_rune_mode_after),
      'rune_live', jsonb_build_array(rune_seat_active_before, rune_seat_active_after)
    )
     from public.ranked_progression_events
    where source_match_id = '9c000000-0000-0000-0000-000000000001'
      and player_id = '9b000000-0000-0000-0000-000000000001'),
  '{"points":[299,300],"apex":[false,false],"pool":["stone","bone"],"equipped":[null,null],"random":[false,false],"rune_live":[false,false]}'::jsonb,
  '299 to 300 records the exact BONE pool upgrade without inventing rune state'
);
select is(
  (select ranked_pool_tier from public.profiles
    where id = '9b000000-0000-0000-0000-000000000001'),
  'bone',
  'the event agrees with the permanent pool written to the profile'
);

create temporary table duplicate_result as
select public.settle_match(
  '9c000000-0000-0000-0000-000000000001',
  'forfeit', '9b000000-0000-0000-0000-000000000002',
  0, 0, -99, 99, '{}', '{}', '{}', '{}'
) as payload;
select is(
  (select (payload->>'applied')::boolean from duplicate_result), false,
  'a duplicate terminal settlement remains an unapplied retry'
);
select is(
  (select count(*)::integer
     from public.ranked_progression_events
    where source_match_id = '9c000000-0000-0000-0000-000000000001'),
  2,
  'a duplicate settlement cannot duplicate either participant event'
);

create temporary table demotion_result (payload jsonb);
grant insert, select on demotion_result to service_role;
set local role service_role;
insert into demotion_result (payload)
select public.settle_match(
  '9c000000-0000-0000-0000-000000000002',
  'done', '9b000000-0000-0000-0000-000000000004',
  8, 16, -1, 1,
  '{"points":1260,"peak":1500,"wins":2,"losses":1,"draws":0}',
  '{"points":1300,"peak":1500,"wins":2,"losses":1,"draws":0}',
  '{"points":1259,"peak":1500,"wins":2,"losses":2,"draws":0}',
  '{"points":1301,"peak":1500,"wins":3,"losses":1,"draws":0}'
);
reset role;

select is(
  (select (payload->>'applied')::boolean from demotion_result), true,
  'the SILVER to IVORY settlement is applied'
);
select is(
  (select jsonb_build_object(
      'points', jsonb_build_array(points_before, points_after),
      'apex', jsonb_build_array(apex_before, apex_after),
      'pool', jsonb_build_array(pool_tier_before, pool_tier_after),
      'equipped', jsonb_build_array(equipped_rune_before, equipped_rune_after),
      'random', jsonb_build_array(random_rune_mode_before, random_rune_mode_after),
      'rune_live', jsonb_build_array(rune_seat_active_before, rune_seat_active_after)
    )
     from public.ranked_progression_events
    where source_match_id = '9c000000-0000-0000-0000-000000000002'
      and player_id = '9b000000-0000-0000-0000-000000000003'),
  '{"points":[1260,1259],"apex":[false,false],"pool":["ivory","ivory"],"equipped":["ward","ward"],"random":[true,true],"rune_live":[true,false]}'::jsonb,
  'SILVER demotion rests the equipped fallback while retaining RANDOM and permanent IVORY access'
);
select is(
  (select concat(ranked_pool_tier, '/', equipped_rune, '/', random_rune_mode)
     from public.profiles
    where id = '9b000000-0000-0000-0000-000000000003'),
  'ivory/ward/t',
  'settlement does not erase permanent access or the player equipment choice'
);

select throws_ok(
  $$select public.settle_match(
    '9c000000-0000-0000-0000-000000000003',
    'done', '9b000000-0000-0000-0000-000000000005',
    12, 4, 1, 0,
    '{"points":999,"peak":999,"wins":0,"losses":0,"draws":0}',
    '{"points":30,"peak":30,"wins":1,"losses":1,"draws":0}',
    '{"points":41,"peak":41,"wins":2,"losses":1,"draws":0}',
    '{"points":30,"peak":30,"wins":1,"losses":2,"draws":0}'
  )$$,
  '40001',
  'ladder changed while match 9c000000-0000-0000-0000-000000000003 was settling',
  'a stale authoritative snapshot refuses settlement'
);
select is(
  (select concat(
    (select status from public.matches
      where id = '9c000000-0000-0000-0000-000000000003'), '/',
    (select count(*) from public.ranked_progression_events
      where source_match_id = '9c000000-0000-0000-0000-000000000003')
  )),
  'active/0',
  'a refused settlement leaves no progression event behind'
);

create temporary table bot_match_result (payload jsonb);
grant insert, select on bot_match_result to service_role;
set local role service_role;
insert into bot_match_result (payload)
select public.settle_match(
  '9c000000-0000-0000-0000-000000000003',
  'done', '9b000000-0000-0000-0000-000000000005',
  12, 4, 1, 0,
  '{"points":40,"peak":40,"wins":1,"losses":1,"draws":0}',
  '{"points":30,"peak":30,"wins":1,"losses":1,"draws":0}',
  '{"points":41,"peak":41,"wins":2,"losses":1,"draws":0}',
  '{"points":30,"peak":30,"wins":1,"losses":2,"draws":0}'
);
reset role;

select is(
  (select (payload->>'applied')::boolean from bot_match_result), true,
  'the correctly retried human-versus-bot settlement is applied'
);
select is(
  (select string_agg(player_id::text, ',' order by player_id)
     from public.ranked_progression_events
    where source_match_id = '9c000000-0000-0000-0000-000000000003'),
  '9b000000-0000-0000-0000-000000000005',
  'settlement writes the human event and excludes the bot participant'
);

-- NEON is positional once 100 humans have played, so points alone cannot
-- reconstruct entry or exit. Add exactly 95 humans to the five human fixtures;
-- the settled bot remains excluded from both the population and event stream.
insert into auth.users (id, email, created_at, updated_at)
select
  format('9d000000-0000-0000-0000-%s', lpad(ordinal::text, 12, '0'))::uuid,
  format('ranked-progression-population-%s@example.invalid', ordinal),
  now(), now()
from generate_series(1, 95) ordinal;

update public.profiles profile
   set rating = population.points,
       ranked_pool_tier = 'ivory'
  from (
    select
      format('9d000000-0000-0000-0000-%s', lpad(ordinal::text, 12, '0'))::uuid as id,
      2000 + ordinal * 10 as points
    from generate_series(1, 95) ordinal
  ) population
 where profile.id = population.id;

insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
select
  1,
  format('9d000000-0000-0000-0000-%s', lpad(ordinal::text, 12, '0'))::uuid,
  2000 + ordinal * 10,
  2000 + ordinal * 10,
  1, 0, 0
from generate_series(1, 95) ordinal;

insert into public.matches (id, p1, p2, status, turn, season_id)
values (
  '9c000000-0000-0000-0000-000000000004',
  '9b000000-0000-0000-0000-000000000001',
  '9b000000-0000-0000-0000-000000000002', 'active', 1, 1
);

create temporary table neon_entry_result (payload jsonb);
grant insert, select on neon_entry_result to service_role;
set local role service_role;
insert into neon_entry_result (payload)
select public.settle_match(
  '9c000000-0000-0000-0000-000000000004',
  'done', '9b000000-0000-0000-0000-000000000001',
  18, 4, 5700, 0,
  '{"points":300,"peak":300,"wins":2,"losses":0,"draws":0}',
  '{"points":100,"peak":100,"wins":0,"losses":2,"draws":0}',
  '{"points":6000,"peak":6000,"wins":3,"losses":0,"draws":0}',
  '{"points":100,"peak":100,"wins":0,"losses":3,"draws":0}'
);
reset role;

select is(
  (select (payload->>'applied')::boolean from neon_entry_result), true,
  'the positional NEON-entry settlement is applied'
);
select is(
  (select jsonb_build_object(
      'points', jsonb_build_array(points_before, points_after),
      'apex', jsonb_build_array(apex_before, apex_after),
      'pool', jsonb_build_array(pool_tier_before, pool_tier_after),
      'rune_live', jsonb_build_array(rune_seat_active_before, rune_seat_active_after)
    )
     from public.ranked_progression_events
    where source_match_id = '9c000000-0000-0000-0000-000000000004'
      and player_id = '9b000000-0000-0000-0000-000000000001'),
  '{"points":[300,6000],"apex":[false,true],"pool":["bone","ivory"],"rune_live":[false,false]}'::jsonb,
  'NEON entry snapshots the exact top-one-percent crossing and does not activate an empty rune seat'
);

insert into public.matches (id, p1, p2, status, turn, season_id)
values (
  '9c000000-0000-0000-0000-000000000005',
  '9b000000-0000-0000-0000-000000000001',
  '9b000000-0000-0000-0000-000000000002', 'active', 1, 1
);

create temporary table neon_exit_result (payload jsonb);
grant insert, select on neon_exit_result to service_role;
set local role service_role;
insert into neon_exit_result (payload)
select public.settle_match(
  '9c000000-0000-0000-0000-000000000005',
  'done', '9b000000-0000-0000-0000-000000000002',
  4, 18, -3500, 1,
  '{"points":6000,"peak":6000,"wins":3,"losses":0,"draws":0}',
  '{"points":100,"peak":100,"wins":0,"losses":3,"draws":0}',
  '{"points":2500,"peak":6000,"wins":3,"losses":1,"draws":0}',
  '{"points":101,"peak":101,"wins":1,"losses":3,"draws":0}'
);
reset role;

select is(
  (select (payload->>'applied')::boolean from neon_exit_result), true,
  'the positional NEON-exit settlement is applied'
);
select is(
  (select jsonb_build_object(
      'points', jsonb_build_array(points_before, points_after),
      'apex', jsonb_build_array(apex_before, apex_after),
      'pool', jsonb_build_array(pool_tier_before, pool_tier_after),
      'rune_live', jsonb_build_array(rune_seat_active_before, rune_seat_active_after)
    )
     from public.ranked_progression_events
    where source_match_id = '9c000000-0000-0000-0000-000000000005'
      and player_id = '9b000000-0000-0000-0000-000000000001'),
  '{"points":[6000,2500],"apex":[true,false],"pool":["ivory","ivory"],"rune_live":[false,false]}'::jsonb,
  'NEON exit retains permanent IVORY access while recording the exact positional loss'
);

create temporary table owner_progression_event as
select id as event_id
  from public.ranked_progression_events
 where source_match_id = '9c000000-0000-0000-0000-000000000001'
   and player_id = '9b000000-0000-0000-0000-000000000001';
grant select on owner_progression_event to authenticated;

select set_config(
  'request.jwt.claim.sub', '9b000000-0000-0000-0000-000000000001', true
);
set local role authenticated;
select is(
  (select count(*)::integer
     from public.ranked_progression_events
    where source_match_id = '9c000000-0000-0000-0000-000000000001'),
  1,
  'RLS reveals the caller own event'
);
select is(
  (select count(*)::integer
     from public.ranked_progression_events
    where source_match_id = '9c000000-0000-0000-0000-000000000001'
      and player_id = '9b000000-0000-0000-0000-000000000002'),
  0,
  'RLS hides the opponent event from the other match participant'
);
reset role;

select set_config(
  'request.jwt.claim.sub', '9b000000-0000-0000-0000-000000000002', true
);
set local role authenticated;
select is(
  public.acknowledge_ranked_progression(
    (select event_id from pg_temp.owner_progression_event)
  ),
  false,
  'an opponent cannot acknowledge the owner progression event'
);
reset role;

select set_config(
  'request.jwt.claim.sub', '9b000000-0000-0000-0000-000000000001', true
);
set local role authenticated;
select is(
  public.acknowledge_ranked_progression(
    (select event_id from pg_temp.owner_progression_event)
  ),
  true,
  'the owner can acknowledge the progression event after presentation'
);
reset role;
select ok(
  (select seen_at is not null
     from public.ranked_progression_events
    where id = (select event_id from pg_temp.owner_progression_event)),
  'owner acknowledgement durably stamps the event as seen'
);

select * from finish();
rollback;
