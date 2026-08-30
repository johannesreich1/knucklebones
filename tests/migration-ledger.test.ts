import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { SUPABASE_PROJECT_REF } from '../src/config.ts';
import { emitReport } from './support/emit-report.mjs';

type LedgerManifest = {
  projectRef: string;
  fetchedAt: string;
  productionPrefixSha256: string;
  archivedLocalLedgerSha256: string;
  productionPrefix: string[];
  archivedLocalLedger: string[];
  retiredSeed: { file: string; sha256: string };
};

const ACTIVE = 'supabase/migrations';
const ARCHIVE = 'supabase/legacy-migrations';
const manifest = JSON.parse(
  readFileSync('supabase/migration-history.json', 'utf8'),
) as LedgerManifest;
const problems: string[] = [];
const check = (ok: boolean, message: string): void => {
  if (!ok) problems.push(message);
};
const sqlFiles = (directory: string): string[] => readdirSync(directory)
  .filter((file) => file.endsWith('.sql')).sort();
const ledgerHash = (directory: string, files: readonly string[]): string => {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file).update('\0').update(readFileSync(`${directory}/${file}`)).update('\0');
  }
  return hash.digest('hex');
};

const active = sqlFiles(ACTIVE);
const archived = existsSync(ARCHIVE) ? sqlFiles(ARCHIVE) : [];
const prefix = manifest.productionPrefix;
const activePrefix = active.slice(0, prefix.length);

check(manifest.projectRef === SUPABASE_PROJECT_REF,
  'migration-history.json does not name the application project');
check(/^\d{4}-\d{2}-\d{2}$/.test(manifest.fetchedAt),
  'migration-history.json has no reviewable fetch date');
check(JSON.stringify(activePrefix) === JSON.stringify(prefix),
  'active migrations do not begin with the canonical production history');
check(ledgerHash(ACTIVE, prefix) === manifest.productionPrefixSha256,
  'an applied migration changed after the production prefix was reviewed');
check(active.every((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)),
  'active migrations contain a compact, malformed, or non-timestamped filename');
check(new Set(active.map((file) => file.slice(0, 14))).size === active.length,
  'active migrations reuse a timestamp version');
const lastProductionVersion = prefix.at(-1)?.slice(0, 14) ?? '';
check(active.slice(prefix.length).every((file) => file.slice(0, 14) > lastProductionVersion),
  'a pending migration sorts inside or before the canonical production prefix');
check(JSON.stringify(archived) === JSON.stringify([...manifest.archivedLocalLedger].sort()),
  'the non-executable legacy archive does not match its manifest');
check(ledgerHash(ARCHIVE, manifest.archivedLocalLedger) === manifest.archivedLocalLedgerSha256,
  'a compact historical migration changed after it was archived');
check(!active.includes(manifest.retiredSeed.file),
  'the obsolete 12-bot seed is executable from the active migration ledger');
const retiredSeedPath = `${ARCHIVE}/${manifest.retiredSeed.file}`;
check(existsSync(retiredSeedPath), 'the obsolete 12-bot seed was not preserved in the archive');
if (existsSync(retiredSeedPath)) {
  const retiredSeed = readFileSync(retiredSeedPath);
  check(createHash('sha256').update(retiredSeed).digest('hex') === manifest.retiredSeed.sha256,
    'the archived 12-bot seed changed; its retirement evidence is no longer verbatim');
}

emitReport({
  productionPrefix: prefix.length,
  active: active.length,
  archived: archived.length,
  problems,
}, problems.length);
