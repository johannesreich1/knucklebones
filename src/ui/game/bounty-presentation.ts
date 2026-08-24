// BO2 — Struck coin. These are the production offsets cropped from the
// approved 3.6s review loop's 16%..60% window. Keep them named and tested:
// reconstructing the percentages at a call site has repeatedly changed the
// authored duration by accidentally retaining the study's idle/reset tail.
import type { Player } from '../../core/rules.ts';
import { appRoot } from '../embed.ts';
import { heatOf } from '../identity.ts';
import { modeIcon } from '../modeicons.ts';

export const BOUNTY_TIMING = Object.freeze({
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
  sunderImpactProgress: 0.62,
} as const);

export const BOUNTY_VICTIM_EASING = 'cubic-bezier(.4,0,.2,1)';
export const BOUNTY_STAMP_EASING = 'cubic-bezier(.2,1.4,.4,1)';
export const BOUNTY_RING_EASING = 'ease-out';

interface BountyVictimSpec {
  slot: HTMLElement;
  die: HTMLElement;
  attacker: Player;
  order: number;
  delayMs: number;
  flatten: boolean;
  reduced: boolean;
  source: 'ordinary' | 'sunder';
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** The first victim ends 36ms after its fade; each further victim adds 108ms. */
export function bountySequenceDuration(victimCount: number): number {
  return victimCount > 0
    ? BOUNTY_TIMING.stampFadeEndMs + BOUNTY_TIMING.cleanupAfterFadeMs
      + (victimCount - 1) * BOUNTY_TIMING.victimStaggerMs
    : 0;
}

/**
 * CSS delay for an ordinary victim on the placement-anchored BO2 clock.
 * A negative result deliberately catches the animation up if layout or a
 * controller hold delivered the DOM a few milliseconds after its authored
 * start instead of shifting the whole sequence later.
 */
export function bountyPlacementDelay(placementLandedAt: number, order: number): number {
  return BOUNTY_TIMING.pressStartMs + order * BOUNTY_TIMING.victimStaggerMs
    - (now() - placementLandedAt);
}

/** Start the coin early enough that its 360ms settle meets SU6's 62% impact. */
export function bountySunderDelay(
  order: number,
  sunderDurationMs: number,
  sunderStaggerMs: number,
): number {
  return sunderDurationMs * BOUNTY_TIMING.sunderImpactProgress
    - BOUNTY_TIMING.stampSettleOffsetMs
    + order * sunderStaggerMs;
}

export function markBountyVictim(spec: BountyVictimSpec): void {
  const { slot, die } = spec;
  const old = slot.querySelector(':scope > .bounty-mint');
  old?.remove();

  slot.classList.add('bounty-mint-slot');
  slot.classList.toggle('bounty-mint-static-slot', spec.reduced);
  slot.dataset.bountyOrder = String(spec.order);
  slot.dataset.bountySource = spec.source;
  slot.style.setProperty('--bounty-delay', `${spec.reduced ? 0 : spec.delayMs}ms`);
  slot.style.setProperty('--bounty-heat', heatOf(spec.attacker));

  die.classList.toggle('bounty-flatten', spec.flatten && !spec.reduced);

  const stamp = document.createElement('span');
  stamp.className = 'bounty-mint' + (spec.reduced ? ' bounty-mint-static' : '');
  stamp.setAttribute('aria-hidden', 'true');
  stamp.innerHTML = modeIcon('bounty', 28);
  slot.appendChild(stamp);
}

export function clearBountyPresentation(): void {
  const root = appRoot();
  root.querySelectorAll('.bounty-mint').forEach((stamp) => stamp.remove());
  for (const slot of root.querySelectorAll<HTMLElement>('.bounty-mint-slot')) {
    slot.classList.remove('bounty-mint-slot', 'bounty-mint-static-slot');
    delete slot.dataset.bountyOrder;
    delete slot.dataset.bountySource;
    slot.style.removeProperty('--bounty-delay');
    slot.style.removeProperty('--bounty-heat');
  }
  root.querySelectorAll('.die.bounty-flatten').forEach((die) => {
    die.classList.remove('bounty-flatten');
  });
}

/** Wait on an absolute presentation clock while noticing restart/cancellation. */
export async function waitForBountyOffset(
  startedAt: number,
  offsetMs: number,
  isCurrent: () => boolean,
): Promise<boolean> {
  while (isCurrent()) {
    const remaining = startedAt + offsetMs - now();
    if (remaining <= 0) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(remaining, 16)));
  }
  return false;
}

export function bountyPresentationNow(): number { return now(); }
