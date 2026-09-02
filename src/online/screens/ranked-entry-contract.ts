// One freshly verified ranked-entry decision shared by Home and result replay.
// V2 needs exact account status; only a genuinely old server may retain the
// shipped v1 flow when the additive public scalar is absent.
import { activeWeeklyChallenge } from '../../progression-status-cache.ts';
import { activeRankedCurveVersion } from '../api/ladder-api.ts';
import type { RankedProgressionStatus } from '../api/progression-status-api.ts';

export type RankedEntryView = 'play' | 'weekly' | 'ladder' | 'account';

export async function verifyRankedEntryContract(
  view: RankedEntryView,
  progression: RankedProgressionStatus | null,
): Promise<boolean> {
  if (view === 'weekly') return activeWeeklyChallenge(progression) !== null;
  if (view !== 'play' || progression) return true;
  return await activeRankedCurveVersion() === 1;
}
