begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

select ok(
  (select count(*) = 3
          and count(*) filter (
            where column_name = 'season_id' and data_type = 'smallint'
              and is_nullable = 'NO' and column_default is null
          ) = 1
          and count(*) filter (
            where column_name = 'player' and data_type = 'uuid'
              and is_nullable = 'NO' and column_default is null
          ) = 1
          and count(*) filter (
            where column_name = 'best_streak' and data_type = 'integer'
              and is_nullable = 'NO' and column_default is null
          ) = 1
     from information_schema.columns
    where table_schema = 'private' and table_name = 'season_streak_baselines')
  and coalesce((
    select pg_get_userbyid(c.relowner) = 'postgres' and not c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'private' and c.relname = 'season_streak_baselines'
  ), false),
  'the private baseline table has the exact three-column shape and owner'
);

select ok(
  (select count(*) = 3
          and count(*) filter (
            where conname = 'season_streak_baselines_pkey'
              and contype = 'p' and convalidated and not condeferrable
              and conkey = array[1, 2]::smallint[]
          ) = 1
          and count(*) filter (
            where conname = 'season_streak_baselines_rating_fkey'
              and contype = 'f' and convalidated and not condeferrable
              and confrelid = 'public.season_ratings'::regclass
              and confdeltype = 'c'
              and conkey = array[1, 2]::smallint[]
              and confkey = array[1, 2]::smallint[]
          ) = 1
          and count(*) filter (
            where conname = 'season_streak_baselines_best_streak_check'
              and contype = 'c' and convalidated
              and pg_get_constraintdef(oid, true) = 'CHECK (best_streak >= 0)'
          ) = 1
     from pg_constraint
    where conrelid = 'private.season_streak_baselines'::regclass),
  'the baseline primary key, cascading rating foreign key, and check are exact'
);

select ok(
  not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(
        coalesce(c.relacl, acldefault('r', c.relowner))
      ) acl
     where n.nspname = 'private' and c.relname = 'season_streak_baselines'
       and acl.grantee <> c.relowner
  ),
  'no non-owner role has any direct privilege on the private baseline table'
);

select ok(
  not has_table_privilege('anon', 'private.season_streak_baselines', 'select')
  and not has_table_privilege('authenticated', 'private.season_streak_baselines', 'select')
  and not has_table_privilege('service_role', 'private.season_streak_baselines', 'select'),
  'Data API roles cannot read the private baseline table'
);

