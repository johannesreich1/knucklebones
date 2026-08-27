/* THE MOUNTED ROWS: what a slot is in the DOM, and nothing about when.
   One slot is one WRAPPER holding an optional lead decoration and the row
   itself, so a slot has exactly one measurable box. Without the wrapper a
   slot's extent would be "the horizon, plus its outside margin, plus the gap,
   plus the row" — a quantity that cannot be read in one call and that changes
   meaning depending on what is mounted beside it. */

import type { Ruler } from './virtual-ruler.ts';

export interface VirtualSlots<T> {
  key(item: T): string;
  /** Build the element once, wired. Identity lives here so a repaint, a data
      arrival and a locale change all keep the same node — and its focus. */
  create(index: number): HTMLElement;
  render(element: HTMLElement, item: T, index: number): void;
  /** Paint a slot whose data has not arrived. */
  pending?(element: HTMLElement, index: number, state: 'loading' | 'failed'): void;
  /** The decoration that OPENS a run — the ladder's group horizon. It belongs
      to the row that starts the group, so it is part of that slot's box.
      `previous` is undefined when the row above is not loaded; index 0 means
      there is genuinely nothing above. */
  lead?(item: T, previous: T | undefined, index: number): HTMLElement | null;
}

export interface MountedSlots<T> {
  has(position: number): boolean;
  positions(): number[];
  /** Mount (or repaint) the slot, inserting it in position order. */
  mount(position: number): void;
  unmount(position: number): void;
  repaint(): void;
  /** Mark every mounted slot as needing a fresh measurement. */
  remeasure(): void;
  /** ONE forced layout, for the slots whose box may actually have changed. */
  measureInto(ruler: Ruler): void;
  /** The topmost mounted slot at or below `edge`, for saving a reading place. */
  topmost(edge: number): { key: string; offset: number } | null;
  clear(): void;
}

export function createMountedSlots<T>(
  list: HTMLElement,
  gap: number,
  slots: VirtualSlots<T>,
  itemAt: (position: number) => T | undefined,
): MountedSlots<T> {
  interface Slot { wrapper: HTMLElement; element: HTMLElement; lead: HTMLElement | null }
  const mounted = new Map<number, Slot>();
  const dirty = new Set<number>();

  const build = (position: number): Slot => {
    const wrapper = document.createElement('div');
    /* No class: this module contributes ZERO selectors, so it can never collide
       with the app's cascade or trip its stylesheet-reachability rules. Flex,
       not block, because a <button> child does not fill a block parent — and
       this reproduces the list's own rhythm exactly, with the lead's margins
       inside the box that gets measured. */
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.rowGap = `${gap}px`;
    wrapper.dataset.slot = String(position);
    const element = slots.create(position);
    wrapper.appendChild(element);
    return { wrapper, element, lead: null };
  };

  const paint = (slot: Slot, position: number): void => {
    slot.wrapper.dataset.slot = String(position);
    dirty.add(position);
    const item = itemAt(position);
    if (slot.lead) { slot.lead.remove(); slot.lead = null; }
    if (item === undefined) {
      slot.wrapper.dataset.pending = '1';
      slots.pending?.(slot.element, position, 'loading');
      return;
    }
    delete slot.wrapper.dataset.pending;
    slots.render(slot.element, item, position);
    /* The lead is decided from the row ABOVE. When that row is not loaded the
       honest answer is none: drawing one and taking it away is a visible jump,
       while a label arriving a moment late is not. */
    const wanted = slots.lead?.(item, itemAt(position - 1), position) ?? null;
    if (wanted) {
      slot.lead = wanted;
      slot.wrapper.insertBefore(wanted, slot.element);
    }
  };

  return {
    has: (position) => mounted.has(position),
    positions: () => [...mounted.keys()],

    mount(position: number): void {
      const existing = mounted.get(position);
      if (existing) { paint(existing, position); return; }
      const slot = build(position);
      mounted.set(position, slot);
      paint(slot, position);
      /* Inserted in position order so the DOM reads top to bottom, which keeps
         tab order and screen-reader order honest. */
      const below = mounted.get(position + 1);
      if (below) list.insertBefore(slot.wrapper, below.wrapper);
      else list.appendChild(slot.wrapper);
    },

    unmount(position: number): void {
      const slot = mounted.get(position);
      if (!slot) return;
      /* A trimmed row holding focus would drop a keyboard reader back to the
         document. Hand focus to the list, which is tabbable for this reason. */
      if (slot.wrapper.contains(document.activeElement)) {
        list.tabIndex = -1;
        list.focus({ preventScroll: true });
      }
      slot.wrapper.remove();
      mounted.delete(position);
      dirty.delete(position);
    },

    repaint(): void { for (const [position, slot] of mounted) paint(slot, position); },
    remeasure(): void { for (const position of mounted.keys()) dirty.add(position); },

    measureInto(ruler: Ruler): void {
      if (dirty.size === 0) return;
      /* A slot's height cannot be changed by mounting a neighbour — that is the
         slot-purity rule this design rests on — so re-reading the whole window
         every frame would be seventy forced rect reads to learn nothing. */
      for (const position of dirty) {
        const slot = mounted.get(position);
        if (slot) ruler.measure(position, slot.wrapper.getBoundingClientRect().height);
      }
      dirty.clear();
    },

    topmost(edge: number): { key: string; offset: number } | null {
      let best: { key: string; offset: number } | null = null;
      for (const [position, slot] of mounted) {
        const item = itemAt(position);
        if (item === undefined) continue;
        const offset = slot.wrapper.getBoundingClientRect().top - edge;
        if (offset >= 0 && (best === null || offset < best.offset)) {
          best = { key: slots.key(item), offset };
        }
      }
      return best;
    },

    clear(): void { for (const position of [...mounted.keys()]) this.unmount(position); },
  };
}
