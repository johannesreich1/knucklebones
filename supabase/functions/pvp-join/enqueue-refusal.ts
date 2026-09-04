/* WHY AN ENQUEUE FAILED, AS AN ANSWER THE CLIENT CAN ACT ON.
 *
 * enqueue_ranked_player_v3 raises for several unrelated reasons and pvp-join
 * used to collapse all of them into queue-failed 500, which the client reads as
 * an unreachable server and paints as CAN'T CONNECT. On 2026-09-04 that sent
 * players who needed to update to inspect their wifi instead, while the UPDATE
 * REQUIRED sheet they wanted sat unused — the client has always routed
 * `incompatible-client` there (queue-screen.ts).
 *
 * Kept beside the operation rather than inside it because it is a pure mapping
 * with no request in it, and because the operation was over its size budget:
 * one reason to change, one file.
 */

/** The subset of a PostgrestError this classification actually reads. */
export interface EnqueueFailure {
  readonly code?: string;
  readonly message?: string;
}

export type EnqueueRefusal =
  | { readonly error: "incompatible-client"; readonly status: 409 }
  | { readonly error: "ranked-paused"; readonly status: 503 }
  | { readonly error: "queue-failed"; readonly status: 500 };

/** 22023 is the RPC's own capability validation — an invalid capability array,
 * capabilities without protocol 2, a rune capability without its predecessor.
 * P0001 is a runtime refusal carrying several meanings, so it is read: the
 * curve ones mean the client is too old, admission means the ladder is shut and
 * already has an answer of its own. Anything else is a genuine failure. */
export function classifyEnqueueFailure(failure: EnqueueFailure | null): EnqueueRefusal {
  const code = failure?.code ?? "";
  const message = failure?.message ?? "";
  if (code === "22023" || /curve v2/i.test(message)) {
    return { error: "incompatible-client", status: 409 };
  }
  if (/admission is paused/i.test(message)) return { error: "ranked-paused", status: 503 };
  return { error: "queue-failed", status: 500 };
}
