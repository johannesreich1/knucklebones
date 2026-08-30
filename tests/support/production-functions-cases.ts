import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EQUIPPED_RANKED_BOT_DATA,
  EQUIPPED_RANKED_SCHEMA,
  RUNE_TRIAL_FUNCTIONS,
  RUNE_TRIAL_JOB,
  RUNE_TRIAL_SCHEMA,
} from '../../tools/database/production-rollout.mjs';
import { uploadPayload } from '../../tools/fnfiles.mjs';
import {
  FUNCTION_CLI_VERSION,
  FUNCTION_ROLLOUT_SLUGS,
  RANKED_RUNES_MIGRATION_NAME,
  RANKED_RUNES_MIGRATION_VERSION,
  RANKED_RUNES_PRODUCTION_PREREQUISITE,
  RUNE_TRIAL_MIGRATION_NAME,
  RUNE_TRIAL_MIGRATION_VERSION,
  RUNE_TRIAL_PREREQUISITE_FIELDS,
  RUNE_TRIAL_PRODUCTION_PREREQUISITE,
  assertExactDownloadedClosure,
  supabaseReadbackOmissionPaths,
} from '../../tools/functions/production-rollout.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CLI = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
);
export const payloads = new Map(
  FUNCTION_ROLLOUT_SLUGS.map(slug => [slug, uploadPayload(slug)]),
);
const tempRoots: string[] = [];

export function temp(prefix: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

export function cleanupTemps() {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
}

function writeClosure(projectRoot: string, slug: string, payload = payloads.get(slug)!) {
  const root = path.join(projectRoot, 'supabase', 'functions', slug);
  for (const file of payload) {
    const destination = path.join(root, ...file.name.split('/'));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, file.content);
  }
  return root;
}

export function metadata(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `id-${slug}`,
    name: slug,
    slug,
    status: 'ACTIVE',
    version: 7,
    created_at: 1_777_000_000_000,
    updated_at: 1_777_000_001_000,
    verify_jwt: true,
    entrypoint_path: `supabase/functions/${slug}/index.ts`,
    ...overrides,
  };
}

export function prerequisite(overrides: Record<string, unknown> = {}) {
  return {
    ...Object.fromEntries(RUNE_TRIAL_PREREQUISITE_FIELDS.map(field => [field, true])),
    ...overrides,
  };
}

export function readyProductionRead(
  events?: string[],
  overrides: {
    history?: boolean;
    schema?: Record<string, unknown>;
    functions?: Record<string, unknown>;
    job?: Record<string, unknown>;
    equipped?: Record<string, unknown>;
    bots?: Record<string, unknown>;
  } = {},
) {
  const schema = {
    profile_progression: true, match_protocol: true, queue_protocol: true,
    player_runes_table: true, match_actions_table: true, private_tables: true,
    indexes: true, policies: true, table_grants: true, private_tables_locked: true,
    realtime_publication: true, cron_extension: true, ...overrides.schema,
  };
  const functions = {
    function_contracts: true,
    function_bodies: true,
    function_grants: true,
    ...overrides.functions,
  };
  const job = { cron_job: true, cron_job_contract: true, ...overrides.job };
  const equipped = {
    queue_capability_constraint: true,
    match_constraints: true,
    function_contracts: true,
    function_bodies: true,
    service_grants: true,
    helper_lockdown: true,
    ...overrides.equipped,
  };
  const bots = {
    bot_count: 200,
    bots_with_runes: 155,
    bots_equipped: 155,
    bots_with_runes_without_seat: 0,
    bots_without_runes_with_seat: 0,
    bot_seat_not_owned: 0,
    ...overrides.bots,
  };
  return async (query: string, parameters: unknown[] = []) => {
    if (query === RANKED_RUNES_PRODUCTION_PREREQUISITE) {
      events?.push('prerequisite:ranked-history');
      assert.deepEqual(parameters, [RANKED_RUNES_MIGRATION_VERSION, RANKED_RUNES_MIGRATION_NAME]);
      return [{ migration_history: overrides.history ?? true }];
    }
    if (query === RUNE_TRIAL_PRODUCTION_PREREQUISITE) {
      events?.push('prerequisite:history');
      assert.deepEqual(parameters, [RUNE_TRIAL_MIGRATION_VERSION, RUNE_TRIAL_MIGRATION_NAME]);
      return [{ migration_history: overrides.history ?? true }];
    }
    assert.deepEqual(parameters, []);
    if (query === RUNE_TRIAL_SCHEMA) {
      events?.push('prerequisite:schema');
      return [schema];
    }
    if (query === RUNE_TRIAL_FUNCTIONS) {
      events?.push('prerequisite:functions');
      return [functions];
    }
    if (query === RUNE_TRIAL_JOB) {
      events?.push('prerequisite:cron');
      return [job];
    }
    if (query === EQUIPPED_RANKED_SCHEMA) {
      events?.push('prerequisite:equipped-schema');
      return [equipped];
    }
    if (query === EQUIPPED_RANKED_BOT_DATA) {
      events?.push('prerequisite:bot-data');
      return [bots];
    }
    return assert.fail('unexpected production prerequisite query');
  };
}

export function makeRunner({ corruptSlug }: { corruptSlug?: string } = {}) {
  const events: string[] = [];
  const readbackRoots: string[] = [];
  let activeSlug = '';
  const runner = {
    capture(command: string, args: string[]) {
      if (command === 'git' && args.join(' ') === 'rev-parse --show-toplevel') return ROOT;
      if (command === 'git' && args.join(' ') === 'branch --show-current') return 'main';
      if (command === 'git' && args[0] === 'ls-files') return args.slice(args.indexOf('--') + 1).join('\n');
      if (command === 'git' && args[0] === 'status') return '';
      if (command === CLI && args.join(' ') === '--version') return FUNCTION_CLI_VERSION;
      if (command === CLI && args[0] === 'functions' && args[1] === 'list') {
        events.push(`list:${activeSlug}`);
        return JSON.stringify(FUNCTION_ROLLOUT_SLUGS.map(slug => metadata(slug)));
      }
      return assert.fail(`unexpected capture: ${command} ${args.join(' ')}`);
    },
    run(command: string, args: string[]) {
      assert.equal(command, CLI);
      const slug = args[2];
      if (args[1] === 'deploy') {
        activeSlug = slug;
        events.push(`deploy:${slug}`);
        const workdir = args[args.indexOf('--workdir') + 1];
        assert.deepEqual(
          readdirSync(path.join(workdir, 'supabase', 'functions')).sort(),
          [...FUNCTION_ROLLOUT_SLUGS].sort(),
          'deploy project carried a function outside the fixed allow-list',
        );
        assertExactDownloadedClosure(
          path.join(workdir, 'supabase', 'functions', slug), slug, payloads.get(slug),
        );
        return;
      }
      if (args[1] === 'download') {
        events.push(`download:${slug}`);
        const workdir = args[args.indexOf('--workdir') + 1];
        readbackRoots.push(workdir);
        const payload = payloads.get(slug)!.map(file => ({ ...file }));
        if (slug === corruptSlug) {
          payload[0] = { ...payload[0], content: `${payload[0].content}\ncorrupt` };
        }
        const functionRoot = writeClosure(workdir, slug, payload);
        for (const name of supabaseReadbackOmissionPaths(slug)) {
          rmSync(path.join(functionRoot, ...name.split('/')), { force: true });
        }
        return;
      }
      return assert.fail(`unexpected run: ${command} ${args.join(' ')}`);
    },
  };
  return { events, readbackRoots, runner };
}
