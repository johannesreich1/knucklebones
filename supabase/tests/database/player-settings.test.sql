begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

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

select * from finish();
rollback;
