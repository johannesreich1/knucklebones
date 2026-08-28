/* The release gate keeps the historical entry point (run.mjs registers it as
   "bounty-mint"), while each player-visible BO2 contract owns one focused
   module beside it. */
import { assertBountyMintSourceContract } from './bounty-mint-contract.mjs';
import { runBountyClassicControlScenario, runBountyRestartScenario } from './bounty-mint-boundaries.mjs';
import { runBountyMintReducedMotionScenarios } from './bounty-mint-reduced-motion.mjs';
import { runBountyMintStrikeScenarios } from './bounty-mint-strike.mjs';
import { runBountyMintSunderScenarios } from './bounty-mint-sunder.mjs';

export async function runBountyMintScenarios(suite) {
  const { out, check } = suite;
  /* The authored source is pinned once, before any choreography, because the
     browser beats below are only meaningful against constants that still say
     what the 3.6s review crop selected. */
  assertBountyMintSourceContract({ out, check });
  /* Original beat order, kept deliberately: these all share one page and one
     authoritative state, and run.mjs guards the room between SCENARIOS, never
     between the beats inside one. */
  await runBountyMintStrikeScenarios(suite);
  await runBountyClassicControlScenario(suite);
  await runBountyMintSunderScenarios(suite);
  await runBountyMintReducedMotionScenarios(suite);
  await runBountyRestartScenario(suite);
}
