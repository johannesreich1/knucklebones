/* The one server-side rune roster. src/core/spells.ts owns the registry, but
   handlers are Node-tested in place and only the deploy-materialized closure
   carries ./core, so they cannot import it directly. This literal list is the
   single server copy; tests/fnsync.test.ts pins it against RUNE_IDS from
   src/core/rune-trial-offer.ts so a new rune can never be client-complete but
   server-rejected. */
export const RUNE_IDS: readonly string[] = Object.freeze([
  "fate", "nudge", "ward", "sunder", "pilfer", "anvil",
]);
