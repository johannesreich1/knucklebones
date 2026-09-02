// One owner-only read of the server's active ranked contract and this
// account's durable unlocks. The response is cached only after strict parsing,
// keeping offline locks and online admission on the same facts.
import { rankedOutcomeById } from '../../core/ranked-outcomes.ts';
import {
  writeProgressionStatusSnapshot,
  weeklyChallengeSnapshot,
  type LadderCurveVersion,
  type LadderScoringVersion,
  type ProgressionStatusSnapshot,
  type WeeklyChallengeSnapshot,
} from '../../progression-status-cache.ts';
import { currentUser } from '../identity/session.ts';
import { supa } from './client.ts';

export interface RankedProgressionStatus {
  readonly curveVersion: LadderCurveVersion;
  readonly scoringVersion: LadderScoringVersion;
  readonly admissionPaused: boolean;
  readonly outcomes: readonly string[];
  readonly weeklyUnlocked: boolean;
  readonly pendingBotDebuts: readonly string[];
  readonly neonMedalSeasons: readonly number[];
  readonly weekly: WeeklyChallengeSnapshot | null;
}

function knownOutcomes(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string') return null;
    try { rankedOutcomeById(id); } catch { return null; }
    if (ids.includes(id)) return null;
    ids.push(id);
  }
  return ids.includes('classic') ? Object.freeze(ids) : null;
}

function orderedSeasonIds(value: unknown): readonly number[] | null {
  if (!Array.isArray(value)) return null;
  const ids: number[] = [];
  for (const seasonId of value) {
    if (!Number.isSafeInteger(seasonId) || (seasonId as number) <= 0
        || ids.includes(seasonId as number)) return null;
    ids.push(seasonId as number);
  }
  return ids.every((seasonId, index) => index === 0 || ids[index - 1] < seasonId)
    ? Object.freeze(ids)
    : null;
}

export function progressionStatusFromRpc(value: unknown): RankedProgressionStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const outcomes = knownOutcomes(row.outcomes);
  const pending = knownOutcomes(['classic', ...(Array.isArray(row.pending_bot_debuts)
    ? row.pending_bot_debuts : [])]);
  const neonMedalSeasons = orderedSeasonIds(
    row.neon_medal_seasons ?? (row.curve_version === 1 ? [] : undefined),
  );
  const weekly = weeklyChallengeSnapshot(row.weekly);
  if ((row.curve_version !== 1 && row.curve_version !== 2)
      || (row.scoring_version !== 1 && row.scoring_version !== 2)
      || row.scoring_version !== row.curve_version
      || typeof row.admission_paused !== 'boolean'
      || typeof row.weekly_unlocked !== 'boolean'
      || !outcomes || !pending || !neonMedalSeasons || weekly === undefined) return null;
  if (!row.weekly_unlocked && weekly !== null) return null;
  return {
    curveVersion: row.curve_version,
    scoringVersion: row.scoring_version,
    admissionPaused: row.admission_paused,
    outcomes,
    weeklyUnlocked: row.weekly_unlocked,
    pendingBotDebuts: pending.filter((id) => id !== 'classic'),
    neonMedalSeasons,
    weekly,
  };
}

export async function refreshRankedProgressionStatus(): Promise<RankedProgressionStatus | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data, error } = await supa().rpc('ranked_progression_status');
  const status = error ? null : progressionStatusFromRpc(data);
  if (!status) return null;
  const cache: Omit<ProgressionStatusSnapshot, 'version' | 'confirmedAt'> = {
    accountId: user.id,
    ...status,
  };
  return writeProgressionStatusSnapshot(cache) ? status : null;
}
