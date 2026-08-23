begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

select has_table(
  'public', 'game_center_ids',
  'the device-gated Game Center identity table is in a clean local ledger'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.game_center_ids'::regclass),
  'Game Center mappings keep row-level security enabled'
);
select ok(
  has_table_privilege('service_role', 'public.game_center_ids', 'select'),
  'gc-auth service credentials can read identity mappings'
);
select ok(
  has_table_privilege('service_role', 'public.game_center_ids', 'insert'),
  'gc-auth service credentials can claim identity mappings'
);
select ok(
  not has_table_privilege('service_role', 'public.game_center_ids', 'delete'),
  'gc-auth cannot delete a durable identity recovery anchor'
);
select ok(
  not has_table_privilege('service_role', 'public.game_center_ids', 'update'),
  'gc-auth cannot mutate an identity claim in place'
);
select ok(
  not has_table_privilege('anon', 'public.game_center_ids', 'select'),
  'anonymous callers cannot read Game Center mappings'
);
select ok(
  not has_table_privilege('authenticated', 'public.game_center_ids', 'select'),
  'authenticated callers cannot read Game Center mappings'
);

select * from finish();
rollback;
