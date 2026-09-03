export interface InertSnapshot {
  readonly element: HTMLElement;
  release(): void;
}

interface InertLock {
  readonly base: boolean;
  readonly owners: Set<symbol>;
}

const LOCKS = new WeakMap<HTMLElement, InertLock>();

/** Borrow an element's inert state without racing another modal/navigation
 * owner. The last borrower restores the state captured by the first. */
export function makeInert(element: HTMLElement): InertSnapshot {
  let lock = LOCKS.get(element);
  if (!lock) {
    lock = { base: element.inert, owners: new Set() };
    LOCKS.set(element, lock);
  }
  const owner = Symbol('inert-owner');
  lock.owners.add(owner);
  element.inert = true;
  let released = false;
  return {
    element,
    release: () => {
      if (released) return;
      released = true;
      const active = LOCKS.get(element);
      if (!active) return;
      active.owners.delete(owner);
      if (active.owners.size) return;
      element.inert = active.base;
      LOCKS.delete(element);
    },
  };
}

/** Hold ONE durable borrow on an element, driven by state rather than by a
 * matching release call — for a background that should stay inert as long as
 * something covers it, across any number of modals opening and closing over
 * the top. Held through makeInert()'s lock, so a sheet that borrows the same
 * element and releases restores this hold instead of clearing it. */
const HELD = new WeakMap<HTMLElement, InertSnapshot>();
export function holdInert(element: HTMLElement, inert: boolean): void {
  const held = HELD.get(element);
  if (inert === !!held) return;
  if (inert) HELD.set(element, makeInert(element));
  else {
    held?.release();
    HELD.delete(element);
  }
}

/** Borrow inert for an entire subtree while leaving one control exposed. The
 * exception's ancestor chain stays live; every sibling branch is borrowed
 * through makeInert(), so nested sheet/navigation owners still unwind safely. */
export function makeInertExcept(
  element: HTMLElement,
  exception: HTMLElement | null,
): readonly InertSnapshot[] {
  if (!exception || !element.contains(exception)) return [makeInert(element)];
  if (element === exception) return [];
  const snapshots: InertSnapshot[] = [];
  for (const child of element.children) {
    if (!(child instanceof HTMLElement) || child === exception) continue;
    if (child.contains(exception)) snapshots.push(...makeInertExcept(child, exception));
    else snapshots.push(makeInert(child));
  }
  return snapshots;
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
    return [makeInert(element)];
  });
}

export function restoreModalBackground(snapshot: readonly InertSnapshot[]): void {
  for (const entry of snapshot) entry.release();
}
