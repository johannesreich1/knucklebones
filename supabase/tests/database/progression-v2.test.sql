begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(64);

select has_table('private', 'ranked_runtime_contract',
  'ranked numeric authority is a private singleton');
select results_eq(
  $$select curve_version, scoring_version, admission_paused
      from private.ranked_runtime_contract where singleton$$,
  $$values (1::smallint, 1::smallint, false)$$,
  'the forward migration leaves the deployed v1 runtime active and open'
);
select has_table('public', 'player_ranked_outcomes',
  'per-outcome entitlements are durable rows');
select has_table('private', 'ranked_bot_debuts',
  'bot teaching promises are private durable rows');
select has_table('public', 'ranked_weekly_completions',
  'weekly wins have an idempotent durable completion key');
select has_table('public', 'player_neon_medals',
  'NEON recognition persists by player and season');
select is(private.map_ranked_points_v1_to_v2(300), 360,
  'BONE floor maps exactly');
select is(private.map_ranked_points_v1_to_v2(720), 840,
  'IVORY floor maps exactly');
select is(private.map_ranked_points_v1_to_v2(1260), 1490,
  'SILVER floor maps exactly');
select is(private.map_ranked_points_v1_to_v2(2010), 2490,
  'GOLD floor maps exactly');
select is(private.map_ranked_points_v1_to_v2(3000), 3890,
  'OBSIDIAN floor maps exactly');
select is(private.map_ranked_points_v1_to_v2(4350), 6090,
  'the historical small-population fallback maps exactly');
select ok(
  has_function_privilege('anon', 'public.active_ranked_curve_version()', 'execute')
  and has_function_privilege('authenticated', 'public.active_ranked_curve_version()', 'execute')
  and not has_function_privilege('anon', 'public.ranked_runtime_contract()', 'execute')
  and has_function_privilege('service_role', 'public.ranked_runtime_contract()', 'execute'),
  'public ladder sees only the curve scalar while runtime controls stay service-only'
);

insert into auth.users (id, email, created_at, updated_at)
values (
  '9d000000-0000-0000-0000-000000000001',
  'progression-v2-profile@example.invalid', now(), now()
);
select is(
  (select string_agg(outcome_id, ',' order by outcome_id)
     from public.player_ranked_outcomes
    where player_id = '9d000000-0000-0000-0000-000000000001'),
  'classic,colshield,limited,singlestrike',
  'a profile created while v1 is active receives only the shipped STONE promise'
);
insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
values (
  1, '9d000000-0000-0000-0000-000000000001', 5000, 5000, 1, 0, 0
);
select is(
  (select apex from private.ladder_board(1::smallint)
    where player = '9d000000-0000-0000-0000-000000000001'),
  true,
  'the v1 small-population ladder treats 5,000 points as apex'
);

select results_eq(
  $$select private.ranked_weekly_modifier_for_start(
       timestamptz '2026-08-31 00:00:00+00' + week * interval '7 days'
     )
      from generate_series(0, 7) week$$,
  $$values ('classic'::text), ('singlestrike'::text), ('colshield'::text),
           ('bounty'::text), ('rowmult'::text), ('rowswitch'::text),
           ('limited'::text), ('classic'::text)$$,
  'weekly modifiers follow the canonical seven-mode sequence forever'
);
select lives_ok(
  $$select private.ensure_current_ranked_weekly_rotation()$$,
  'the current UTC Monday rotation is created lazily'
);
select lives_ok(
  $$select private.ensure_current_ranked_weekly_rotation()$$,
  'ensuring the same weekly rotation is idempotent'
);
select is(
  (select count(*) from public.ranked_weekly_rotations rotation
    where rotation.starts_at <= clock_timestamp()
      and rotation.ends_at > clock_timestamp()),
  1::bigint,
  'exactly one persisted rotation is shared for the current week'
);

