// Materialize the exact deployable pvp-join start closure for Node owner tests.
// Authored Edge imports point at generated ./core files, so direct importing
// start.ts would test a shape which cannot exist outside its upload payload.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EdgeClient } from '../../supabase/functions/_shared/http.ts';
import type { MatchRow } from '../../supabase/functions/_shared/types.ts';
import { uploadPayload } from '../../tools/fnfiles.mjs';

export interface ProgressiveStartInput {
  requester: string;
  season: number;
  underdog: string;
  favourite: string;
  queuedOpponent: string | null;
  underdogAccess: {
    tier: 'stone' | 'bone' | 'ivory' | 'gold';
    entitlementIds?: readonly string[];
    capabilities: readonly string[];
  };
  favouriteAccess: {
    tier: 'stone' | 'bone' | 'ivory' | 'gold';
    entitlementIds?: readonly string[];
    capabilities: readonly string[];
  };
  bot?: { id: string; points: number; apex: boolean };
  curveVersion: 1 | 2;
  scoringVersion: 1 | 2;
  entryKind: 'ordinary' | 'weekly';
  weeklyRotationId: string | null;
  botDebutOutcome: string | null;
}

export type ProgressiveStart = (
  service: EdgeClient,
  input: ProgressiveStartInput,
) => Promise<{ match: MatchRow; botMove: { col: number; die: number } | null } | null>;

export async function materializeProgressiveStart(): Promise<{
  start: ProgressiveStart;
  dispose(): void;
}> {
  const root = mkdtempSync(path.join(tmpdir(), 'knucklebones-progression-v2-start-'));
  for (const file of uploadPayload('pvp-join')) {
    const target = path.resolve(root, file.name);
    if (!target.startsWith(root + path.sep)) throw new Error('Edge fixture escaped its temp root');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  const module = await import(pathToFileURL(path.join(root, 'start.ts')).href) as {
    startProgressiveRankedMatch: ProgressiveStart;
  };
  return {
    start: module.startProgressiveRankedMatch,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
