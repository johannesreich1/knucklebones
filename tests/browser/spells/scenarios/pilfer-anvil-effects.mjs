/* The release gate keeps the historical entry point, while each effect owns
   its player-visible contract in one focused module. */
import { runAnvilEffectScenarios } from './anvil-effects.mjs';
import { runPilferEffectScenarios } from './pilfer-effects.mjs';

export async function runPilferAnvilEffectScenarios(suite) {
  await runPilferEffectScenarios(suite);
  await runAnvilEffectScenarios(suite);
}