-- Curve activation is a deliberately owner-only, fail-closed cutover. Its
-- two counts are an operator acknowledgement of the exact rows about to move;
-- the function also owns the drain check and remains paused after success.
select ok(
  to_regprocedure('private.activate_progression_v2(bigint,bigint)') is not null
  and coalesce(has_function_privilege(
    'postgres', to_regprocedure('private.activate_progression_v2(bigint,bigint)'), 'execute'
  ), false)
  and not coalesce(has_function_privilege(
    'anon', to_regprocedure('private.activate_progression_v2(bigint,bigint)'), 'execute'
  ), false)
  and not coalesce(has_function_privilege(
    'authenticated', to_regprocedure('private.activate_progression_v2(bigint,bigint)'), 'execute'
  ), false)
  and not coalesce(has_function_privilege(
    'service_role', to_regprocedure('private.activate_progression_v2(bigint,bigint)'), 'execute'
  ), false),
  'only postgres can execute the guarded progression-v2 cutover'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('9e000000-0000-0000-0000-000000000001',
   'progression-v2-cutover-a@example.invalid', now(), now()),
  ('9e000000-0000-0000-0000-000000000002',
   'progression-v2-cutover-b@example.invalid', now(), now());

update public.profiles
   set rating = case id
     when '9e000000-0000-0000-0000-000000000001' then 300
     else 2010
   end
 where id in (
   '9e000000-0000-0000-0000-000000000001',
   '9e000000-0000-0000-0000-000000000002'
 );

insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
values
  (0, '9e000000-0000-0000-0000-000000000001', 100, 720, 1, 0, 0),
  (1, '9e000000-0000-0000-0000-000000000001', 300, 1260, 2, 1, 0),
  (1, '9e000000-0000-0000-0000-000000000002', 720, 3000, 3, 1, 0);

-- Durable v1 pool authority survives even when old season evidence has been
-- pruned. These two profiles deliberately have no season rows or numeric peak.
insert into auth.users (id, email, created_at, updated_at)
values
  ('9c000000-0000-0000-0000-000000000001',
   'progression-v2-legacy-bone@example.invalid', now(), now()),
  ('9c000000-0000-0000-0000-000000000002',
   'progression-v2-legacy-ivory@example.invalid', now(), now()),
  ('9b000000-0000-0000-0000-000000000001',
   'progression-v2-equipment-authority@example.invalid', now(), now());
update public.profiles
   set rating = 0,
       ranked_pool_tier = case id
         when '9c000000-0000-0000-0000-000000000001' then 'bone'
         when '9c000000-0000-0000-0000-000000000002' then 'ivory'
         else 'stone'
       end
 where id in (
   '9c000000-0000-0000-0000-000000000001',
   '9c000000-0000-0000-0000-000000000002',
   '9b000000-0000-0000-0000-000000000001'
 );

-- Equipment snapshots follow the explicit durable feature, not a mutable
-- rating or the mere presence of an owned/equipped rune.
insert into public.player_runes (player_id, rune_id)
values ('9b000000-0000-0000-0000-000000000001', 'fate');
update public.profiles set equipped_rune = 'fate'
 where id = '9b000000-0000-0000-0000-000000000001';
select is(
  private.progression_v2_equipped_rune_for_match(
    '9b000000-0000-0000-0000-000000000001', 'feature-absent'
  ),
  null::text,
  'v2 equipment helper denies an equipped rune without explicit feature authority'
);
insert into public.player_ranked_features (player_id, feature_id, grant_source)
values (
  '9b000000-0000-0000-0000-000000000001',
  'equipped_runes', 'legacy_peak'
);
select is(
  private.progression_v2_equipped_rune_for_match(
    '9b000000-0000-0000-0000-000000000001', 'feature-present'
  ),
  'fate',
  'v2 equipment helper permits the same low-points rune after the feature grant'
);

select throws_ok(
  $$insert into public.matches (
      id, p1, p2, status, turn, season_id,
      p1_rating_delta, p2_rating_delta,
      p1_base_rating_delta, p2_base_rating_delta,
      p1_finish_rating_delta, p2_finish_rating_delta
    ) values (
      '9e200000-0000-0000-0000-000000000001',
      '9e000000-0000-0000-0000-000000000001',
      '9e000000-0000-0000-0000-000000000002',
      'done', 1, 1, 5, -5, 5, -5, 0, null
    )$$,
  '23514', null,
  'rating component CHECK rejects partial non-null settlement evidence'
);

insert into public.matches (id, p1, p2, status, turn, season_id)
values (
  '9e300000-0000-0000-0000-000000000001',
  '9e000000-0000-0000-0000-000000000001',
  '9e000000-0000-0000-0000-000000000002',
  'done', 1, 1
);
insert into private.ranked_bot_debuts (
  player_id, outcome_id, teaching_order,
  source_match_id, started_match_id, status, completed_at
) values (
  '9e000000-0000-0000-0000-000000000001',
  'rowmult', 1,
  '9e300000-0000-0000-0000-000000000001',
  '9e300000-0000-0000-0000-000000000001',
  'completed', clock_timestamp()
);
delete from public.matches where id = '9e300000-0000-0000-0000-000000000001';
select is(
  (select jsonb_build_array(
      status, source_match_id is null, started_match_id is null,
      completed_at is not null
    )
     from private.ranked_bot_debuts
    where player_id = '9e000000-0000-0000-0000-000000000001'
      and outcome_id = 'rowmult'),
  '["completed",true,true,true]'::jsonb,
  'deleting a debut match preserves completed history with nullable match links'
);
delete from private.ranked_bot_debuts
 where player_id = '9e000000-0000-0000-0000-000000000001'
   and outcome_id = 'rowmult';

-- Build a >=100-human current board. At 301 points the target is below every
-- numeric apex fallback, but it is the unique top one-percent member.
insert into auth.users (id, email, created_at, updated_at)
select ('9a100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       format('progression-v2-apex-%s@example.invalid', n), now(), now()
  from generate_series(1, 100) n;
update public.profiles set rating = 0
 where id in (
   select ('9a100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
     from generate_series(1, 100) n
 );
update public.season_ratings rating
   set points = least(rating.points, 300)
  from public.profiles profile
 where rating.season_id = 1
   and rating.player = profile.id
   and not profile.is_bot;
insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
select 1,
       ('9a100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       case when n = 1 then 301 else 0 end,
       case when n = 1 then 301 else 0 end,
       1, 0, 0
  from generate_series(1, 100) n;
select ok(
  (select count(*) >= 100 from private.ladder_board(1::smallint))
  and coalesce((select apex and points = 301
      from private.ladder_board(1::smallint)
     where player = '9a100000-0000-0000-0000-000000000001'), false),
  'a low-points leader is positional apex on a board of at least 100 humans'
);

create temporary table progression_v2_expected_profiles as
select id, private.map_ranked_points_v1_to_v2(rating) as rating
  from public.profiles;
create temporary table progression_v2_expected_season_rows as
select season_id, player,
       private.map_ranked_points_v1_to_v2(points) as points,
       private.map_ranked_points_v1_to_v2(peak) as peak
  from public.season_ratings;

select throws_ok(
  $$select private.activate_progression_v2(
      (select count(*) from public.profiles),
      (select count(*) from public.season_ratings)
    )$$,
  'P0001', null,
  'activation refuses to map while ranked admission remains open'
);

update private.ranked_runtime_contract
   set admission_paused = true, updated_at = clock_timestamp()
 where singleton;

select throws_ok(
  $$select private.activate_progression_v2(
      (select count(*) + 1 from public.profiles),
      (select count(*) from public.season_ratings)
    )$$,
  '40001', null,
  'activation rejects a stale expected profile count'
);
select throws_ok(
  $$select private.activate_progression_v2(
      (select count(*) from public.profiles),
      (select count(*) + 1 from public.season_ratings)
    )$$,
  '40001', null,
  'activation rejects a stale expected season-row count'
);

update private.ranked_runtime_contract
   set admission_paused = false, updated_at = clock_timestamp()
 where singleton;
insert into public.matchmaking_queue (player_id)
values ('9e000000-0000-0000-0000-000000000001');
update private.ranked_runtime_contract
   set admission_paused = true, updated_at = clock_timestamp()
 where singleton;
select throws_ok(
  $$select private.activate_progression_v2(
      (select count(*) from public.profiles),
      (select count(*) from public.season_ratings)
    )$$,
  'P0001', null,
  'activation refuses to cross the curve while a queue row remains'
);
delete from public.matchmaking_queue
 where player_id = '9e000000-0000-0000-0000-000000000001';

update private.ranked_runtime_contract
   set admission_paused = false, updated_at = clock_timestamp()
 where singleton;
insert into public.matches (id, p1, p2, status, turn, season_id)
values (
  '9e100000-0000-0000-0000-000000000001',
  '9e000000-0000-0000-0000-000000000001',
  '9e000000-0000-0000-0000-000000000002',
  'active', 1, 1
);
update private.ranked_runtime_contract
   set admission_paused = true, updated_at = clock_timestamp()
 where singleton;
select throws_ok(
  $$select private.activate_progression_v2(
      (select count(*) from public.profiles),
      (select count(*) from public.season_ratings)
    )$$,
  'P0001', null,
  'activation refuses to cross the curve while an active match remains'
);
delete from public.matches where id = '9e100000-0000-0000-0000-000000000001';

create temporary table progression_v2_activation_result (payload jsonb);
select lives_ok(
  $$insert into progression_v2_activation_result (payload)
    select private.activate_progression_v2(
      (select count(*) from public.profiles),
      (select count(*) from public.season_ratings)
    )$$,
  'a paused, exactly counted, fully drained ladder activates atomically'
);
select ok(
  (select curve_version = 2
      and scoring_version = 2
      and admission_paused
      and activated_at is not null
     from private.ranked_runtime_contract where singleton),
  'activation flips both authorities to v2 and deliberately stays paused'
);
select is(
  (select count(*) from private.ranked_curve_v2_cutover),
  (select count(*) from public.profiles),
  'activation records exactly one cutover fact for every profile'
);

/* THE QUEUE MUST ACTUALLY OPEN ON v2. Nothing here exercised an enqueue after
   the curve flipped, and that gap shipped a total ranked outage on 2026-09-04:
   private.guard_ranked_admission() fires BEFORE INSERT on matchmaking_queue,
   public.enqueue_ranked_player() inserts player_id ONLY, and the resulting row
   carries the column defaults protocol_version = 1 and capabilities = '{}'.
   The guard's client check read those defaults and raised on EVERY player,
   compatible clients included, because the UPDATE in enqueue_ranked_player_v3
   that writes the real values runs one statement after the INSERT it aborted.
   The three checks below are the ones that would have caught it: a good client
   gets in, the row it leaves behind is the client's own, and the two paths that
   must still be refused still are. */
update private.ranked_runtime_contract
   set admission_paused = false, updated_at = clock_timestamp()
 where singleton;
select lives_ok(
  $$select public.enqueue_ranked_player_v3(
      '9e000000-0000-0000-0000-000000000001'::uuid, 2::smallint,
      array['rune_trial_v1','equipped_rune_v1','curve_v2','rune_trial_claim_v2']::text[],
      'ordinary'
    )$$,
  'a curve-v2 client can enter the queue once the curve is active'
);
select results_eq(
  $$select protocol_version, curve_version, 'curve_v2' = any(capabilities)
      from public.matchmaking_queue
     where player_id = '9e000000-0000-0000-0000-000000000001'$$,
  $$values (2::smallint, 2::smallint, true)$$,
  'the queued row carries the client''s own protocol, curve and capabilities'
);
delete from public.matchmaking_queue
 where player_id = '9e000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.enqueue_ranked_player_v3(
      '9e000000-0000-0000-0000-000000000001'::uuid, 1::smallint,
      array[]::text[], 'ordinary'
    )$$,
  'P0001', null,
  'a pre-v2 client is still refused, by the RPC and not by a default-valued row'
);
/* set_config(..., true) is TRANSACTION-local, and pgTAP runs this whole file in
   one transaction, so the flag enqueue_ranked_player_v3 set above is still up.
   Production cannot see that -- every PostgREST call is its own transaction --
   but this file can, and an unvouched write is the thing being asserted, so the
   flag has to come down first or the check proves nothing. */
select is(
  set_config('knucklebones.progression_v2_queue', '', true), '',
  'the transition flag can be lowered inside the test transaction'
);
select throws_ok(
  $$insert into public.matchmaking_queue (player_id)
    values ('9e000000-0000-0000-0000-000000000002')$$,
  'P0001', null,
  'a direct queue write that sets no client facts is still refused by the guard'
);
update private.ranked_runtime_contract
   set admission_paused = true, updated_at = clock_timestamp()
 where singleton;
select results_eq(
  $$select id, rating from public.profiles order by id$$,
  $$select id, rating from progression_v2_expected_profiles order by id$$,
  'activation maps every profile rating captured by the exact-count cutover'
);
select results_eq(
  $$select season_id, player, points, peak
      from public.season_ratings order by season_id, player$$,
  $$select season_id, player, points, peak
      from progression_v2_expected_season_rows order by season_id, player$$,
  'activation maps points and peak on every captured season row'
);
select is(
  (select jsonb_agg(
      jsonb_build_array(player_id::text, old_historical_peak, mapped_historical_peak)
      order by player_id
    )
     from private.ranked_curve_v2_cutover
    where player_id in (
      '9e000000-0000-0000-0000-000000000001',
      '9e000000-0000-0000-0000-000000000002'
    )),
  '[["9e000000-0000-0000-0000-000000000001",1260,1490],
    ["9e000000-0000-0000-0000-000000000002",3000,3890]]'::jsonb,
  'cutover rows preserve each old historical peak and its exact mapped peak'
);
select is(
  (select jsonb_agg(jsonb_build_array(id::text, rating) order by id)
     from public.profiles
    where id in (
      '9e000000-0000-0000-0000-000000000001',
      '9e000000-0000-0000-0000-000000000002'
    )),
  '[["9e000000-0000-0000-0000-000000000001",360],
    ["9e000000-0000-0000-0000-000000000002",2490]]'::jsonb,
  'activation maps every profile rating through the one curve function'
);
select is(
  (select jsonb_agg(
      jsonb_build_array(player::text, season_id, points, peak)
      order by player, season_id
    )
     from public.season_ratings
    where player in (
      '9e000000-0000-0000-0000-000000000001',
      '9e000000-0000-0000-0000-000000000002'
    )),
  '[["9e000000-0000-0000-0000-000000000001",0,120,840],
    ["9e000000-0000-0000-0000-000000000001",1,360,1490],
    ["9e000000-0000-0000-0000-000000000002",1,360,3890]]'::jsonb,
  'activation maps points and peak on every season row without collapsing history'
);
select is(
  (select string_agg(outcome_id, ',' order by outcome_id)
     from public.player_ranked_outcomes
    where player_id = '9e000000-0000-0000-0000-000000000001'),
  'bounty,classic,colshield,limited,rowmult,rowswitch,rune_trial,singlestrike',
  'cutover entitlements union the legacy promise with the target v2 schedule'
);
select is(
  (select jsonb_agg(jsonb_build_array(player_id::text, feature_id)
                    order by player_id, feature_id)
     from public.player_ranked_features
    where player_id in (
      '9e000000-0000-0000-0000-000000000001',
      '9e000000-0000-0000-0000-000000000002'
    )),
  '[["9e000000-0000-0000-0000-000000000001","equipped_runes"],
    ["9e000000-0000-0000-0000-000000000002","equipped_runes"],
    ["9e000000-0000-0000-0000-000000000002","weekly_challenge"]]'::jsonb,
  'cutover fills permanent equipment and weekly feature milestones'
);

