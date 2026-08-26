/* One stall policy for every ranked surface. An honest visible client places
   for itself at 10s; AUTO_MS gives the server two extra seconds of proof that
   the app is gone before it recovers a turn, and STALL_MS is the longer
   threshold before a human opponent may claim or be forfeited. The SQL commit
   gates re-check AUTO_MS against the database clock, so the migration
   intervals must stay consistent with this module — the parity is pinned by
   tests/edge-handlers.test.ts. */
export const AUTO_MS = 12 * 1000;
export const STALL_MS = 30 * 1000;
