// Pure coherence/retry boundary for Rune Trial's action-log + match-row read.
// PostgREST serves these as separate requests, so one transaction may land
// between them; a mismatched action version is a retry signal, never a board.
import type { RankedActionRow } from '../../core/ranked-actions.ts';
import type { MatchRow } from '../api/match-api.ts';

export interface TrialSnapshot {
  rows: RankedActionRow[];
  match: MatchRow;
}

export function trialSnapshotCoherent(snapshot: TrialSnapshot): boolean {
  return Number.isInteger(snapshot.match.action_version)
    && snapshot.match.action_version === snapshot.rows.length;
}

/** A Trial may settle during private selection before any die/action exists. */
export function isEmptyTerminalTrialSnapshot(
  snapshot: { rows: readonly RankedActionRow[]; match: MatchRow },
): boolean {
  return snapshot.match.status !== 'active'
    && snapshot.rows.length === 0
    && snapshot.match.action_version === 0;
}

export async function retryCoherentTrialSnapshot(
  read: () => Promise<TrialSnapshot | null>,
  wait: (attempt: number) => Promise<void>,
  attempts = 4,
): Promise<TrialSnapshot | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const snapshot = await read();
    if (snapshot && trialSnapshotCoherent(snapshot)) return snapshot;
    if (attempt + 1 < attempts) await wait(attempt + 1);
  }
  return null;
}
