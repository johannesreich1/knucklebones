// Resolve the active curve from the account-wide contract first, with the
// public scalar as the old-server/read-only compatibility seam.
import type { LadderCurveVersion } from '../../core/ladder.ts';
import { activeRankedCurveVersion } from './ladder-api.ts';
import { refreshRankedProgressionStatus } from './progression-status-api.ts';

export async function refreshVerifiedRankedCurveVersion(): Promise<
LadderCurveVersion | null
> {
  const status = await refreshRankedProgressionStatus();
  return status?.curveVersion ?? await activeRankedCurveVersion();
}
