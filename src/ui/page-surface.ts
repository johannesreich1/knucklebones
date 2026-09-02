/* The one answer to "which layer owns the room?". Most overlays share a
   z-index, so later DOM order breaks a tie; deliberately raised pages such as
   Legal must still beat both a lazy overlay and an already-open sheet. */
export function authoredLayer(element: HTMLElement): number {
  const style = getComputedStyle(element);
  /* Motion briefly lifts equal-level pages past each other. That compositor
     detail must not make an ordinary page outrank a real modal sheet. */
  const authored = style.getPropertyValue('--page-motion-base-z');
  const value = Number.parseInt(authored || style.zIndex, 10);
  return Number.isFinite(value) ? value : 0;
}

export interface OpenRoom {
  /** Highest open overlay by its authored overlay layer, sheets ignored. */
  readonly layerTop: HTMLElement | null;
  /** That overlay's authored layer, so a caller need not read it again. */
  readonly layerTopZ: number;
  /** The same overlay, or null when a non-overlay sheet covers it. */
  readonly top: HTMLElement | null;
}

/** ONE walk over the open overlays and the sheets. Every reading here is a
    computed style, i.e. a forced style flush when it runs right after a class
    change — and the page router runs exactly then. It used to re-read the
    winner's layer once per candidate and walk the room three times per
    reconcile; each navigation paid five or six style recalcs for answers it
    already had. */
export function openRoom(root: HTMLElement): OpenRoom {
  let layerTop: HTMLElement | null = null;
  let layerTopZ = 0;
  for (const candidate of root.querySelectorAll<HTMLElement>('.ov.on')) {
    const z = authoredLayer(candidate);
    if (!layerTop || z >= layerTopZ) {
      layerTop = candidate;
      layerTopZ = z;
    }
  }
  /* Sheets normally cover pages (90 over 80), so game/reveal/card routes stay
     outside page navigation. Legal is deliberately 100 and is the one page
     allowed to open above an existing sheet; compare the real layers instead
     of vetoing every overlay merely because a sheet exists somewhere. */
  let top = layerTop;
  for (const sheet of root.querySelectorAll<HTMLElement>('.faceoff')) {
    if (!layerTop || authoredLayer(sheet) >= layerTopZ) {
      top = null;
      break;
    }
  }
  return { layerTop, layerTopZ, top };
}

/** Highest open overlay by its authored overlay layer, before a non-overlay
 * sheet is considered. Page motion uses this to remember the page beneath a
 * temporary modal and to wipe a raised Legal page back to that room. */
export function topOpenOverlayLayer(root: HTMLElement): HTMLElement | null {
  return openRoom(root).layerTop;
}

export function topOpenOverlay(root: HTMLElement): HTMLElement | null {
  return openRoom(root).top;
}

export function topPagedOverlay(root: HTMLElement): HTMLElement | null {
  const overlay = topOpenOverlay(root);
  return overlay?.classList.contains('paged') ? overlay : null;
}