select is(
  (select jsonb_object_agg(
      profile.id::text,
      (select string_agg(outcome.outcome_id, ',' order by outcome.outcome_id)
         from public.player_ranked_outcomes outcome
        where outcome.player_id = profile.id)
    )
     from public.profiles profile
    where profile.id in (
      '9c000000-0000-0000-0000-000000000001',
      '9c000000-0000-0000-0000-000000000002'
    )),
  '{
    "9c000000-0000-0000-0000-000000000001":
      "bounty,classic,colshield,limited,rowmult,rowswitch,singlestrike",
    "9c000000-0000-0000-0000-000000000002":
      "bounty,classic,colshield,limited,rowmult,rowswitch,rune_trial,singlestrike"
  }'::jsonb,
  'activation preserves Bone and Ivory legacy promises without season evidence'
);
select is(
  (select jsonb_build_object(
      'captured', (select was_current_apex
          and old_historical_peak = 301
          and mapped_historical_peak = private.map_ranked_points_v1_to_v2(301)
          and apex_season_id = 1
        from private.ranked_curve_v2_cutover
       where player_id = '9a100000-0000-0000-0000-000000000001'),
      'outcomes', (select count(*) from public.player_ranked_outcomes
        where player_id = '9a100000-0000-0000-0000-000000000001'),
      'features', (select count(*) from public.player_ranked_features
        where player_id = '9a100000-0000-0000-0000-000000000001'),
      'tier', (select ranked_pool_tier from public.profiles
        where id = '9a100000-0000-0000-0000-000000000001'),
      'medals', (select count(*) from public.player_neon_medals
        where player_id = '9a100000-0000-0000-0000-000000000001'
          and season_id = 1),
      'events', (select count(*) from public.ranked_progression_events
        where player_id = '9a100000-0000-0000-0000-000000000001'),
      'debuts', (select count(*) from private.ranked_bot_debuts
        where player_id = '9a100000-0000-0000-0000-000000000001'),
      'returned_medals', (select (payload->>'neon_medals_added')::bigint
        from progression_v2_activation_result)
    )),
  '{"captured":true,"outcomes":8,"features":2,"tier":"ivory",
    "medals":1,"events":0,"debuts":0,"returned_medals":1}'::jsonb,
  'activation catches up positional apex authority without event or debut noise'
);

