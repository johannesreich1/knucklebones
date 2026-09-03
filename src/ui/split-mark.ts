/* THE SPLIT MARK, as live DOM.
 *
 * The same arrangement tools/appicon.mjs renders for the launcher tile and the
 * launch screen — one six-face die, left pip column in --p1, right in --p2, cut
 * on a lit seam — built here from the app's own die component so Home can wear
 * it too (design study 14e / L5, chosen 2026-09-03).
 *
 * WHY THIS EXISTS RATHER THAN AN <img>. The generator bakes the mark into an
 * SVG with the icon's pair stamped on its root, which makes it a picture: a
 * player who repointed their duel hues would get a cyan-and-magenta hero over
 * their own colours, and the old two-dice hero it replaces already followed the
 * pair correctly. Shipping the image would have LOST a capability Home had.
 * Rendered as DOM, --p1/--p2 resolve from the page and the mark follows the
 * player, while the icon canvas keeps pinning its own pair.
 *
 * The styling is src/styles/components/split-mark.css, shared with the
 * generator. Nothing is drawn twice.
 */
import { dieMarkup } from './die-markup.ts';

/** The face the mark wears. Six is the only face whose pips form two clean
 *  columns of three, which is what makes the vertical cut read as a split of
 *  ONE die rather than two dice pushed together. */
export const SPLIT_MARK_FACE = 6;

/** Home's mark: 96 CSS pixels of frame, which paints a 76.8px die — the 120-unit
 *  arrangement scaled by 96/120. Within 3px of the 74px duel dice it replaced,
 *  so the single object arrives at the weight the two used to share. */
export const HOME_MARK_SIZE = 96;

/**
 * Markup for the split mark at `size` CSS pixels.
 *
 * The plate is only painted on a light ground (the iOS light rendition); on the
 * app's night it stays hidden, and the two translucent halves sit straight on
 * the page the way the tile sits on its canvas.
 */
export function splitMarkMarkup(size: number = HOME_MARK_SIZE): string {
  /* dataValue is not decoration: the two duel dice this mark replaced carried
     data-v, and the responsive suite reads it to prove Home's fixed-pip faces
     keep their pips when the in-game numeral setting is on. Dropping it made
     the mark unreadable to that check — and to anything else that identifies a
     die by its face — so the halves say what they are, like the dice did. */
  const half = (owner: 'p1' | 'p2'): string => dieMarkup(SPLIT_MARK_FACE, {
    classes: `${owner} appicon-die`,
    size: 96,
    dataValue: true,
    inlineStyle: 'transform:none!important;',
  });
  return `<i class="splitmark" style="--split-size:${size}px" aria-hidden="true">`
    + '<span class="split">'
    + '<i class="sdplate"></i>'
    + `<i class="half left">${half('p1')}</i>`
    + `<i class="half right">${half('p2')}</i>`
    + '<i class="seam"></i>'
    + '</span></i>';
}
