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
import { confirmedLadderCurveVersion } from './progression-status-cache.ts';

export const currentBoardGroup = (points: number, apex: boolean) =>
  boardGroup(points, apex, confirmedLadderCurveVersion());

export const currentGroupFill = (points: number): number =>
  groupFill(points, confirmedLadderCurveVersion());

export const currentGroupRingFill = (points: number, apex: boolean): number =>
  groupRingFill(points, apex, confirmedLadderCurveVersion());

export const currentGroupRingPeakState = (
  points: number,
  peak: number,
  apex: boolean,
): PeakState => groupRingPeakState(points, peak, apex, confirmedLadderCurveVersion());

export const currentInApex = (
  points: number,
  rank: number,
  population: number,
): boolean => inApex(points, rank, population, confirmedLadderCurveVersion());