create temporary table progression_v2_minted_bot (player_id uuid);
grant insert, select on progression_v2_minted_bot to service_role;
set local role service_role;
insert into progression_v2_minted_bot (player_id)
select public.mint_bot(4000);
reset role;
select is(
  (select jsonb_build_object(
      'profile', (select jsonb_build_array(profile.is_bot, profile.rating,
                                           profile.ranked_pool_tier)
        from public.profiles profile where profile.id = minted.player_id),
      'outcomes', (select count(*) from public.player_ranked_outcomes outcome
        where outcome.player_id = minted.player_id),
      'features', (select count(*) from public.player_ranked_features feature
        where feature.player_id = minted.player_id),
      'debuts', (select count(*) from private.ranked_bot_debuts debut
        where debut.player_id = minted.player_id),
      'events', (select count(*) from public.ranked_progression_events event
        where event.player_id = minted.player_id),
      'medals', (select count(*) from public.player_neon_medals medal
        where medal.player_id = minted.player_id)
    )
     from progression_v2_minted_bot minted),
  '{"profile":[true,4000,"ivory"],"outcomes":8,"features":2,
    "debuts":0,"events":0,"medals":0}'::jsonb,
  'a service-role v2 bot mint receives exact rating authority without human noise'
);
delete from public.profiles
 where id = (select player_id from progression_v2_minted_bot);

