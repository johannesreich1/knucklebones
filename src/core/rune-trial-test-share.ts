// TEMPORARY TEST WEIGHTING — DELETE THIS FILE BEFORE THE APP STORE SUBMISSION.
//
// Johannes asked for this on 2026-08-28: Rune Trial's pre-game sequence has to
// be judged by PLAYING it on the device, and at its real odds that means about
// one draw in twelve. So while the flow is being tuned, every draw that is
// allowed to contain a Trial gives it 60% and the ordinary outcomes share the
// rest in their normal proportions.
//
// REVERTING IS ONE LINE: set RUNE_TRIAL_TEST_SHARE to null. The draw goes back
// to the shipped weights and tests/ranked-outcomes.test.ts follows the constant
// to its permanent expectations without an edit. Deleting the file outright is
// a separate tidy-up and is NOT one line — it also needs the call and import in
// core/ranked-outcomes.ts removed, its draw loop restored to reading
// entry.weight, and this module's import dropped from that gate.
//
// It biases the DRAW, not the pool. `rankedOutcomePool` keeps the weights the
// game ships with, so the ladder's bot calibration (tests/botbench.test.ts)
// still measures the real ladder instead of being re-tuned for an experiment —
// and that bench is worth reading before this share is deployed anywhere: at
// 60%, IVORY's modelled novice-with-a-rune human takes only ~45% of outcomes,
// which makes the bots the favourites for as long as the share is live.
//
// WHAT THIS AFFECTS — both, because the odds have exactly one implementation:
//   · offline RANDOM, which ships INSIDE the app bundle (App Store payload),
//   · ranked matchmaking, once pvp-join is redeployed with this file in its
//     upload closure. Until that deploy the server keeps the permanent odds.
//
// docs/STATUS.md carries the revert as an open release blocker; docs/MODES.md
// states the permanent rule this temporarily suspends.

/** The Trial's share of every draw that may contain it; null = permanent odds. */
export const RUNE_TRIAL_TEST_SHARE: number | null = 0.6;

/** One weighted pool entry, as narrow as this file needs it — importing the
 *  ranked types back would make the module that calls this depend on it. */
interface Weighted {
  readonly outcome: { readonly id: string };
  readonly weight: number;
}

/**
 * Draw weights carrying the test share, or the pool's own weights when the
 * override is off or there is no Trial to hold. Percent arithmetic keeps the
 * result exact: the Trial takes `percent` parts of the rest, and every ordinary
 * weight is scaled by the remaining `100 - percent`, so the ratios among the
 * ordinary outcomes are exactly the ones the permanent rule produced.
 */
export function runeTrialTestWeights(
  pool: readonly Weighted[],
  trialId: string,
): readonly number[] {
  const weights = pool.map(({ weight }) => weight);
  const trialIndex = pool.findIndex(({ outcome }) => outcome.id === trialId);
  if (RUNE_TRIAL_TEST_SHARE === null || trialIndex < 0) return weights;
  /* Whole percent, and loudly: the arithmetic below is exact in percent, so a
     share of 0.004 would round to 0 and silently stop dealing Trials while the
     constant still claimed it was dealing them. */
  const percent = Math.round(RUNE_TRIAL_TEST_SHARE * 100);
  if (percent !== RUNE_TRIAL_TEST_SHARE * 100 || percent < 1 || percent > 99) {
    throw new RangeError('The Rune Trial test share must be a whole percent between 1 and 99.');
  }
  const others = weights.reduce((sum, weight, index) =>
    index === trialIndex ? sum : sum + weight, 0);
  return weights.map((weight, index) =>
    index === trialIndex ? percent * others : weight * (100 - percent));
}
