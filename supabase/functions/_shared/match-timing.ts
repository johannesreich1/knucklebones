/* One stall policy for every ranked surface. An honest visible client places
   for itself at 10s and says so. AUTO_MS gates only a RECOVERY — one party
   placing for the other — where the server wants proof the app is gone before
   it moves somebody else's die; placing on your own turn needs no such proof
   and is never gated. STALL_MS is the longer threshold before a human opponent
   may claim, or an abandoned bot match is settled lazily. The SQL commit gates
   re-check AUTO_MS against the database clock, so the migration intervals must
   stay consistent with this module — the parity is pinned by
   tests/edge-handlers.test.ts. */
export const AUTO_MS = 12 * 1000;
export const STALL_MS = 30 * 1000;

/* How many consecutive automatic placements cover a short absence before the
   match is lost. Two land as real moves; the third is the forfeit instead of a
   move, so an away player always spends exactly two turns being played for.

   This is a count and not a wall clock on purpose. Every automatic placement
   writes last_move_at, so any seconds-based threshold measured from it — the
   one STALL_MS uses — resets before it can be reached and can never forfeit a
   client that is still auto playing. The cadence is not stable either: the
   visible turn clock fires ONLINE_TURN_SECS after the turn RENDERS, which
   trails last_move_at by however long the bot-reply animation ran, while the
   watchdog paths fire on their own 13s threshold quantized to a 5s tick. A
   count is identical on all of them. */
export const AUTO_FORFEIT_STREAK = 3;

/** Would the next automatic placement be the forfeiting one? */
export function autoPlacementForfeits(priorStreak: number): boolean {
  return priorStreak + 1 >= AUTO_FORFEIT_STREAK;
}
