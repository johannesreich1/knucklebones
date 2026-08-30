begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(34);

select ok(
  has_column_privilege(
    'authenticated', 'public.profiles', 'equipped_rune', 'update'
  )
  and not has_column_privilege(
    'authenticated', 'public.profiles', 'random_rune_mode', 'update'
  )
  and not has_column_privilege(
    'anon', 'public.profiles', 'random_rune_mode', 'update'
  ),
  'legacy fixed equipment stays writable but RANDOM has no direct column grant'
);

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
  'only matchmaking can snapshot random equipment into a match'
);

select ok(
  not has_function_privilege(
    'authenticated', 'private.random_owned_rune_for_match(uuid,text)', 'execute'
  )
  and not has_function_privilege(
    'service_role', 'private.random_owned_rune_for_match(uuid,text)', 'execute'
  ),
  'the random inventory helper is not a participant-facing RPC'
);

select ok(
  to_regprocedure('public.set_rune_equipment(text,boolean)') is not null
  and has_function_privilege(
    'authenticated', to_regprocedure('public.set_rune_equipment(text,boolean)'), 'execute'
  )
  and not has_function_privilege(
    'anon', to_regprocedure('public.set_rune_equipment(text,boolean)'), 'execute'
  )
  and not has_function_privilege(
    'service_role', to_regprocedure('public.set_rune_equipment(text,boolean)'), 'execute'
  ),
  'only an authenticated player can call the equipment write RPC'
);

insert into auth.users (id, email, created_at, updated_at)
select
  format('9a000000-0000-0000-0000-%s', lpad(ordinal::text, 12, '0'))::uuid,
  format('random-equipped-%s@example.invalid', ordinal),
  now(), now()
from generate_series(1, 9) ordinal;

update public.profiles
   set ranked_pool_tier = 'ivory',
       rating = case
         when id in (
           '9a000000-0000-0000-0000-000000000004',
           '9a000000-0000-0000-0000-000000000005'
         ) then 1259
         else 1600
       end;

insert into public.player_runes (player_id, rune_id, source_match_id)
values
  ('9a000000-0000-0000-0000-000000000001', 'fate', null),
  ('9a000000-0000-0000-0000-000000000001', 'nudge', null),
  ('9a000000-0000-0000-0000-000000000001', 'ward', null),
  ('9a000000-0000-0000-0000-000000000002', 'anvil', null),
  ('9a000000-0000-0000-0000-000000000004', 'sunder', null),
  ('9a000000-0000-0000-0000-000000000005', 'pilfer', null),
  ('9a000000-0000-0000-0000-000000000006', 'fate', null),
  ('9a000000-0000-0000-0000-000000000007', 'ward', null),
  ('9a000000-0000-0000-0000-000000000007', 'nudge', null),
  ('9a000000-0000-0000-0000-000000000008', 'fate', null),
  ('9a000000-0000-0000-0000-000000000008', 'nudge', null),
  ('9a000000-0000-0000-0000-000000000008', 'ward', null),
  ('9a000000-0000-0000-0000-000000000009', 'ward', null);

update public.profiles
   set equipped_rune = case id
     when '9a000000-0000-0000-0000-000000000001' then 'ward'
     when '9a000000-0000-0000-0000-000000000002' then 'anvil'
     when '9a000000-0000-0000-0000-000000000004' then 'sunder'
     when '9a000000-0000-0000-0000-000000000005' then 'pilfer'
     when '9a000000-0000-0000-0000-000000000006' then 'fate'
     when '9a000000-0000-0000-0000-000000000007' then 'ward'
     when '9a000000-0000-0000-0000-000000000009' then 'ward'
     else equipped_rune
   end;
update public.profiles
   set random_rune_mode = true
 where id in (
   '9a000000-0000-0000-0000-000000000001',
   '9a000000-0000-0000-0000-000000000004',
   '9a000000-0000-0000-0000-000000000006',
   '9a000000-0000-0000-0000-000000000009'
 );

select lives_ok(
  $$delete from public.player_runes
     where player_id = '9a000000-0000-0000-0000-000000000009'
       and rune_id = 'ward'$$,
  'deleting an equipped ownership row can apply the FK ON DELETE SET NULL action'
);
select is(
  (select concat(random_rune_mode, '/', coalesce(equipped_rune, 'none'))
     from public.profiles
    where id = '9a000000-0000-0000-0000-000000000009'),
  'f/none',
  'the FK ownership delete clears RANDOM with the equipped fallback'
);