-- Settlement must use apex-before OR apex-after. This player is unique rank 1
-- at 362, then loses below the mapped activation leader at 361.
insert into auth.users (id, email, created_at, updated_at)
values
  ('9a200000-0000-0000-0000-000000000001',
   'progression-v2-apex-loss@example.invalid', now(), now()),
  ('9a200000-0000-0000-0000-000000000002',
   'progression-v2-apex-loss-opponent@example.invalid', now(), now());
update public.profiles
   set rating = case id
     when '9a200000-0000-0000-0000-000000000001' then 362
     else 0
   end
 where id in (
   '9a200000-0000-0000-0000-000000000001',
   '9a200000-0000-0000-0000-000000000002'
 );
insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
values
  (1, '9a200000-0000-0000-0000-000000000001', 362, 362, 1, 0, 0),
  (1, '9a200000-0000-0000-0000-000000000002', 0, 0, 1, 0, 0);
update private.ranked_runtime_contract
   set admission_paused = false, updated_at = clock_timestamp()
 where singleton;
select set_config('knucklebones.progression_v2_start', '1', true);
insert into public.matches (
  id, p1, p2, status, turn, season_id, modifier, format,
  protocol_version, curve_version, scoring_version, outcome_roster
) values (
  '9a300000-0000-0000-0000-000000000001',
  '9a200000-0000-0000-0000-000000000001',
  '9a200000-0000-0000-0000-000000000002',
  'active', 1, 1, 'classic', 'standard', 2, 2, 2,
  array['classic','singlestrike','colshield','bounty']::text[]
);
create temporary table progression_v2_apex_loss_result as
select public.settle_match(
  '9a300000-0000-0000-0000-000000000001',
  'done', '9a200000-0000-0000-0000-000000000002',
  10, 18, -20, 20,
  '{"points":362,"peak":362,"wins":1,"losses":0,"draws":0}',
  '{"points":0,"peak":0,"wins":1,"losses":0,"draws":0}',
  '{"points":342,"peak":362,"wins":1,"losses":1,"draws":0,
    "_scoring_version":2,"_base_rating_delta":-20,"_finish_rating_delta":0}',
  '{"points":20,"peak":20,"wins":2,"losses":0,"draws":0,
    "_scoring_version":2,"_base_rating_delta":20,"_finish_rating_delta":0}'
) as payload;
select is(
  (select jsonb_build_object(
      'applied', (select (payload->>'applied')::boolean
        from progression_v2_apex_loss_result),
      'apex_before', event.apex_before,
      'apex_after', event.apex_after,
      'grants', to_jsonb(event.outcome_grants),
      'medal_event', event.neon_medal_granted,
      'outcomes', (select count(*) from public.player_ranked_outcomes
        where player_id = event.player_id),
      'features', (select count(*) from public.player_ranked_features
        where player_id = event.player_id),
      'tier', (select ranked_pool_tier from public.profiles
        where id = event.player_id),
      'medals', (select count(*) from public.player_neon_medals
        where player_id = event.player_id and season_id = 1)
    )
     from public.ranked_progression_events event
    where event.source_match_id = '9a300000-0000-0000-0000-000000000001'
      and event.player_id = '9a200000-0000-0000-0000-000000000001'),
  '{"applied":true,"apex_before":true,"apex_after":false,
    "grants":["rowmult","rune_trial","rowswitch","limited"],
    "medal_event":true,"outcomes":8,"features":2,"tier":"ivory","medals":1}'::jsonb,
  'a true-to-false apex loss still records and grants full v2 catch-up'
);

