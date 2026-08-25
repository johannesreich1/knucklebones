export interface InertSnapshot {
  readonly element: HTMLElement;
  readonly inert: boolean;
}

/** Preserve every prior inert value so nested modals unwind one layer at a time. */
export function makeModalBackgroundInert(
  root: HTMLElement,
  foreground: HTMLElement,
): readonly InertSnapshot[] {
  return Array.from(root.children).flatMap((element) => {
    if (!(element instanceof HTMLElement) || element === foreground) return [];
    const snapshot = { element, inert: element.inert };
    element.inert = true;
    return [snapshot];
  });
}

export function restoreModalBackground(snapshot: readonly InertSnapshot[]): void {
  for (const { element, inert } of snapshot) element.inert = inert;
}