select is(
  private.random_owned_rune_for_match(
    '9a000000-0000-0000-0000-000000000001', 'repeatable-seed'
  ),
  private.random_owned_rune_for_match(
    '9a000000-0000-0000-0000-000000000001', 'repeatable-seed'
  ),
  'the same player and match seed resolve the same random rune'
);

select ok(
  (
    select count(distinct private.random_owned_rune_for_match(
      '9a000000-0000-0000-0000-000000000001', 'seed-' || ordinal
    )) > 1
      from generate_series(1, 64) ordinal
  ),
  'different match seeds can deal different owned runes'
);

select ok(
  private.random_owned_rune_for_match(
    '9a000000-0000-0000-0000-000000000001', 'owned-only-seed'
  ) in ('fate', 'nudge', 'ward'),
  'a random deal is always drawn from the player collection'
);

select isnt(
  private.random_owned_rune_for_match(
    '9a000000-0000-0000-0000-000000000001', 'salt-seed-2'
  ),
  private.random_owned_rune_for_match(
    '9a000000-0000-0000-0000-000000000008', 'salt-seed-2'
  ),
  'participant salt lets identical collections resolve independently for one seed'
);

select is(
  private.random_owned_rune_for_match(
    '9a000000-0000-0000-0000-000000000003', 'empty-inventory-seed'
  ),
  null,
  'the owned-rune helper returns an empty hand for an empty inventory'
);

-- A new client sends the random flag and an owned fallback together. Old
-- clients can still display and play that concrete fallback safely.
update public.profiles
   set equipped_rune = 'nudge', random_rune_mode = true
 where id = '9a000000-0000-0000-0000-000000000007';
select is(
  (select concat(random_rune_mode, '/', equipped_rune)
     from public.profiles
    where id = '9a000000-0000-0000-0000-000000000007'),
  't/nudge',
  'enabling random mode atomically retains an owned fixed fallback'
);

-- A deployed client knows only equipped_rune. Its ordinary PATCH must switch
-- random mode off, not fail the canonical fallback constraint.
select set_config(
  'request.jwt.claim.sub', '9a000000-0000-0000-0000-000000000007', true
);
set local role authenticated;
update public.profiles
   set equipped_rune = 'nudge'
 where id = '9a000000-0000-0000-0000-000000000007';
reset role;
select is(
  (select concat(random_rune_mode, '/', equipped_rune)
     from public.profiles
    where id = '9a000000-0000-0000-0000-000000000007'),
  'f/nudge',
  'a legacy PATCH exits RANDOM even when it repeats the fallback value'
);

update public.profiles
   set equipped_rune = 'nudge', random_rune_mode = true
 where id = '9a000000-0000-0000-0000-000000000007';
set local role authenticated;
update public.profiles
   set equipped_rune = 'ward'
 where id = '9a000000-0000-0000-0000-000000000007';
reset role;
select is(
  (select concat(random_rune_mode, '/', equipped_rune)
     from public.profiles
    where id = '9a000000-0000-0000-0000-000000000007'),
  'f/ward',
  'a legacy fixed-rune PATCH exits random mode without failing'
);

update public.profiles
   set equipped_rune = 'nudge', random_rune_mode = true
 where id = '9a000000-0000-0000-0000-000000000007';
set local role authenticated;
update public.profiles
   set equipped_rune = null
 where id = '9a000000-0000-0000-0000-000000000007';
reset role;
select is(
  (select concat(random_rune_mode, '/', coalesce(equipped_rune, 'none'))
     from public.profiles
    where id = '9a000000-0000-0000-0000-000000000007'),
  'f/none',
  'a legacy clear-only PATCH exits random mode without failing'
);

select throws_ok(
  $$update public.profiles
       set equipped_rune = null, random_rune_mode = true
     where id = '9a000000-0000-0000-0000-000000000007'$$,
  '23514',
  null,
  'a forged request cannot enable random mode without an owned fallback'
);
select is(
  (select concat(random_rune_mode, '/', coalesce(equipped_rune, 'none'))
     from public.profiles
    where id = '9a000000-0000-0000-0000-000000000007'),
  'f/none',
  'the rejected mixed-mode write leaves the prior equipment intact'
);

select set_config(
  'request.jwt.claim.sub', '9a000000-0000-0000-0000-000000000007', true
);
set local role authenticated;
select results_eq(
  $$update public.profiles
       set equipped_rune = 'nudge'
     where id = '9a000000-0000-0000-0000-000000000007'
     returning concat(random_rune_mode, '/', equipped_rune)$$,
  array['f/nudge'],
  'an authenticated owner keeps the deployed fixed-equipment PATCH path'
);
select throws_ok(
  $$update public.profiles
       set random_rune_mode = true
     where id = '9a000000-0000-0000-0000-000000000007'$$,
  '42501',
  null,
  'an authenticated client cannot bypass the atomic RPC with a direct RANDOM write'
);
reset role;

