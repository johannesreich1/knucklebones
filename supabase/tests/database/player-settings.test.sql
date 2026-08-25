begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

select ok(
  not has_table_privilege('anon', 'public.player_settings', 'select'),
  'signed-out visitors cannot read settings'
);
select ok(
  has_table_privilege('authenticated', 'public.player_settings', 'select'),
  'signed-in players can read an RLS-filtered settings row'
);
select ok(
  has_table_privilege('authenticated', 'public.player_settings', 'insert'),
  'signed-in players can initialize their settings row'
);
select ok(
  has_table_privilege('authenticated', 'public.player_settings', 'update'),
  'signed-in players can update their settings row'
);
select ok(
  not has_table_privilege('authenticated', 'public.player_settings', 'delete'),
  'client settings cannot be deleted directly'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('61000000-0000-0000-0000-000000000001', 'settings-me@example.invalid', now(), now()),
  ('61000000-0000-0000-0000-000000000002', 'settings-other@example.invalid', now(), now());

select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$insert into public.player_settings
      (user_id, sound, numerals, p1_hue, p2_hue, colorblind, reduced_motion)
    values
      ('61000000-0000-0000-0000-000000000001', false, true, 'blue', 'gold', true, null)$$,
  'a player can initialize valid settings'
);
select is(
  (select count(*)::integer from public.player_settings),
  1,
  'RLS reveals only the caller settings row'
);
select ok(
  (select locale is null from public.player_settings),
  'new and migrated settings follow the current device by default'
);
select lives_ok(
  $$update public.player_settings set locale = 'en'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  'English is a valid locale override'
);
select lives_ok(
  $$update public.player_settings set locale = 'pt'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  'Brazilian Portuguese uses the valid stable pt locale override'
);
select lives_ok(
  $$update public.player_settings set locale = 'es'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  'Spanish is a valid locale override'
);
select lives_ok(
  $$update public.player_settings set locale = 'de'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  'German is a valid locale override'
);
select lives_ok(
  $$update public.player_settings set locale = 'fr'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  'French is a valid locale override'
);
select lives_ok(
  $$update public.player_settings set locale = 'it'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  'Italian is a valid locale override'
);
select throws_ok(
  $$update public.player_settings set locale = 'pt-BR'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'the Portuguese presentation tag is rejected by the database'
);
select throws_ok(
  $$update public.player_settings set locale = 'es-MX'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'regional Spanish variants are rejected by the database'
);
select throws_ok(
  $$update public.player_settings set locale = 'nl'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'unsupported locales are rejected by the database'
);
select lives_ok(
  $$update public.player_settings set locale = null
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  'the locale override can return to the current device'
);
select throws_ok(
  $$update public.player_settings set p1_hue = 'pink'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'unknown hues are rejected by the database'
);
select throws_ok(
  $$update public.player_settings set p2_hue = 'blue'
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'the two stored hues cannot clash'
);
select lives_ok(
  $$update public.player_settings set reduced_motion = false
     where user_id = '61000000-0000-0000-0000-000000000001'$$,
  'an explicit reduced-motion override is valid'
);
select throws_ok(
  $$insert into public.player_settings (user_id)
    values ('61000000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'inserting another player row is rejected without leaking it'
);

reset role;

select is(
  (select count(*)::integer from public.player_settings),
  1,
  'RLS prevented the other-player insert'
);
select is(
  (select reduced_motion from public.player_settings
    where user_id = '61000000-0000-0000-0000-000000000001'),
  false,
  'the valid override was stored'
);
select ok(
  (select locale is null from public.player_settings
    where user_id = '61000000-0000-0000-0000-000000000001'),
  'the automatic locale preference was stored'
);
delete from auth.users
where id = '61000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::integer from public.player_settings
    where user_id = '61000000-0000-0000-0000-000000000001'),
  0,
  'deleting the account still removes its synchronized settings row'
);

select * from finish();
rollback;
