import { AI, ME, type Player } from "./core/rules.ts";
import { rebuild, matchTotal, type MatchState } from "./core/match.ts";
import { settle, type Score } from "./core/ladder.ts";
import { modeById } from "./core/modes.ts";
import { json, type AuthenticatedContext, type EdgeClient } from "../_shared/http.ts";
import { settleMatch } from "../_shared/settlement.ts";
import type { ClaimInput, MatchMoveRow, MatchRow } from "../_shared/types.ts";

const STALL_MS = 30 * 1000;
const MATCH_COLS = "id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier, season_id";

async function finishClaim(
  svc: EdgeClient,
  match: MatchRow,
  state: MatchState,
  winnerId: string,
): Promise<Response> {
  const mode = modeById(match.modifier).mode;
  const p1Score = matchTotal(state, ME, mode), p2Score = matchTotal(state, AI, mode);
  const p1Result: Score = winnerId === match.p1 ? 1 : 0;
  const result = await settleMatch(svc, match, {
    status: "forfeit",
    winner: winnerId,
    p1Score,
    p2Score,
    p1Result,
  }, settle);
  return json({ match: result.match });
}

export async function claimMatch(context: AuthenticatedContext, input: ClaimInput): Promise<Response> {
  const { user } = context;
  const svc = context.service();
  const { data } = await svc.from("matches").select(MATCH_COLS).eq("id", input.matchId).maybeSingle();
  const match = data as MatchRow | null;
  if (!match || (match.p1 !== user.id && match.p2 !== user.id)) return json({ error: "no-match" }, 404);
  if (match.status !== "active") return json({ error: "match-over" }, 409);
  const myIdx: Player = match.p1 === user.id ? ME : AI;
  const oppId = myIdx === ME ? match.p2 : match.p1;
  if (!input.resign) {
    if (match.turn === myIdx) return json({ error: "your-own-turn" }, 409);
    /* A bot never forfeits. Its stalled turn is recovered through pvp-move's
       auto path, which plays the missing move rather than awarding a win. */
    const { data: oppProf } = await svc.from("profiles").select("is_bot").eq("id", oppId).maybeSingle();
    if ((oppProf as { is_bot?: boolean } | null)?.is_bot) return json({ error: "opponent-is-a-bot" }, 409);
    if (Date.now() - new Date(match.last_move_at).getTime() < STALL_MS) {
      return json({ error: "not-stalled-yet" }, 425);
    }
  }

  const mode = modeById(match.modifier).mode;
  const { data: moveData } = await svc.from("match_moves").select("idx, who, col").eq("match_id", match.id);
  const moves = (moveData ?? []) as MatchMoveRow[];
  const { data: seedData } = await svc.from("match_seeds").select("seed").eq("match_id", match.id).single();
  const seedRow = seedData as { seed: string } | null;
  const state = seedRow && rebuild(seedRow.seed, moves, mode);
  if (!state) return json({ error: "corrupt-state" }, 500);

  const winnerId = input.resign ? oppId : user.id;
  return finishClaim(svc, match, state, winnerId);
}