delete from public.profiles where id in (
  '9a200000-0000-0000-0000-000000000001',
  '9a200000-0000-0000-0000-000000000002'
);
delete from public.profiles where id in (
  select ('9a100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
    from generate_series(1, 100) n
);

update public.season_ratings set points = 5000
 where season_id = 1
   and player = '9d000000-0000-0000-0000-000000000001';
select is(
  (select apex from private.ladder_board(1::smallint)
    where player = '9d000000-0000-0000-0000-000000000001'),
  false,
  'the same 5,000 points are below the v2 small-population fallback'
);
update public.season_ratings set points = 6090
 where season_id = 1
   and player = '9d000000-0000-0000-0000-000000000001';
select is(
  (select apex from private.ladder_board(1::smallint)
    where player = '9d000000-0000-0000-0000-000000000001'),
  true,
  'the v2 small-population ladder recognizes its 6,090-point fallback'
);

-- A direct v2 weekly fixture isolates settlement from admission/start logic.
-- The Edge-owned component metadata rides inside the existing next-row JSON;
-- SQL persists it atomically with the ladder, weekly completion, and grants.
update private.ranked_runtime_contract
   set admission_paused = false, updated_at = clock_timestamp()
 where singleton;
select set_config('knucklebones.progression_v2_start', '1', true);
insert into auth.users (id, email, created_at, updated_at)
values
  ('9f000000-0000-0000-0000-000000000001',
   'progression-v2-settle-p1@example.invalid', now(), now()),
  ('9f000000-0000-0000-0000-000000000002',
   'progression-v2-settle-p2@example.invalid', now(), now());
update public.profiles
   set rating = case id
     when '9f000000-0000-0000-0000-000000000001' then 359
     else 100
   end
 where id in (
   '9f000000-0000-0000-0000-000000000001',
   '9f000000-0000-0000-0000-000000000002'
 );
insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
values
  (1, '9f000000-0000-0000-0000-000000000001', 359, 359, 0, 0, 0),
  (1, '9f000000-0000-0000-0000-000000000002', 100, 100, 0, 0, 0);
insert into public.ranked_weekly_rotations (id, starts_at, ends_at, modifier)
values (
  '9f100000-0000-0000-0000-000000000001',
  '2100-01-04 00:00:00+00', '2100-01-11 00:00:00+00', 'limited'
);
insert into public.matches (
  id, p1, p2, status, turn, season_id, modifier, format,
  protocol_version, curve_version, scoring_version,
  entry_kind, weekly_rotation_id, outcome_roster
) values (
  '9f200000-0000-0000-0000-000000000001',
  '9f000000-0000-0000-0000-000000000001',
  '9f000000-0000-0000-0000-000000000002',
  'active', 1, 1, 'limited', 'standard', 2, 2, 2,
  'weekly', '9f100000-0000-0000-0000-000000000001', array['limited']::text[]
);

create temporary table progression_v2_settlement_result (payload jsonb);
grant insert, select on progression_v2_settlement_result to service_role;
select throws_ok(
  $$select public.settle_match(
    '9f200000-0000-0000-0000-000000000001',
    'done', '9f000000-0000-0000-0000-000000000001',
    24, 12, 35, -25,
    '{"points":359,"peak":359,"wins":0,"losses":0,"draws":0}',
    '{"points":100,"peak":100,"wins":0,"losses":0,"draws":0}',
    '{"points":394,"peak":394,"wins":1,"losses":0,"draws":0}',
    '{"points":75,"peak":100,"wins":0,"losses":1,"draws":0}'
  )$$,
  '22023', null,
  'formula-v2 settlement rejects missing component metadata before applying'
);
set local role service_role;
insert into progression_v2_settlement_result (payload)
select public.settle_match(
  '9f200000-0000-0000-0000-000000000001',
  'done', '9f000000-0000-0000-0000-000000000001',
  24, 12, 35, -25,
  '{"points":359,"peak":359,"wins":0,"losses":0,"draws":0}',
  '{"points":100,"peak":100,"wins":0,"losses":0,"draws":0}',
  '{"points":394,"peak":394,"wins":1,"losses":0,"draws":0,
    "_scoring_version":2,"_base_rating_delta":30,"_finish_rating_delta":5}',
  '{"points":75,"peak":100,"wins":0,"losses":1,"draws":0,
    "_scoring_version":2,"_base_rating_delta":-20,"_finish_rating_delta":-5}'
);
reset role;

