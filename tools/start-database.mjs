// Start only the disposable services needed by the SQL contract gate.
//
// Edge Function source deliberately imports the shared root core through the
// materialized deploy closure (tools/fnfiles.mjs). Recent Supabase CLIs inspect
// those raw function directories even when edge-runtime is excluded, before
// PostgreSQL starts. A temporary database-only project keeps that deployment
// concern out of the database gate while preserving the same project id,
// config, and immutable migration ledger.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'supabase');
const TEMP_ROOT = mkdtempSync(path.join(os.tmpdir(), 'knucklebones-db-'));
const TEMP_PROJECT = path.join(TEMP_ROOT, 'supabase');
const SUPABASE = process.env.SUPABASE_BIN || 'supabase';

// pgTAP and schema lint connect directly to PostgreSQL. Database roles,
// auth/storage schemas, extensions, and migrations live in that image; none of
// the HTTP/runtime services below participate in these contracts.
const EXCLUDED_SERVICES = [
  'gotrue',
  'realtime',
  'storage-api',
  'imgproxy',
  'kong',
  'mailpit',
  'postgrest',
  'postgres-meta',
  'studio',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
];

let status = 1;
try {
  cpSync(SOURCE, TEMP_PROJECT, {
    recursive: true,
    filter(source) {
      const relative = path.relative(SOURCE, source);
      if (!relative) return true;
      const owner = relative.split(path.sep)[0];
      return !['.branches', '.temp', 'functions', 'snapshots', 'tests'].includes(owner);
    },
  });
  const result = spawnSync(SUPABASE, [
    'start',
    '--workdir', TEMP_ROOT,
    '--exclude', EXCLUDED_SERVICES.join(','),
  ], { cwd: ROOT, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
}

process.exit(status);