select set_config(
  'request.jwt.claim.sub', '9a000000-0000-0000-0000-000000000008', true
);
set local role authenticated;
select is_empty(
  $$update public.profiles
       set equipped_rune = 'ward'
     where id = '9a000000-0000-0000-0000-000000000007'
     returning id$$,
  'profile RLS filters a stranger fixed-equipment write to zero rows'
);
reset role;
select is(
  (select random_rune_mode from public.profiles
    where id = '9a000000-0000-0000-0000-000000000007'),
  false,
  'the denied stranger write leaves the owner equipment intact'
);

select set_config(
  'request.jwt.claim.sub', '9a000000-0000-0000-0000-000000000007', true
);
set local role authenticated;
select is(
  public.set_rune_equipment('ward', true),
  '{"equipped_rune":"ward","random_rune_mode":true}'::jsonb,
  'the v2 RPC enables RANDOM with an owned fallback'
);
select is(
  public.set_rune_equipment('nudge', true),
  '{"equipped_rune":"nudge","random_rune_mode":true}'::jsonb,
  'changing the fallback from RANDOM to RANDOM preserves the mode atomically'
);
select throws_ok(
  $$select public.set_rune_equipment('anvil', false)$$,
  '23503',
  null,
  'the equipment RPC cannot persist a rune the caller does not own'
);
select is(
  (select concat(random_rune_mode, '/', equipped_rune)
     from public.profiles
    where id = '9a000000-0000-0000-0000-000000000007'),
  't/nudge',
  'a rejected RPC write leaves the prior RANDOM equipment intact'
);
select throws_ok(
  $$select public.set_rune_equipment(null, true)$$,
  '22023',
  null,
  'the equipment RPC rejects RANDOM without a concrete owned fallback'
);
select is(
  public.set_rune_equipment('ward', false),
  '{"equipped_rune":"ward","random_rune_mode":false}'::jsonb,
  'the equipment RPC can switch RANDOM back to one fixed rune'
);
select is(
  public.set_rune_equipment(null, false),
  '{"equipped_rune":null,"random_rune_mode":false}'::jsonb,
  'the equipment RPC can clear both equipment fields'
);
reset role;

set local role service_role;
select public.enqueue_ranked_player_v2(
  player, 2::smallint, array['rune_trial_v1','equipped_rune_v1']
)
from unnest(array[
  '9a000000-0000-0000-0000-000000000001'::uuid,
  '9a000000-0000-0000-0000-000000000002'::uuid
]) player;
create temporary table random_standard_start as
select public.start_ranked_match_v3(
  '9a000000-0000-0000-0000-000000000001',
  '9a000000-0000-0000-0000-000000000001',
  '9a000000-0000-0000-0000-000000000002',
  'random-standard-seed', 4::smallint, 'classic', 1::smallint,
  '9a000000-0000-0000-0000-000000000002',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'standard', null::text[], null::timestamptz,
  null::text, null::text, true
) as payload;
reset role;
select is(
  (select concat(
    payload->'match'->>'p1_rune', '/', payload->'match'->>'p2_rune'
  ) from random_standard_start),
  private.random_owned_rune_for_match(
    '9a000000-0000-0000-0000-000000000001', 'random-standard-seed'
  ) || '/anvil',
  'a SILVER standard match snapshots random and fixed equipment independently'
);

update public.profiles profile
   set equipped_rune = (
         select owned.rune_id
           from public.player_runes owned
          where owned.player_id = profile.id
            and owned.rune_id <> (
              select payload->'match'->>'p1_rune' from random_standard_start
            )
          order by owned.rune_id
          limit 1
       ),
       random_rune_mode = false
 where profile.id = '9a000000-0000-0000-0000-000000000001';
select ok(
  (select match.p1_rune = start.payload->'match'->>'p1_rune'
          and match.p1_rune is distinct from profile.equipped_rune
     from random_standard_start start
     join public.matches match
       on match.id = (start.payload->'match'->>'id')::uuid
     join public.profiles profile on profile.id = match.p1),
  'changing profile equipment after start cannot mutate the match snapshot'
);

insert into public.matchmaking_queue (
  player_id, protocol_version, capabilities, pool_tier
) values
  (
    '9a000000-0000-0000-0000-000000000001', 2,
    array['rune_trial_v1','equipped_rune_v1'], 'ivory'
  ),
  (
    '9a000000-0000-0000-0000-000000000002', 2,
    array['rune_trial_v1','equipped_rune_v1'], 'ivory'
  );
