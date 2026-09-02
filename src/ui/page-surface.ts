/* The one answer to "which layer owns the room?". Most overlays share a
   z-index, so later DOM order breaks a tie; deliberately raised pages such as
   Legal must still beat both a lazy overlay and an already-open sheet. */
function zIndex(element: HTMLElement): number {
  const style = getComputedStyle(element);
  /* Motion briefly lifts equal-level pages past each other. That compositor
     detail must not make an ordinary page outrank a real modal sheet. */
  const authored = style.getPropertyValue('--page-motion-base-z');
  const value = Number.parseInt(authored || style.zIndex, 10);
  return Number.isFinite(value) ? value : 0;
}

/** Highest open overlay by its authored overlay layer, before a non-overlay
 * sheet is considered. Page motion uses this to remember the page beneath a
 * temporary modal and to wipe a raised Legal page back to that room. */
export function topOpenOverlayLayer(root: HTMLElement): HTMLElement | null {
  let winner: HTMLElement | null = null;
  for (const candidate of root.querySelectorAll<HTMLElement>('.ov.on')) {
    if (!winner || zIndex(candidate) >= zIndex(winner)) winner = candidate;
  }
  return winner;
}

export function topOpenOverlay(root: HTMLElement): HTMLElement | null {
  const winner = topOpenOverlayLayer(root);
  /* Sheets normally cover pages (90 over 80), so game/reveal/card routes stay
     outside page navigation. Legal is deliberately 100 and is the one page
     allowed to open above an existing sheet; compare the real layers instead
     of vetoing every overlay merely because a sheet exists somewhere. */
  for (const sheet of root.querySelectorAll<HTMLElement>('.faceoff')) {
    if (!winner || zIndex(sheet) >= zIndex(winner)) return null;
  }
  return winner;
}

export function topPagedOverlay(root: HTMLElement): HTMLElement | null {
  const overlay = topOpenOverlay(root);
  return overlay?.classList.contains('paged') ? overlay : null;
}
