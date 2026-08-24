import {
  BOUNTY_RING_EASING,
  BOUNTY_STAMP_EASING,
  BOUNTY_TIMING,
  BOUNTY_VICTIM_EASING,
  bountySequenceDuration,
  bountySunderDelay,
} from '../../../../src/ui/game/bounty-presentation.ts';
import { modeIcon } from '../../../../src/ui/modeicons.ts';

export const close = (actual, expected, tolerance = 1) =>
  Math.abs(actual - expected) <= tolerance;

export const easingNumbers = (value) =>
  (String(value).match(/-?[\d.]+/g) || []).map(Number).join(',');

/* Pin the authored source separately from the browser choreography. This is
   intentionally literal: BO2 drifted when the 3.6s review loop was rebuilt at
   call sites and its idle/reset tail leaked into gameplay. */
export function assertBountyMintSourceContract({ out, check }) {
  const expectedTiming = {
    reviewLoopMs: 3600,
    activeStartPercent: 16,
    activeEndPercent: 60,
    pressStartMs: 144,
    squashMs: 288,
    flatMs: 576,
    stampLandMs: 324,
    stampSettleMs: 504,
    stampHoldEndMs: 1080,
    stampFadeEndMs: 1440,
    victimStaggerMs: 108,
    cleanupAfterFadeMs: 36,
    pairEndMs: 1584,
    reducedHoldMs: 320,
    pressDurationMs: 432,
    stampDurationMs: 1296,
    stampLandOffsetMs: 180,
    stampSettleOffsetMs: 360,
    stampHoldEndOffsetMs: 936,
    sunderImpactProgress: .62,
  };
  out.bountyContract = {
    timing: BOUNTY_TIMING,
    pair: bountySequenceDuration(2),
    triple: bountySequenceDuration(3),
    sunder: [bountySunderDelay(0, 2600, 160), bountySunderDelay(1, 2600, 160)],
    easings: [BOUNTY_VICTIM_EASING, BOUNTY_STAMP_EASING, BOUNTY_RING_EASING],
    icon: modeIcon('bounty', 24),
  };
  check(Object.entries(expectedTiming).every(([key, value]) => BOUNTY_TIMING[key] === value)
      && out.bountyContract.pair === 1584 && out.bountyContract.triple === 1692
      && String(out.bountyContract.sunder) === '1252,1412',
    'BO2 source constants no longer reproduce the selected 3.6s review crop', out.bountyContract);
  check(easingNumbers(BOUNTY_VICTIM_EASING) === '0.4,0,0.2,1'
      && easingNumbers(BOUNTY_STAMP_EASING) === '0.2,1.4,0.4,1'
      && BOUNTY_RING_EASING === 'ease-out',
    'BO2 source easings changed from the selected struck-coin design', out.bountyContract.easings);
  check(out.bountyContract.icon.includes('<circle cx="12" cy="12" r="8.2"/>')
      && out.bountyContract.icon.includes('<path class="f" fill="currentColor" stroke="none" d="M12 5.1C')
      && !out.bountyContract.icon.includes('M12 8.6v6.8'),
    'the canonical BOUNTY coin no longer carries the centred ✦ mark', out.bountyContract.icon);
}
