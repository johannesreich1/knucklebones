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
 * Claiming remains a separate guarded delete so two joiners cannot seat the
 * same opponent.
 */
export async function findOldestEligiblePartner(
  svc: EdgeClient,
  playerId: string,
  playerRating: number,
  band: number,
): Promise<QueueCandidate | null> {
  const { data: queueData } = await svc.from("matchmaking_queue")
    .select("player_id, created_at")
    .neq("player_id", playerId)
    .order("created_at", { ascending: true });
  const queue = (queueData ?? []) as QueueCandidate[];
  if (queue.length === 0) return null;

  const { data: profileData } = await svc.from("profiles")
    .select("id, rating")
    .in("id", queue.map((candidate) => candidate.player_id));
  const ratings = new Map(
    ((profileData ?? []) as RatingRow[]).map((profile) => [profile.id, profile.rating ?? 0]),
  );
  return oldestEligibleCandidate(queue, ratings, playerRating, band);
}
