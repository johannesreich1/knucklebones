import type { EdgeClient } from "../_shared/http.ts";
import type { JoinInput, MatchRow } from "../_shared/types.ts";

export interface QueueCandidate {
  player_id: string;
  created_at: string;
  /** Defaults keep rows queued by an older function safely on protocol v1. */
  protocol_version?: 1 | 2;
  capabilities?: string[];
  pool_tier?: "stone" | "bone" | "ivory";
}

interface RatingRow {
  id: string;
  rating: number | null;
}

/** Ranked always seats the lower-rated participant as p1, including bots. */
export function rankedSeatOrder(underdog: string, favourite: string) {
  return { p1: underdog, p2: favourite } as const;
}

/** Lower rating opens; preserve the existing bot-opening tiebreak at equality.
 *
 * Opening balance belongs to the bot policy, not to a human-always-opens
 * exception. In particular, a 0–0 bot may still open against a newcomer. */
export function rankedBotSides(
  humanId: string,
  humanRating: number,
  botId: string,
  botRating: number,
) {
  const humanOpens = humanRating < botRating;
  return humanOpens
    ? { underdog: humanId, favourite: botId } as const
    : { underdog: botId, favourite: humanId } as const;
}

export function negotiatedProtocolVersion(
  accesses: readonly { capabilities?: readonly string[] }[],
): 1 | 2 {
  return accesses.every(({ capabilities }) => capabilities?.includes("rune_trial_v1")) ? 2 : 1;
}

export function trialClientCompatibilityError(
  match: MatchRow,
  input: JoinInput,
): "unsupported-rune-rules" | "incompatible-client" | null {
  if (match.format !== "rune_trial") return null;
  if (match.rune_rules_version !== 1) return "unsupported-rune-rules";
  return input.protocolVersion === 2 && input.capabilities.includes("rune_trial_v1")
    ? null : "incompatible-client";
}

/** Select the oldest queued player whose current rating is inside the band. */
export function oldestEligibleCandidate(
  queue: readonly QueueCandidate[],
  ratings: ReadonlyMap<string, number>,
  playerRating: number,
  band: number,
): QueueCandidate | null {
  return [...queue]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .find((candidate) => {
      const rating = ratings.get(candidate.player_id);
      return rating !== undefined && Math.abs(rating - playerRating) <= band;
    }) ?? null;
}

/**
 * Read the queue in age order, then apply the caller's computed rating band.
 * The eventual start_ranked_match RPC locks and consumes both queue rows in
 * the same transaction as match creation.
 */
export async function findOldestEligiblePartner(
  svc: EdgeClient,
  playerId: string,
  playerRating: number,
  band: number,
): Promise<QueueCandidate | null> {
  const { data: queueData, error: queueError } = await svc.from("matchmaking_queue")
    .select("player_id, created_at, protocol_version, capabilities, pool_tier")
    .neq("player_id", playerId)
    .order("created_at", { ascending: true });
  if (queueError) throw new Error(`queue read failed: ${queueError.message}`);
  const queue = (queueData ?? []) as QueueCandidate[];
  if (queue.length === 0) return null;

  const { data: profileData, error: profileError } = await svc.from("profiles")
    .select("id, rating")
    .in("id", queue.map((candidate) => candidate.player_id));
  if (profileError) throw new Error(`queued rating read failed: ${profileError.message}`);
  const ratings = new Map(
    ((profileData ?? []) as RatingRow[]).map((profile) => [profile.id, profile.rating ?? 0]),
  );
  return oldestEligibleCandidate(queue, ratings, playerRating, band);
}
