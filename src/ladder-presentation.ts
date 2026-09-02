// Client-side ladder classification follows the last server-confirmed curve.
// Core ladder helpers default to the latest authority implementation, which is
// correct for new server code but unsafe during a staged web/database cutover.
// Every eager/profile surface comes through this small adapter instead of
// guessing whether persisted points are v1 or v2.
import {
  boardGroup,
  groupFill,
  groupRingFill,
  groupRingPeakState,
  inApex,
  type PeakState,
} from './core/ladder.ts';
import {
  confirmedLadderCurveVersion,
  type LadderCurveVersion,
} from './progression-status-cache.ts';

/* A cached row records the curve it was classified under. Passing that version
   keeps stale-but-coherent presentation truthful; passing nothing follows the
   last curve the server confirmed, which is what every live read wants. */
const curve = (version?: LadderCurveVersion): LadderCurveVersion =>
  version ?? confirmedLadderCurveVersion();

export const currentBoardGroup = (points: number, apex: boolean, version?: LadderCurveVersion) =>
  boardGroup(points, apex, curve(version));

export const currentGroupFill = (points: number, version?: LadderCurveVersion): number =>
  groupFill(points, curve(version));

export const currentGroupRingFill = (
  points: number,
  apex: boolean,
  version?: LadderCurveVersion,
): number => groupRingFill(points, apex, curve(version));

export const currentGroupRingPeakState = (
  points: number,
  peak: number,
  apex: boolean,
  version?: LadderCurveVersion,
): PeakState => groupRingPeakState(points, peak, apex, curve(version));

export const currentInApex = (
  points: number,
  rank: number,
  population: number,
  version?: LadderCurveVersion,
): boolean => inApex(points, rank, population, curve(version));
