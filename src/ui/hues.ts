// THE TWO PLAYER COLOURS, PAINTED ONTO ONE ELEMENT.
//
// `--p1` and `--p2` are slots, not fixed colours: everything that says "this
// belongs to a player" resolves one of them, and `--p1` is what means "you"
// (the away plate, the scoreline and the active row all rely on that).
//
// Painting them is one implementation with a target, because it happens in two
// places for two reasons: settings paints the player's stored pair onto the app
// root, and a ranked table repaints a SWAPPED pair onto itself when the server
// seated the viewer as p2, so `--p1` keeps meaning "you" on a screen only the
// viewer is looking at. Anything inside the table inherits the swap.
import type { HueId } from '../preferences.ts';

/** Every custom property a painted pair owns — and therefore what clearing removes. */
const SLOT_PROPERTIES = ['', '-rgb', '-hi', '-mx2', '-mx2-rgb', '-mx3', '-mx3-rgb'] as const;

/**
 * Paint a `[p1, p2]` hue pair onto `style`.
 *
 * Colour-blind mode overrides the displayed pair without changing the stored
 * picks; the multiplier fallbacks stay distinct from whichever hue owns them,
 * which is why they are derived per slot rather than fixed.
 */
export function paintHuePair(
  style: CSSStyleDeclaration,
  [first, second]: readonly [HueId | string, HueId | string],
  colorblind: boolean,
): void {
  const pairs: Array<readonly ['p1' | 'p2', string]> = [
    ['p1', colorblind ? 'cy' : first],
    ['p2', colorblind ? 'gold' : second],
  ];
  for (const [slot, hue] of pairs) {
    style.setProperty(`--${slot}`, `var(--${hue})`);
    style.setProperty(`--${slot}-rgb`, `var(--${hue}-rgb)`);
    style.setProperty(`--${slot}-hi`, `var(--${hue}-hi)`);
    const mx2 = colorblind || hue === 'gold' ? 'ice' : 'gold';
    const mx3 = colorblind || hue === 'orange' ? 'red' : 'orange';
    style.setProperty(`--${slot}-mx2`, `var(--${mx2})`);
    style.setProperty(`--${slot}-mx2-rgb`, `var(--${mx2}-rgb)`);
    style.setProperty(`--${slot}-mx3`, `var(--${mx3})`);
    style.setProperty(`--${slot}-mx3-rgb`, `var(--${mx3}-rgb)`);
  }
}

/** Drop a locally painted pair so the element inherits the app root's again. */
export function clearHuePair(style: CSSStyleDeclaration): void {
  for (const slot of ['p1', 'p2']) {
    for (const suffix of SLOT_PROPERTIES) style.removeProperty(`--${slot}${suffix}`);
  }
}
