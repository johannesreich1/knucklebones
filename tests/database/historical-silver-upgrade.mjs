#!/usr/bin/env node

// Destructive only to the local Supabase development database: prove the
// production stage-1 -> stage-2 progression upgrade with real legacy rows,
// then always restore the local database to the latest migration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CLI = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
);
const DATABASE_CONTAINER = 'supabase_db_knucklebones';
const LEGACY_VERSION = '20260830182406';
const FINAL_VERSION = '20260831133000';

if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error(`Node 24 is required; found ${process.version}.`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result.stdout ?? '';
}

function reset(version) {
  const args = ['db', 'reset', '--local', '--no-seed', '--yes'];
  if (version) args.push('--version', version);
  run(CLI, args);
}

function sql(statement) {
  return run('docker', [
    'exec', '-i', DATABASE_CONTAINER,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres',
  ], { input: statement });
}

function jsonRow(statement) {
  const rows = sql(statement).trim().split('\n').filter(Boolean);
  assert.equal(rows.length, 1, 'upgrade probe returned an unexpected row count');
  return JSON.parse(rows[0]);
}

const seedLegacyRows = String.raw`
insert into auth.users (id, email, created_at, updated_at)
select
  format('9e000000-0000-0000-0000-%s', lpad(ordinal::text, 12, '0'))::uuid,
  format('historical-silver-upgrade-%s@example.invalid', ordinal),
  now(), now()
from generate_series(1, 4) ordinal;

insert into public.season_ratings
  (season_id, player, points, peak, wins, losses, draws)
values
  (1, '9e000000-0000-0000-0000-000000000001', 1218, 1500, 2, 1, 0),
  (1, '9e000000-0000-0000-0000-000000000002', 1218, 1500, 2, 1, 0),
  (1, '9e000000-0000-0000-0000-000000000003', 900, 1200, 1, 2, 0),
  (1, '9e000000-0000-0000-0000-000000000004', 1260, 1260, 2, 1, 0);

insert into public.ranked_progression_events (
  id, player_id, source_match_id, season_id,
  points_before, points_after, apex_before, apex_after,
  pool_tier_before, pool_tier_after,
  equipped_rune_before, equipped_rune_after,
  random_rune_mode_before, random_rune_mode_after,
  rune_seat_active_before, rune_seat_active_after, created_at
)
values
  ('9f000000-0000-0000-0000-000000000001',
   '9e000000-0000-0000-0000-000000000001', null, 1,
   1300, 1218, false, false, 'ivory', 'ivory',
   'ward', 'ward', false, false, true, false, '2026-08-30T10:00:00Z'),
  ('9f000000-0000-0000-0000-000000000002',
   '9e000000-0000-0000-0000-000000000002', null, 1,
   1218, 1218, false, false, 'ivory', 'ivory',
   null, null, false, false, false, false, '2026-08-30T10:01:00Z'),
  ('9f000000-0000-0000-0000-000000000003',
   '9e000000-0000-0000-0000-000000000003', null, 1,
   899, 900, false, false, 'bone', 'bone',
   null, null, false, false, false, false, '2026-08-30T10:02:00Z'),
  ('9f000000-0000-0000-0000-000000000004',
   '9e000000-0000-0000-0000-000000000004', null, 1,
   1200, 1210, false, false, 'ivory', 'ivory',
   null, null, false, false, false, false, '2026-08-30T10:03:00Z'),
  ('9f000000-0000-0000-0000-000000000005',
   '9e000000-0000-0000-0000-000000000004', null, 1,
   1210, 1260, false, false, 'ivory', 'ivory',
   null, 'ward', false, false, false, true, '2026-08-30T10:04:00Z');
`;

let failure;
try {
  reset(LEGACY_VERSION);
  sql(seedLegacyRows);
  run(CLI, ['migration', 'up', '--local']);

  const rows = jsonRow(String.raw`
    select jsonb_agg(jsonb_build_object(
      'id', right(id::text, 1),
      'before', rune_seat_active_before,
      'after', rune_seat_active_after
    ) order by created_at)::text
      from public.ranked_progression_events
     where player_id::text like '9e000000-0000-0000-0000-%';
  `);
  assert.deepEqual(rows, [
    { id: '1', before: true, after: true },
    { id: '2', before: true, after: true },
    { id: '3', before: false, after: false },
    { id: '4', before: true, after: true },
    { id: '5', before: true, after: true },
  ], 'legacy rows did not converge to the conservative durable unlock');

  const contract = jsonRow(String.raw`
    select jsonb_build_object(
      'migration', exists (
        select 1 from supabase_migrations.schema_migrations
         where version = '${FINAL_VERSION}'
           and name = 'historical_silver_ranked_runes'
      ),
      'legacy_constraints', (
        select count(*) from pg_constraint
         where conrelid = to_regclass('public.ranked_progression_events')
           and conname in (
             'ranked_progression_events_rune_live_before_check',
             'ranked_progression_events_rune_live_after_check'
           )
      ),
      'monotonic_validated', coalesce((
        select convalidated from pg_constraint
         where conrelid = to_regclass('public.ranked_progression_events')
           and conname = 'ranked_progression_events_rune_unlock_monotonic_check'
      ), false)
    )::text;
  `);
  assert.deepEqual(contract, {
    migration: true,
    legacy_constraints: 0,
    monotonic_validated: true,
  });
} catch (error) {
  failure = error;
} finally {
  try {
    reset();
  } catch (restoreError) {
    failure = failure
      ? new AggregateError([failure, restoreError], 'upgrade test and local reset both failed')
      : restoreError;
  }
}

if (failure) throw failure;
process.stdout.write(JSON.stringify({
  legacyVersion: LEGACY_VERSION,
  finalVersion: FINAL_VERSION,
  restoredLatest: true,
  problems: [],
}, null, 2) + '\n');
