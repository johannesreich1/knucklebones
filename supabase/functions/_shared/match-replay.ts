/* ONE authoritative replay for both ranked protocols.

   pvp-join (settling a bot's abandoned match) and pvp-claim (a forfeit or a
   resignation) both have to answer the same question before they end a match:
   what does the authoritative log score for each seat, and does it still
   replay to the match row this request read? They used to answer it with
   byte-identical code in two places, down to a private copy of the action
   column list.

   The split is the one _shared/auto-forfeit.ts already drew: everything that
   is identical lives here, and what genuinely differs — how a refusal is
   REPORTED — stays with the caller. So this returns a reason rather than a
   Response: join skips the forfeit on any of them, while claim maps them to
   three different HTTP answers.

   Kept out of any function directory so both closures upload one copy. */
import { matchTotal, rebuild } from "../core/match.ts";
import {
  rankedActionTotal,
  rebuildRankedActions,
  type RankedActionRow,
} from "../core/ranked-actions.ts";
import { RUNE_TRIAL_FORMAT } from "../core/ranked-outcomes.ts";
import { AI, ME, type Mode } from "../core/rules.ts";
import type { EdgeClient } from "./http.ts";
import type { MatchMoveRow, MatchRow } from "./types.ts";

/* The action columns a replay consumes, declared once for every caller.
   _shared/rune-trial-bot-opening.ts keeps its own list on purpose: it selects
   a superset (created_at) for a different job, and folding the two together
   would widen this read. Keep this as one literal: PostgREST's select parser
   loses the row shape when concatenation widens the query to `string`. */
const ACTION_COLUMNS =
  "idx, move_idx, who, kind, rune_id, target_col, placed_col, die_before, die_after";

/** Both seats scored from the log, and the move count they were read at. */
export interface AuthoritativeReplay {
  p1Score: number;
  p2Score: number;
  moveCount: number;
}

/**
 * Why no trustworthy snapshot could be produced.
 * - `read-failed`: a table read errored, so nothing at all is known.
 * - `corrupt-state`: the stored rows contradict the schema (no seed row, a
 *   Trial match with no runes) and no retry can help.
 * - `stale`: the log no longer replays to the row it was read against, so
 *   someone committed underneath this request.
 */
export type ReplayRejection = "read-failed" | "corrupt-state" | "stale";

export type AuthoritativeReplayOutcome =
  | ({ ok: true } & AuthoritativeReplay)
  | { ok: false; reason: ReplayRejection; detail?: string };

/**
 * Read the authoritative log for `match` and score both seats from it.
 *
 * The caller passes the replay `mode` because it has already resolved the
 * match's ranked outcome and owns how an unknown one is reported.
 *
 * A match still in selection has no log to replay: both seats score zero and
 * the move count is the log's own length, which is what a settlement
 * precondition has to pin.
 */
export async function replayAuthoritativeMatch(
  svc: EdgeClient,
  match: MatchRow,
  mode: Mode,
): Promise<AuthoritativeReplayOutcome> {
  const [{ data: moveData, error: moveError }, { data: actionData, error: actionError },
    { data: seedData, error: seedError }] = await Promise.all([
    svc.from("match_moves").select("idx, who, col").eq("match_id", match.id),
    svc.from("match_actions").select(ACTION_COLUMNS).eq("match_id", match.id),
    svc.from("match_seeds").select("seed").eq("match_id", match.id).single(),
  ]);
  if (moveError || actionError || seedError) {
    return {
      ok: false,
      reason: "read-failed",
      detail: (moveError ?? actionError ?? seedError)?.message,
    };
  }
  const moves = (moveData ?? []) as MatchMoveRow[];
  const seedRow = seedData as { seed: string } | null;
  if (!seedRow) return { ok: false, reason: "corrupt-state" };
  if (match.phase !== "playing") {
    return { ok: true, p1Score: 0, p2Score: 0, moveCount: moves.length };
  }
  if (match.format === RUNE_TRIAL_FORMAT) {
    if (!match.p1_rune || !match.p2_rune) return { ok: false, reason: "corrupt-state" };
    const actions = (actionData ?? []) as RankedActionRow[];
    const state = rebuildRankedActions(
      seedRow.seed, actions, mode, [match.p2_rune, match.p1_rune],
    );
    if (!state || state.actionCount !== match.action_version || state.moveCount !== moves.length
        || state.turn !== match.turn || state.nextDie !== match.next_die
        || state.pendingAim !== match.pending_aim) {
      return { ok: false, reason: "stale" };
    }
    return {
      ok: true,
      p1Score: rankedActionTotal(state, ME, mode),
      p2Score: rankedActionTotal(state, AI, mode),
      moveCount: state.moveCount,
    };
  }
  const state = rebuild(seedRow.seed, moves, mode);
  if (!state || state.moveCount !== moves.length || state.turn !== match.turn
      || state.nextDie !== match.next_die) {
    return { ok: false, reason: "stale" };
  }
  return {
    ok: true,
    p1Score: matchTotal(state, ME, mode),
    p2Score: matchTotal(state, AI, mode),
    moveCount: moves.length,
  };
}