set local role service_role;
create temporary table random_standard_retry as
select public.start_ranked_match_v3(
  '9a000000-0000-0000-0000-000000000001',
  '9a000000-0000-0000-0000-000000000001',
  '9a000000-0000-0000-0000-000000000002',
  'random-standard-seed', 4::smallint, 'classic', 1::smallint,
  '9a000000-0000-0000-0000-000000000002',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'standard', null::text[], null::timestamptz,
  null::text, null::text, true
) as payload;
reset role;
select is(
  (select concat(
    retry.payload->>'created', '/', retry.payload->'match'->>'p1_rune'
  )
     from random_standard_retry retry),
  (select concat('false/', start.payload->'match'->>'p1_rune')
     from random_standard_start start),
  'a retried start returns the existing immutable random snapshot'
);

update public.matches
   set status = 'forfeit', finished_at = clock_timestamp()
 where id = (select (payload->'match'->>'id')::uuid from random_standard_start);
set local role service_role;
select public.enqueue_ranked_player_v2(
  player, 2::smallint, array['rune_trial_v1','equipped_rune_v1']
)
from unnest(array[
  '9a000000-0000-0000-0000-000000000003'::uuid,
  '9a000000-0000-0000-0000-000000000007'::uuid
]) player;
create temporary table empty_random_start as
select public.start_ranked_match_v3(
  '9a000000-0000-0000-0000-000000000003',
  '9a000000-0000-0000-0000-000000000003',
  '9a000000-0000-0000-0000-000000000007',
  'empty-random-seed', 2::smallint, 'classic', 1::smallint,
  '9a000000-0000-0000-0000-000000000007',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'standard', null::text[], null::timestamptz,
  null::text, null::text, true
) as payload;
reset role;
select is(
  (select payload->'match'->>'p1_rune' from empty_random_start),
  null,
  'a SILVER seat with no collection stays rune-free'
);

update public.matches
   set status = 'forfeit', finished_at = clock_timestamp()
 where id = (select (payload->'match'->>'id')::uuid from empty_random_start);
set local role service_role;
select public.enqueue_ranked_player_v2(
  player, 2::smallint, array['rune_trial_v1','equipped_rune_v1']
)
from unnest(array[
  '9a000000-0000-0000-0000-000000000004'::uuid,
  '9a000000-0000-0000-0000-000000000005'::uuid
]) player;
create temporary table below_random_start as
select public.start_ranked_match_v3(
  '9a000000-0000-0000-0000-000000000004',
  '9a000000-0000-0000-0000-000000000004',
  '9a000000-0000-0000-0000-000000000005',
  'below-random-seed', 3::smallint, 'classic', 1::smallint,
  '9a000000-0000-0000-0000-000000000005',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'standard', null::text[], null::timestamptz,
  null::text, null::text, true
) as payload;
reset role;
select is(
  (select concat(
    coalesce(payload->'match'->>'p1_rune', 'none'), '/',
    coalesce(payload->'match'->>'p2_rune', 'none')
  ) from below_random_start),
  'none/none',
  'below SILVER both random and fixed equipment stay out of the game'
);

update public.matches
   set status = 'forfeit', finished_at = clock_timestamp()
 where id = (select (payload->'match'->>'id')::uuid from below_random_start);
set local role service_role;
select public.enqueue_ranked_player_v2(
  player, 2::smallint, array['rune_trial_v1','equipped_rune_v1']
)
from unnest(array[
  '9a000000-0000-0000-0000-000000000006'::uuid,
  '9a000000-0000-0000-0000-000000000007'::uuid
]) player;
create temporary table random_trial_start as
select public.start_ranked_match_v3(
  '9a000000-0000-0000-0000-000000000006',
  '9a000000-0000-0000-0000-000000000006',
  '9a000000-0000-0000-0000-000000000007',
  'random-trial-seed', 6::smallint, 'classic', 1::smallint,
  '9a000000-0000-0000-0000-000000000007',
  null::smallint, null::smallint, null::smallint, null::smallint,
  2::smallint, 'ivory', 'rune_trial', array['fate','nudge','ward'],
  clock_timestamp() + interval '10 seconds', 'fate', 'nudge', false
) as payload;
reset role;
select is(
  (select concat(
    payload->'match'->>'phase', '/',
    coalesce(payload->'match'->>'p1_rune', 'hidden'), '/',
    coalesce(payload->'match'->>'p2_rune', 'hidden')
  ) from random_trial_start),
  'selection/hidden/hidden',
  'Rune Trial ignores random and fixed profile equipment'
);

select * from finish();
rollback;