select is(
  (select (payload->>'applied')::boolean from progression_v2_settlement_result),
  true,
  'the first direct curve-v2 weekly settlement is applied'
);
select is(
  (select jsonb_build_array(
      p1_rating_delta, p1_base_rating_delta, p1_finish_rating_delta,
      p2_rating_delta, p2_base_rating_delta, p2_finish_rating_delta
    ) from public.matches where id = '9f200000-0000-0000-0000-000000000001'),
  '[35,30,5,-25,-20,-5]'::jsonb,
  'settlement persists exact base and finish components from next-row metadata'
);
select is(
  (select jsonb_agg(jsonb_build_array(player_id::text, rotation_id::text, source_match_id::text))
     from public.ranked_weekly_completions
    where source_match_id = '9f200000-0000-0000-0000-000000000001'),
  '[["9f000000-0000-0000-0000-000000000001",
     "9f100000-0000-0000-0000-000000000001",
     "9f200000-0000-0000-0000-000000000001"]]'::jsonb,
  'the first weekly winner receives one durable rotation completion'
);
select ok(
  (select count(*) = 2 and bool_and(curve_version = 2)
     from public.ranked_progression_events
    where source_match_id = '9f200000-0000-0000-0000-000000000001'),
  'v2 settlement writes one curve-v2 progression event per human participant'
);
select is(
  (select outcome_grants
     from public.ranked_progression_events
    where source_match_id = '9f200000-0000-0000-0000-000000000001'
      and player_id = '9f000000-0000-0000-0000-000000000001'),
  array['rowmult']::text[],
  'the winner event carries only the newly crossed outcome grant'
);
select is(
  (select jsonb_build_object(
      'outcome', (select count(*) from public.player_ranked_outcomes
        where player_id = '9f000000-0000-0000-0000-000000000001'
          and outcome_id = 'rowmult'),
      'debut', (select count(*) from private.ranked_bot_debuts
        where player_id = '9f000000-0000-0000-0000-000000000001'
          and outcome_id = 'rowmult')
    )),
  '{"outcome":1,"debut":1}'::jsonb,
  'the v2 milestone grant and its teaching debut are each durable once'
);

create temporary table progression_v2_duplicate_result (payload jsonb);
grant insert, select on progression_v2_duplicate_result to service_role;
set local role service_role;
insert into progression_v2_duplicate_result (payload)
select public.settle_match(
  '9f200000-0000-0000-0000-000000000001',
  'done', '9f000000-0000-0000-0000-000000000001',
  24, 12, 35, -25,
  '{"points":359,"peak":359,"wins":0,"losses":0,"draws":0}',
  '{"points":100,"peak":100,"wins":0,"losses":0,"draws":0}',
  '{"points":394,"peak":394,"wins":1,"losses":0,"draws":0,
    "_scoring_version":2,"_base_rating_delta":30,"_finish_rating_delta":5}',
  '{"points":75,"peak":100,"wins":0,"losses":1,"draws":0,
    "_scoring_version":2,"_base_rating_delta":-20,"_finish_rating_delta":-5}'
);
reset role;

select is(
  (select (payload->>'applied')::boolean from progression_v2_duplicate_result),
  false,
  'a duplicate v2 settlement is an unapplied retry'
);
select is(
  (select jsonb_build_object(
      'weekly', (select count(*) from public.ranked_weekly_completions
        where source_match_id = '9f200000-0000-0000-0000-000000000001'),
      'events', (select count(*) from public.ranked_progression_events
        where source_match_id = '9f200000-0000-0000-0000-000000000001'),
      'outcomes', (select count(*) from public.player_ranked_outcomes
        where player_id = '9f000000-0000-0000-0000-000000000001'
          and outcome_id = 'rowmult'),
      'debuts', (select count(*) from private.ranked_bot_debuts
        where player_id = '9f000000-0000-0000-0000-000000000001'
          and outcome_id = 'rowmult')
    )),
  '{"weekly":1,"events":2,"outcomes":1,"debuts":1}'::jsonb,
  'the duplicate retry cannot duplicate completion, events, grants, or debut state'
);

