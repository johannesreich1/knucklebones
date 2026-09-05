import type { EdgeClient } from "../_shared/http.ts";

/* HOW LONG A SEAT OUTLIVES ITS PLAYER.
 *
 * The waiting client re-calls pvp-join every second (2.5s on builds before
 * 2026-09-05; queue-screen.ts) and matchmaking_queue stamps last_seen_at on
 * every write, so a row silent this long has no app behind it: the tab is
 * closed, the process was killed or suspended, or the network is gone.
 *
 * THIS IS THE SLOW RULE, AND IT IS NOT WHAT KEEPS GHOSTS OUT OF MATCHES.
 * Deleting is the one thing that must be conservative: sweep a live player and
 * they lose their place in line — and it is whoever has waited LONGEST who
 * loses it, because a slow network is exactly when polls go missing. So this
 * waits 30s, twelve polls of the oldest installed cadence. What actually stops
 * a real player being paired with an empty seat is matchmaking.ts's
 * PARTNER_FRESH_MS (8s): a seat not heard from that recently is simply not
 * offered, which costs nobody anything. Between the two windows a ghost sits
 * in the table unoffered until this removes it.
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
