import { AI, ME, type Player } from "./core/rules.ts";
import { settle, type Score } from "./core/ladder.ts";
import { RUNE_TRIAL_FORMAT, rankedOutcomeByMatch } from "./core/ranked-outcomes.ts";
import { json, type AuthenticatedContext, type EdgeClient } from "../_shared/http.ts";
import { replayAuthoritativeMatch, type ReplayRejection } from "../_shared/match-replay.ts";
import { STALL_MS } from "../_shared/match-timing.ts";
import { settleMatch, type SettlementPrecondition } from "../_shared/settlement.ts";
import {
  MATCH_COLUMNS,
  type ClaimInput, type MatchRow,
} from "../_shared/types.ts";

/* What a claim answers when the shared replay refuses. Only the wording of
   these three lines is claim's own: pvp-join collapses the same reasons to
   "leave the match alone". */
const REPLAY_FAILURES: Record<ReplayRejection, { error: string; status: number }> = {
  "read-failed": { error: "match-read-failed", status: 500 },
  "corrupt-state": { error: "corrupt-state", status: 500 },
  /* A move landed under this claim, so the log no longer replays to the row
     it was read against. The bounded client retry reloads and claims the
     newer authoritative state. */
  "stale": { error: "race-lost", status: 409 },
};

async function finishClaim(
  svc: EdgeClient,
  match: MatchRow,
  p1Score: number,
  p2Score: number,
  winnerId: string,
  precondition?: SettlementPrecondition,
): Promise<Response> {
  const p1Result: Score = winnerId === match.p1 ? 1 : 0;
  const result = await settleMatch(svc, match, {
    status: "forfeit",
    winner: winnerId,
    p1Score,
    p2Score,
    p1Result,
  }, settle, precondition);
  if (!result.applied && result.match.status === "active") {
    return json({ error: "race-lost" }, 409);
  }
  return json({ match: result.match, ...(result.reward ? { reward: result.reward } : {}) });
}

export async function claimMatch(context: AuthenticatedContext, input: ClaimInput): Promise<Response> {
  const { user } = context;
  const svc = context.service();
  const { data, error: matchError } = await svc.from("matches")
    .select(MATCH_COLUMNS).eq("id", input.matchId).maybeSingle();
  if (matchError) {
    console.error("pvp-claim match read failed:", matchError.message);
    return json({ error: "match-read-failed" }, 500);
  }
  const match = data as MatchRow | null;
  if (!match || (match.p1 !== user.id && match.p2 !== user.id)) return json({ error: "no-match" }, 404);
  if (match.status !== "active") return json({ error: "match-over" }, 409);
  if (match.format === RUNE_TRIAL_FORMAT && match.rune_rules_version !== 1) {
    return json({ error: "unsupported-rune-rules" }, 409);
  }
  const myIdx: Player = match.p1 === user.id ? ME : AI;
  const oppId = myIdx === ME ? match.p2 : match.p1;
  if (match.phase === "selection" && !input.resign) {
    return json({ error: "selection-in-progress" }, 409);
  }
  if (!input.resign) {
    if (match.turn === myIdx) return json({ error: "your-own-turn" }, 409);
    /* A bot never forfeits. Its stalled turn is recovered through pvp-move's
       auto path, which plays the missing move rather than awarding a win. */
    const { data: oppProf, error: profileError } = await svc.from("profiles")
      .select("is_bot").eq("id", oppId).maybeSingle();
    if (profileError) {
      console.error("pvp-claim profile read failed:", profileError.message);
      return json({ error: "profile-read-failed" }, 500);
    }
    if ((oppProf as { is_bot?: boolean } | null)?.is_bot) return json({ error: "opponent-is-a-bot" }, 409);
    if (Date.now() - new Date(match.last_move_at).getTime() < STALL_MS) {
      return json({ error: "not-stalled-yet" }, 425);
    }
  }

  let outcome;
  try { outcome = rankedOutcomeByMatch(match.format, match.modifier); }
  catch (error) {
    console.error("pvp-claim found an unknown ranked outcome:", error);
    return json({ error: "corrupt-state" }, 500);
  }
  const replay = await replayAuthoritativeMatch(svc, match, outcome.mode);
  if (!replay.ok) {
    if (replay.reason === "read-failed") {
      console.error("pvp-claim replay read failed:", replay.detail);
    }
    const failure = REPLAY_FAILURES[replay.reason];
    return json({ error: failure.error }, failure.status);
  }
  const { p1Score, p2Score, moveCount } = replay;

  const winnerId = input.resign ? oppId : user.id;
  // Resignation is intentional, but its score snapshot must still be from the
  // same log version that the terminal write locks. A move racing this replay
  // makes the checked settlement return race-lost; the bounded client retry
  // then reloads and resigns against the newer authoritative state.
  return finishClaim(svc, match, p1Score, p2Score, winnerId, {
    turn: match.turn,
    lastMoveAt: match.last_move_at,
    moveCount,
  });
}