select is(
  (select array_agg(column_name::text order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'season_ratings'),
  array['season_id', 'player', 'points', 'peak', 'wins', 'losses', 'draws']::text[],
  'season_ratings keeps the exact five-field settlement snapshot shape'
);

select is(
  pg_get_function_result('public.player_card(text)'::regprocedure),
  'TABLE(streak integer, since timestamp with time zone, points integer, wins bigint, losses bigint, games bigint, rank bigint, apex boolean, peak integer)'::text,
  'player_card keeps its exact result signature'
);

select ok(
  coalesce((
    select p.prosecdef
           and p.provolatile = 's'
           and p.prokind = 'f'
           and p.proretset
           and l.lanname = 'sql'
           and pg_get_userbyid(p.proowner) = 'postgres'
           and p.proconfig = array['search_path=""']::text[]
      from pg_proc p
      join pg_language l on l.oid = p.prolang
     where p.oid = 'public.player_card(text)'::regprocedure
  ), false),
  'player_card remains a stable, search-path-pinned definer function'
);

select is(
  (select coalesce(
            array_agg(
              coalesce(role.rolname, 'PUBLIC') || ':' || acl.is_grantable::text
              order by coalesce(role.rolname, 'PUBLIC')
            ),
            array[]::text[]
          )
     from pg_proc p
     cross join lateral aclexplode(
       coalesce(p.proacl, acldefault('f', p.proowner))
     ) acl
     left join pg_roles role on role.oid = acl.grantee
    where p.oid = 'public.player_card(text)'::regprocedure
      and acl.grantee <> p.proowner
      and acl.privilege_type = 'EXECUTE'),
  array['anon:false', 'authenticated:false']::text[],
  'player_card remains executable only by anon and authenticated clients'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('52000000-0000-0000-0000-000000000001', 'streak-base@example.invalid', now(), now()),
  ('52000000-0000-0000-0000-000000000002', 'streak-peer@example.invalid', now(), now());

update public.profiles
   set nickname = case id
     when '52000000-0000-0000-0000-000000000001' then 'StreakBase'
     else 'StreakPeer'
   end
 where id in (
   '52000000-0000-0000-0000-000000000001',
   '52000000-0000-0000-0000-000000000002'
 );

insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
values
  (0, '52000000-0000-0000-0000-000000000001', 0, 0, 12, 8, 0),
  (1, '52000000-0000-0000-0000-000000000001', 1200, 1320, 10, 8, 1),
  (1, '52000000-0000-0000-0000-000000000002', 1100, 1180, 8, 10, 1);

select throws_ok(
  $$insert into private.season_streak_baselines (season_id, player, best_streak)
    values (1, '52000000-0000-0000-0000-000000000002', -1)$$,
  '23514', null,
  'negative baseline streaks are rejected'
);

select throws_ok(
  $$insert into private.season_streak_baselines (season_id, player, best_streak)
    values (1, '52000000-0000-0000-0000-000000000099', 2)$$,
  '23503', null,
  'a baseline cannot exist without its season rating'
);

insert into private.season_streak_baselines (season_id, player, best_streak)
values
  (0, '52000000-0000-0000-0000-000000000001', 9),
  (1, '52000000-0000-0000-0000-000000000001', 3);

select is(
  (select count(*)::integer
     from public.matches match
    where match.p1 = '52000000-0000-0000-0000-000000000001'
       or match.p2 = '52000000-0000-0000-0000-000000000001'),
  0,
  'a baseline does not invent match history'
);

select is(
  (select card.streak from public.player_card('StreakBase') card),
  3,
  'the current-season baseline is shown with no history and an older-season baseline is ignored'
);

insert into public.matches (
  id, p1, p2, status, turn, winner, season_id, finished_at
)
values
  (
    '53000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000002',
    'done', 1, '52000000-0000-0000-0000-000000000001',
    1, '2026-08-26 12:01:00+00'
  ),
  (
    '53000000-0000-0000-0000-000000000002',
    '52000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000002',
    'done', 1, '52000000-0000-0000-0000-000000000001',
    1, '2026-08-26 12:02:00+00'
  );

select is(
  (select card.streak from public.player_card('StreakBase') card),
  3,
  'a real winning run below the baseline does not lower the displayed best'
);

insert into public.matches (
  id, p1, p2, status, turn, winner, season_id, finished_at
)
values
  (
    '53000000-0000-0000-0000-000000000003',
    '52000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000002',
    'done', 1, '52000000-0000-0000-0000-000000000002',
    1, '2026-08-26 12:03:00+00'
  ),
  (
    '53000000-0000-0000-0000-000000000004',
    '52000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000002',
    'done', 1, '52000000-0000-0000-0000-000000000001',
    1, '2026-08-26 12:04:00+00'
  ),
  (
    '53000000-0000-0000-0000-000000000005',
    '52000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000002',
    'done', 1, '52000000-0000-0000-0000-000000000001',
    1, '2026-08-26 12:05:00+00'
  ),
  (
    '53000000-0000-0000-0000-000000000006',
    '52000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000002',
    'done', 1, '52000000-0000-0000-0000-000000000001',
    1, '2026-08-26 12:06:00+00'
  ),
  (
    '53000000-0000-0000-0000-000000000007',
    '52000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000002',
    'done', 1, '52000000-0000-0000-0000-000000000001',
    1, '2026-08-26 12:07:00+00'
  );

select is(
  (select card.streak from public.player_card('StreakBase') card),
  4,
  'a longer real winning run supersedes the stored baseline'
);

select set_config(
  'request.jwt.claim.sub',
  '52000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;
select is(
  public.best_streak(),
  4,
  'best_streak delegates to the baseline-aware player card'
);
reset role;

delete from public.season_ratings
 where season_id = 1
   and player = '52000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer
     from private.season_streak_baselines
    where season_id = 1
      and player = '52000000-0000-0000-0000-000000000001'),
  0,
  'deleting a season rating cascades to its streak baseline'
);

select * from finish();
rollback;
