import type { EdgeClient } from "../_shared/http.ts";

export interface QueueCandidate {
  player_id: string;
  created_at: string;
}

interface RatingRow {
  id: string;
  rating: number | null;
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
    .select("player_id, created_at")
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
