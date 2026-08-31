export interface InertSnapshot {
  readonly element: HTMLElement;
  readonly inert: boolean;
}

/** Preserve every prior inert value so nested modals unwind one layer at a time.
 * A dormant system-status sibling may opt out: if CSS raises it later (for
 * example after rotation), it must remain exposed to assistive technology. */
export function makeModalBackgroundInert(
  root: HTMLElement,
  foreground: HTMLElement,
): readonly InertSnapshot[] {
  return Array.from(root.children).flatMap((element) => {
    if (!(element instanceof HTMLElement) || element === foreground
        || element.hasAttribute('data-modal-background-exempt')) return [];
    const snapshot = { element, inert: element.inert };
    element.inert = true;
    return [snapshot];
  });
}

export function restoreModalBackground(snapshot: readonly InertSnapshot[]): void {
  for (const { element, inert } of snapshot) element.inert = inert;
}
