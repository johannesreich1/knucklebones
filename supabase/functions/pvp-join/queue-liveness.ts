import type { EdgeClient } from "../_shared/http.ts";

/* HOW LONG A SEAT OUTLIVES ITS PLAYER.
 *
 * The waiting client re-calls pvp-join every 2.5s (queue-screen.ts) and
 * matchmaking_queue stamps last_seen_at on every write, so a row that has been
 * silent this long has no app behind it: the tab is closed, the process was
 * killed, or the network is gone. Until it is swept it is MATCHABLE, and the
 * real player who pairs with it is made to play a ghost — twelve seconds a turn
 * of server auto-placements until it settles as a forfeit about 36s later
 * (_shared/match-timing.ts). The window IS that exposure, so it wants to be
 * small.
 *
 * 30s rather than the 2.5s poll, because the two errors do not cost the same.
 * Sweeping a live player only costs them their place in line — but it costs it
 * to whoever has been waiting LONGEST, and a slow network is exactly when that
 * happens. Twelve missed polls is a dead client, not a slow one.
 *
 * This used to read created_at, which is the queue POSITION and which a re-join
 * deliberately never moves. It therefore measured time since JOINING and could
 * not see abandonment at all: a player killed 30s ago looked identical to one
 * who joined 30s ago, and the sweep could only wait out the whole two minutes.
 * Worse, it ran BEFORE the caller was enqueued, so a player waiting longer than
 * the window had their own row deleted by their own next poll and re-inserted
 * at the back of the line. See 20260905101500_queue_liveness_heartbeat.sql. */
const QUEUE_LIVENESS_MS = 30 * 1000;

/** Drop seats whose client has stopped proving it is there.
 *  → true when the sweep ran; false when it failed and the join must abort. */
export async function sweepAbandonedSeats(svc: EdgeClient): Promise<boolean> {
  const { error } = await svc.from("matchmaking_queue").delete()
    .lt("last_seen_at", new Date(Date.now() - QUEUE_LIVENESS_MS).toISOString());
  return !error;
}
