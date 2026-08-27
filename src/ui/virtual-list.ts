/* A WINDOWED LIST FOR THE ONE-SCROLLER SHELL.
   Mounts a few screens of rows, describes the whole board to the scrollbar,
   and — the part this exists for — moves the reader's view as little as
   possible while doing it.

   THE ANCHOR INVARIANT is the trick. The list's own padding stands in for the
   trimmed rows, and the top pad moves ONLY by the measured extent of slots
   crossing the top edge. Mounting a row above the viewport shrinks the pad by
   exactly what the row adds, so the content above does not change height and
   scrollTop needs no write at all. That is what makes crawling upward free,
   and it is what the old ladder got wrong twice over: it hand-compensated a
   prepend while the browser was ALSO anchoring the same insertion, and it
   wrote scrollTop mid-fling, which iOS reads as "cancel the gesture".

   Where a never-measured row turns out taller or shorter than the estimate,
   the difference is DRIFT. Drift is carried in the content height rather than
   paid off, because paying costs a scroll write. It is settled only at the two
   ends of the board, where the pad has nowhere left to give — and even then
   through the scroll gate, as a PAIRED write: pad and scroll move by the same
   number in one synchronous block, so nothing on screen moves.

   No IntersectionObserver. The frame loop already derives the wanted window
   from the scroll offset and has to be correct on its own; sentinels would be
   a second mechanism computing the same answer, and two answers drift. Layout
   changes that are not scrolls schedule a frame directly instead. */

import { createRuler } from './virtual-ruler.ts';
import { watchScrollSettled } from './scroll-settled.ts';
import { createMountedSlots, type VirtualSlots } from './virtual-slot.ts';
import {
  createVirtualCache,
  type VirtualAnchor,
  type VirtualPage,
  type VirtualSource,
} from './virtual-cache.ts';

export type { VirtualAnchor, VirtualPage, VirtualSource, VirtualSlots };
export type VirtualAlign = 'start' | 'center' | 'end';
export interface VirtualPlace { key: string; offset: number }

export interface VirtualListSpec<T> {
  scroller: HTMLElement;
  list: HTMLElement;
  source: VirtualSource<T>;
  slots: VirtualSlots<T>;
  /** Rows in the whole sequence, when known. null means "discover the end". */
  total?: number | null;
  /** A first page already fetched, so the caller can reveal one complete view. */
  seed?: VirtualPage<T> | null;
  page?: number;
  /** Viewports of rows kept mounted on each side of the view. */
  keep?: number;
  /** True while this list is the view the reader is actually looking at. */
  alive?(): boolean;
}

export interface VirtualList {
  readonly ready: Promise<void>;
  reading(): { index: number; total: number };
  /** Re-render every mounted slot in place — locale, or new derived data. */
  repaint(): void;
  /** The box changed under us: re-measure and re-plan. */
  refresh(): void;
  setTotal(total: number | null): void;
  scrollToIndex(index: number, align?: VirtualAlign): void;
  /** The same by identity, for when the position is not known — inside a tie
      block `rank - 1` is not my row, but my key always is. */
  scrollToKey(key: string, align?: VirtualAlign): void;
  /** Remember the reading place across a panel swap that collapses the box. */
  save(): VirtualPlace | null;
  restore(place: VirtualPlace | null): void;
  destroy(): void;
}

const px = (n: number): string => `${Math.max(0, Math.round(n * 100) / 100)}px`;

