import { AI, ME, type Player } from "./core/rules.ts";
import { settle, type Score } from "./core/ladder.ts";
import { rankedOutcomeByMatch } from "./core/ranked-outcomes.ts";
import type { EdgeClient } from "../_shared/http.ts";
import { replayAuthoritativeMatch } from "../_shared/match-replay.ts";
import { STALL_MS } from "../_shared/match-timing.ts";
import { settleMatch } from "../_shared/settlement.ts";
import type { MatchRow } from "../_shared/types.ts";

/**
 * A bot has no client to claim a human's abandoned match, so matchmaking
 * applies the same loss lazily when that human returns.
 *
 * Answers one question: is this match still the player's to resume? Every
 * reason not to settle — it is not their turn, the stall threshold has not
 * passed, the opponent is human, the rules are unknown, the log no longer
 * matches the row — is silent and returns false, because the join then simply
 * hands the match back as it stands.
 */
export async function settleAbandonedBotMatch(
  svc: EdgeClient,
  match: MatchRow,
  viewerId: string,
): Promise<boolean> {
  const oppId = match.p1 === viewerId ? match.p2 : match.p1;
  const myIdx: Player = match.p1 === viewerId ? ME : AI;
  if (match.phase !== "playing" || match.turn !== myIdx) return false;
  if (Date.now() - new Date(match.last_move_at).getTime() < STALL_MS) return false;
  const { data: opponentData, error: opponentError } = await svc.from("profiles")
    .select("is_bot").eq("id", oppId).maybeSingle();
  if (opponentError || !(opponentData as { is_bot?: boolean } | null)?.is_bot) return false;
  let outcome;
  try { outcome = rankedOutcomeByMatch(match.format, match.modifier); }
  catch (error) {
    console.error("pvp-join found an unknown ranked outcome:", error);
    return false;
  }
  const replay = await replayAuthoritativeMatch(svc, match, outcome.mode);
  if (!replay.ok) return false;
  const p1Result: Score = myIdx === ME ? 0 : 1;
  /* Settle against the very snapshot the replay was taken at, so a real move
     racing this decision wins the write instead of being overwritten by it. */
  const result = await settleMatch(svc, match, {
    status: "forfeit",
    winner: oppId,
    p1Score: replay.p1Score,
    p2Score: replay.p2Score,
    p1Result,
  }, settle, {
    turn: match.turn,
    lastMoveAt: match.last_move_at,
    moveCount: replay.moveCount,
  });
  return result.match.status !== "active";
}