-- CLAIM authority is immutable and exclusive. A v2 Trial winner who selected
-- a different offered rune receives neither the frozen v1 selected-rune
-- reward nor the unselected CLAIM rune.
update public.profiles set ranked_pool_tier = 'ivory'
 where id in (
   '9e000000-0000-0000-0000-000000000001',
   '9e000000-0000-0000-0000-000000000002'
 );
insert into public.matches (
  id, p1, p2, status, turn, season_id, modifier,
  format, protocol_version, rune_rules_version, pool_tier, phase,
  trial_offer, p1_rune, p2_rune, curve_version, scoring_version,
  outcome_roster, reward_version, claim_slot, claim_rune
) values (
  '9f300000-0000-0000-0000-000000000001',
  '9e000000-0000-0000-0000-000000000001',
  '9e000000-0000-0000-0000-000000000002',
  'active', 1, 1, 'classic',
  'rune_trial', 2, 1, 'ivory', 'playing',
  array['fate','ward','anvil'], 'fate', 'anvil', 2, 2,
  array['classic','singlestrike','colshield','bounty','rowmult','rune_trial']::text[],
  2, 1, 'ward'
);
create temporary table progression_v2_trial_result as
select public.settle_match(
  '9f300000-0000-0000-0000-000000000001',
  'done', '9e000000-0000-0000-0000-000000000001',
  18, 10, 20, -20,
  '{"points":360,"peak":1490,"wins":2,"losses":1,"draws":0}',
  '{"points":360,"peak":3890,"wins":3,"losses":1,"draws":0}',
  '{"points":380,"peak":1490,"wins":3,"losses":1,"draws":0,
    "_scoring_version":2,"_base_rating_delta":20,"_finish_rating_delta":0}',
  '{"points":340,"peak":3890,"wins":3,"losses":2,"draws":0,
    "_scoring_version":2,"_base_rating_delta":-20,"_finish_rating_delta":0}'
) as payload;
select is(
  (select jsonb_build_array((payload->>'applied')::boolean, payload ? 'reward')
     from progression_v2_trial_result),
  '[true,false]'::jsonb,
  'a non-CLAIM v2 Trial win applies without entering the v1 reward path'
);
select is(
  (select count(*) from public.player_runes
    where player_id = '9e000000-0000-0000-0000-000000000001'
      and rune_id in ('fate','ward')),
  0::bigint,
  'the Trial winner collects neither the selected rune nor the CLAIM rune'
);

-- A forced finish still carries the signed, loser-funded margin transfer.
-- Seven is the hard cap; this fixture leaves the loser with positive points.
insert into public.matches (
  id, p1, p2, status, turn, season_id, modifier, format,
  protocol_version, curve_version, scoring_version, outcome_roster
) values (
  '9f400000-0000-0000-0000-000000000001',
  '9f000000-0000-0000-0000-000000000001',
  '9f000000-0000-0000-0000-000000000002',
  'active', 1, 1, 'classic', 'standard', 2, 2, 2,
  array['classic','singlestrike','colshield','bounty','rowmult']::text[]
);
create temporary table progression_v2_forfeit_result (payload jsonb);
select lives_ok(
  $$insert into progression_v2_forfeit_result (payload)
    select public.settle_match(
      '9f400000-0000-0000-0000-000000000001',
      'forfeit', '9f000000-0000-0000-0000-000000000001',
      0, 0, 27, -27,
      '{"points":394,"peak":394,"wins":1,"losses":0,"draws":0}',
      '{"points":75,"peak":100,"wins":0,"losses":1,"draws":0}',
      '{"points":421,"peak":421,"wins":2,"losses":0,"draws":0,
        "_scoring_version":2,"_base_rating_delta":20,"_finish_rating_delta":7}',
      '{"points":48,"peak":100,"wins":0,"losses":2,"draws":0,
        "_scoring_version":2,"_base_rating_delta":-20,"_finish_rating_delta":-7}'
    )$$,
  'a funded v2 forced finish accepts the capped seven-point transfer'
);
select is(
  (select jsonb_build_object(
      'applied', (select (payload->>'applied')::boolean
                    from progression_v2_forfeit_result),
      'points', (select jsonb_build_array(p1.points, p2.points)
                   from public.season_ratings p1
                   join public.season_ratings p2 on p2.season_id = p1.season_id
                  where p1.season_id = 1
                    and p1.player = '9f000000-0000-0000-0000-000000000001'
                    and p2.player = '9f000000-0000-0000-0000-000000000002'),
      'components', (select jsonb_build_array(
          p1_base_rating_delta, p1_finish_rating_delta,
          p2_base_rating_delta, p2_finish_rating_delta
        ) from public.matches where id = '9f400000-0000-0000-0000-000000000001')
    )),
  '{"applied":true,"points":[421,48],"components":[20,7,-20,-7]}'::jsonb,
  'forced settlement persists the funded points and exact capped components'
);

select * from finish();
rollback;