export function mountVirtualList<T>(spec: VirtualListSpec<T>): VirtualList {
  const { scroller, list, source, slots } = spec;
  const PAGE = Math.max(1, spec.page ?? 25);
  const KEEP = Math.max(1, spec.keep ?? 2);
  const alive = spec.alive ?? (() => true);

  const gap = (() => {
    const raw = parseFloat(getComputedStyle(list).rowGap);
    return Number.isFinite(raw) ? raw : 0;
  })();
  /* A seed only until the first row is measured, which happens in the opening
     frame: .lrow's min-height plus one gap is the right order of magnitude. */
  const ruler = createRuler(0, gap, 44 + gap);

  let first = 0;
  let last = -1;
  /* The top pad. Moves only by MEASURED extents — that is the invariant. */
  let padTop = 0;
  let owed = 0;                       // scroll px waiting for a settled moment
  let frameId = 0;
  let dead = false;
  let wanted: { index: number; align: VirtualAlign } | null = null;
  let settleReady: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => { settleReady = resolve; });

  const schedule = (): void => {
    if (dead || frameId) return;
    frameId = requestAnimationFrame(() => { frameId = 0; frame(); });
  };

  const cache = createVirtualCache<T>({
    source,
    key: slots.key,
    page: PAGE,
    total: spec.total ?? null,
    seed: spec.seed ?? null,
    changed(positions) {
      /* Repaint only what is ALREADY mounted — mounting here would insert
         slots outside the window. The frame loop owns which rows exist; this
         only swaps a tombstone for its row once the data lands. The row below
         is repainted too, because its lead is decided from this one. */
      for (const position of positions) {
        if (mountedSlots.has(position)) mountedSlots.mount(position);
        if (mountedSlots.has(position + 1)) mountedSlots.mount(position + 1);
      }
      schedule();
    },
  });
  const mountedSlots = createMountedSlots<T>(list, gap, slots,
    (position) => cache.get(position));
  const settled = watchScrollSettled(scroller, schedule);

  /** The list's top edge in the scroller's content coordinates. */
  const origin = (): number =>
    list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

  /** Ruler coordinates and laid-out coordinates differ by exactly this. */
  const drift = (): number => padTop - ruler.top(first);

  function frame(): void {
    if (dead || !alive()) return;
    /* A hidden panel has no box: every rect reads 0, and recording that would
       poison the ruler and every pad derived from it. */
    const viewHeight = scroller.clientHeight;
    if (!viewHeight || !list.offsetParent) return;

    applyTarget();

    // ---- READ (one layout; nothing written yet) ----
    const scrollTop = scroller.scrollTop;
    const listTop = origin();
    const count = cache.count();
    if (count !== ruler.count) {
      ruler.resize(count);
      /* Positions moved, so a drift measured against the old board means
         nothing. Re-seat the pad on the ruler rather than carrying it. */
      padTop = ruler.top(first);
      mountedSlots.remeasure();
    }
    if (count === 0) { resolveReady(); return; }

    // ---- PLAN (pure) ----
    const viewTop = scrollTop - listTop - drift();          // ruler coordinates
    const keepPx = KEEP * viewHeight;
    const wantFirst = Math.max(0, ruler.at(viewTop - keepPx));
    const wantLast = Math.min(count - 1, ruler.at(viewTop + viewHeight + keepPx));

    /* Detached: the reader is more than a screen from anything mounted — a
       dragged thumb, a fling that outran its fetches, a deep link. The module
       never asks WHY; it asks whether what it holds is still being looked at,
       and every cause gets the same repair. */
    const detached = last < first || wantLast < first - 1 || wantFirst > last + 1;

    // ---- COMMIT (writes only) ----
    if (detached) {
      mountedSlots.clear();
      first = wantFirst;
      last = wantFirst - 1;
      /* A reseed zeroes the drift by construction: every slot is about to be
         mounted at the height the ruler already assumed, so the content above
         is unchanged and no scroll write is owed. */
      padTop = ruler.top(first);
      owed = 0;
    } else {
      for (const position of mountedSlots.positions()) {
        if (position >= wantFirst && position <= wantLast) continue;
        /* Trimming above the viewport moves the pad by the height that leaves
           with it. That is the invariant, and it is why a trim is free. */
        if (position < wantFirst) padTop += ruler.top(position + 1) - ruler.top(position);
        mountedSlots.unmount(position);
      }
    }

    for (let position = wantFirst; position <= wantLast; position++) {
      if (!mountedSlots.has(position)) {
        /* Mounting above the viewport shrinks the pad by exactly what arrives,
           so the content above keeps its height and the view does not move. */
        if (position < first) padTop -= ruler.top(position + 1) - ruler.top(position);
        mountedSlots.mount(position);
      }
      if (cache.get(position) === undefined) cache.request(position);
    }
    first = wantFirst;
    last = wantLast;

    /* ONE forced layout, on frames that actually changed a slot. It cannot be
       avoided: the pad is a function of the measured heights of the slots just
       mounted, so they must be read before it is written. Nothing has painted
       in between, so there is no flash. */
    mountedSlots.measureInto(ruler);

    list.style.paddingTop = px(padTop);
    list.style.paddingBottom = px(ruler.total - (ruler.top(last + 1) - gap));

    /* Drift is only settled where the pad has nowhere left to give: at the very
       top, where the first row would otherwise float in a phantom gap, and at
       the very end, where it would push past the content. */
    const carried = drift();
    if (carried !== 0 && (first === 0 || last === count - 1)) owed = -carried;
    /* The wait exists ONLY to protect touch momentum. A reader who has never
       touched this scroller — a trackpad, a mouse, the opening jump itself —
       has no fling to cancel, so making them wait out a 150ms quiet window
       just leaves the list visibly unsquared for a beat. It also punished our
       OWN programmatic write, which starts the quiet timer like any other
       scroll: that is why opening on rank 145 settled 31px short of the end. */
    const mayWrite = settled.touchDriven() ? settled.settled() : !settled.elastic();
    if (owed !== 0 && mayWrite) {
      /* THE PAIRED WRITE. Pad and scroll move by the same number inside one
         synchronous block, so the content stays exactly where the reader left
         it. Splitting these across a frame is the jolt this module deletes. */
      padTop += owed;
      scroller.scrollTop = scrollTop + owed;
      list.style.paddingTop = px(padTop);
      owed = 0;
    }
    resolveReady();
  }

  function resolveReady(): void {
    if (!settleReady) return;
    settleReady();
    settleReady = null;
  }

  const onScroll = (): void => schedule();
  scroller.addEventListener('scroll', onScroll, { passive: true });
  /* Width decides height here — rows use clamp(...vw...) typography and a
     breakpoint changes what a row even contains — so a resize invalidates every
     measurement rather than merely re-planning. */
  const boxes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    ruler.forget();
    mountedSlots.remeasure();
    schedule();
  });
  boxes?.observe(scroller);

  /* A jump is only meaningful once the list HAS a box. Asked for while the
     panel is still behind its loading die, scrollHeight is the loader's and the
     clamp below silently truncates the jump to a few pixels — which is exactly
     how opening the ladder on rank 145 landed on rank 1. So a jump asked for
     too early is remembered and applied by the first frame that has a box. */
  const target = (index: number, align: VirtualAlign): void => {
    wanted = { index, align };
    if (!applyTarget()) schedule();
  };

  function applyTarget(): boolean {
    if (!wanted) return false;
    if (!scroller.clientHeight || !list.offsetParent) return false;
    const { index, align } = wanted;
    const count = cache.count();
    if (count === 0) return false;
    wanted = null;
    const k = Math.max(0, Math.min(count - 1, index));
    /* RESEED FIRST, THEN SCROLL. A jump is only meaningful against geometry
       that already describes the whole board: before the first frame the ruler
       still has no rows and the pads have not been written, so both ruler.top()
       and the scrollHeight clamp would answer about a board of nothing and the
       jump would land at the top. Opening the ladder on rank 145 did exactly
       that — it asked for row 144 and got row 0.
       Emptying the window first also makes this free of drift by construction:
       with nothing mounted the two pads ARE the whole content. */
    if (count !== ruler.count) ruler.resize(count);
    mountedSlots.clear();
    first = k;
    last = k - 1;
    padTop = ruler.top(k);
    owed = 0;
    list.style.paddingTop = px(padTop);
    list.style.paddingBottom = px(Math.max(0, ruler.total - padTop));

    const height = ruler.top(k + 1) - ruler.top(k) - gap;
    const view = scroller.clientHeight;
    const goal = align === 'center' ? ruler.top(k) - (view - height) / 2
      : align === 'end' ? ruler.top(k) - view + height
      : ruler.top(k);
    const maximum = Math.max(0, scroller.scrollHeight - view);
    scroller.scrollTop = Math.max(0, Math.min(maximum, goal + origin()));
    cache.request(k);
    schedule();
    return true;
  }

  schedule();

  return {
    ready,
    reading: () => ({
      index: ruler.at(scroller.scrollTop - origin() - drift()),
      total: cache.count(),
    }),
    repaint(): void {
      mountedSlots.repaint();
      /* Translated copy changes heights, so nothing measured survives it. */
      ruler.forget();
      mountedSlots.remeasure();
      schedule();
    },
    refresh(): void {
      ruler.forget();
      mountedSlots.remeasure();
      schedule();
    },
    setTotal(total: number | null): void { cache.setTotal(total); schedule(); },
    scrollToIndex(index, align = 'start') { target(index, align); },
    scrollToKey(key, align = 'start') {
      const position = cache.positionOf(key);
      if (position !== undefined) target(position, align);
    },
    save: () => mountedSlots.topmost(scroller.getBoundingClientRect().top),
    restore(place: VirtualPlace | null): void {
      if (!place) return;
      const position = cache.positionOf(place.key);
      if (position === undefined) return;
      /* An anchor, not a raw scrollTop: pads ahead of the reader may have been
         corrected while the panel was away, and a stored offset would then
         point somewhere else entirely. */
      target(position, 'start');
      if (scroller.clientHeight && list.offsetParent) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - place.offset);
      }
      schedule();
    },
    destroy(): void {
      dead = true;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      scroller.removeEventListener('scroll', onScroll);
      boxes?.disconnect();
      settled.destroy();
      cache.destroy();
      mountedSlots.clear();
      list.style.paddingTop = '';
      list.style.paddingBottom = '';
    },
  };
}
