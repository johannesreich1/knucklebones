/* One auto-forfeit decision and one settlement for both ranked protocols.
   pvp-move and pvp-action replay different logs, so each supplies its own
   scores; everything else about ending an away player's match is identical
   and belongs here rather than in two near-copies that can drift.

   Seats: ME (1) is p1 and AI (0) is p2, the same mapping the commit RPCs use
   when they check turn ownership. This module stays free of ./core so it can
   live in _shared, which is why it speaks PlayerIndex rather than Player. */
import type { EdgeClient } from "./http.ts";
import { autoPlacementForfeits } from "./match-timing.ts";
import {
  settleMatch,
  type LadderSettlement,
  type SettlementPrecondition,
  type SettlementResult,
} from "./settlement.ts";
import type { MatchRow, PlayerIndex } from "./types.ts";

/** Consecutive automatic placements already committed for one seat. */
export function autoStreakOf(match: MatchRow, seat: PlayerIndex): number {
  return seat === 1 ? match.p1_auto_streak : match.p2_auto_streak;
}

/** Would placing automatically for this seat now be one absence too many? */
export function autoForfeitsNow(match: MatchRow, mover: PlayerIndex): boolean {
  return autoPlacementForfeits(autoStreakOf(match, mover));
}

/**
 * End the match against the away seat through the one settlement contract
 * every other terminal path uses. The precondition is the same checked
 * snapshot pvp-claim takes, so a real move racing this decision loses the
 * settlement rather than being overwritten by it.
 */
export function settleAutoForfeit(
  service: EdgeClient,
  match: MatchRow,
  mover: PlayerIndex,
  p1Score: number,
  p2Score: number,
  precondition: SettlementPrecondition,
  calculate: LadderSettlement,
): Promise<SettlementResult> {
  const moverIsP1 = mover === 1;
  return settleMatch(service, match, {
    status: "forfeit",
    winner: moverIsP1 ? match.p2 : match.p1,
    p1Score,
    p2Score,
    p1Result: moverIsP1 ? 0 : 1,
  }, calculate, precondition);
}
