// THE ONE PAGED DECK. A bounded set of slides, one of them on screen, with the
// count and the dots that say how many there are and which one you are on.
//
// It exists because the league deck and the profile's identity offers are the
// same object with different presentation: a stack of cards you swipe through
// and a strip that tells you where you are in it. The league deck had all of
// this welded into a 294-line modal — dialog semantics, an inert background, a
// swallowed Escape, a focus trap — none of which an inline deck on a scrolling
// page may have. So the paging is here and the modal stays there.
//
// WHAT THIS OWNS: the index, its clamping, the `n / m` label, the dots and
// their aria-current, and the horizontal swipe. WHAT IT DOES NOT: how a slide
// is drawn (the caller renders), what the controls say, focus, and anything
// modal. A caller that wants a dialog builds one around this.
//
// ONE SLIDE IS IN THE DOM AT A TIME, by construction — the caller's `render`
// replaces the body. That is not a limitation, it is the point: a horizontal
// TRACK would put a text input inside a horizontally scrolling box, and the
// browser scrolls a focused element into view on BOTH axes, so tapping the
// name field would fight the track. Swapping in place has no scrollport to
// fight, and never contests `.pbody`'s vertical pan.

/** Where a deck's chrome lives. Both are optional: a single-slide deck hides
    its count, and a caller may want dots without a label or neither. */
export interface SlideDeckChrome {
  /** Painted `1 / 3`, and hidden outright while there is only one slide. */
  readonly page?: HTMLElement | null;
  /** Filled with one `<i>` per slide; the active one takes aria-current. */
  readonly dots?: HTMLElement | null;
}

export interface SlideDeckOptions extends SlideDeckChrome {
  /** The element a swipe is measured on. Buttons inside it keep their own
      click and focus semantics and never start a gesture. */
  readonly surface: HTMLElement;
  /** Draw slide `index` of `total`. Called on every settle, including the
      first, so the caller never has to paint once itself before handing over. */
  readonly render: (index: number, total: number) => void;
  /** "Slide 2 of 3", for the dots' accessible name. Locale-owned by the
      caller, because this module holds no copy of its own. */
  readonly slideLabel: (current: number, total: number) => string;
  /** Formats the two numbers in the `n / m` label — the app's own numerals. */
  readonly formatNumber?: (value: number) => string;
  /** Advancing past the last slide. A modal closes here; an inline deck
      usually wants nothing, which is the default. */
  readonly onPastEnd?: () => void;
  /** Fires only when the index actually changed — a swipe that lands on the
      slide you were already on is not a move, and must not click. */
  readonly onMove?: () => void;
  /** Bind ArrowLeft/ArrowRight on this element. A modal deliberately passes
      NOTHING and keeps its own document-level capture handler, because it also
      swallows Escape and traps Tab; an inline deck must never capture globally
      — the page around it has its own keyboard. */
  readonly arrowKeys?: HTMLElement | null;
}

export interface SlideDeck {
  readonly index: number;
  readonly total: number;
  /** Re-count and settle. `startIndex` is clamped, so a deck that shrinks
      under its own cursor lands on the last slide rather than out of range. */
  setTotal(total: number, startIndex?: number): void;
  move(step: -1 | 1): void;
  /** Forward, or `onPastEnd` at the end. */
  advance(): void;
  /** Repaint the current slide and chrome without moving — for a locale
      change, or content arriving under a slide already on screen. */
  repaint(): void;
  destroy(): void;
}

/* A swipe is 48px of travel that is also decisively more horizontal than
   vertical. The ratio is what stops a diagonal flick during a vertical scroll
   from paging: on a page that scrolls, most horizontal movement is incidental. */
const SWIPE_MIN_PX = 48;
const SWIPE_HORIZONTAL_RATIO = 1.4;

export function createSlideDeck(options: SlideDeckOptions): SlideDeck {
  const { surface, render, slideLabel, page = null, dots = null } = options;
  const format = options.formatNumber ?? ((value: number) => String(value));
  let total = 0;
  let index = 0;
  let pointer: { id: number; x: number; y: number } | null = null;
  let destroyed = false;

  const paint = (): void => {
    if (destroyed || total <= 0) return;
    render(index, total);
    const current = index + 1;
    const single = total === 1;
    if (page) {
      page.textContent = `${format(current)} / ${format(total)}`;
      /* ONE SLIDE IS NOT A SEQUENCE. "1 / 1" is noise on a deck you cannot
         page, and the dots below say the same nothing. */
      page.hidden = single;
    }
    if (dots) {
      dots.setAttribute('aria-label', slideLabel(current, total));
      /* THE LONE DOT STAYS. A one-slide deck drops the `1 / 1` label because
         it is a lie about a sequence, but the dot is a position marker and one
         of them still marks a position — the league deck centres it over the
         action and a suite pins exactly that. Hide it in CSS if a caller wants
         it gone; do not make the shared paging decide. */
      dots.replaceChildren(...Array.from({ length: total }, (_, slide) => {
        const dot = document.createElement('i');
        /* The dots are a PICTURE of the label above them, so they are hidden
           from assistive tech and the group's own name carries the meaning. */
        dot.setAttribute('aria-hidden', 'true');
        if (slide === index) dot.setAttribute('aria-current', 'true');
        return dot;
      }));
    }
  };

  const settle = (next: number): void => {
    const clamped = Math.max(0, Math.min(total - 1, next));
    if (clamped === index) return;
    index = clamped;
    options.onMove?.();
    paint();
  };

  const move = (step: -1 | 1): void => settle(index + step);

  const advance = (): void => {
    if (destroyed) return;
    if (index < total - 1) { move(1); return; }
    options.onPastEnd?.();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (destroyed || !event.isPrimary || event.button !== 0) return;
    /* Capturing a button's pointer retargets WebKit's click to the surface, so
       the controls are not part of the swipe area at all. */
    if (event.target instanceof Element && event.target.closest('button')) return;
    /* Nor is a text field: a horizontal drag inside one is a selection, and on
       iOS the selection handles are dragged the same way. */
    if (event.target instanceof Element
      && event.target.closest('input,textarea,select,[contenteditable]')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      surface.setPointerCapture?.(event.pointerId);
    } catch {
      /* Synthetic regression pointers are not registered as active in WebKit;
         the same bubbled stream still exercises the gesture without capture. */
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    const start = pointer;
    pointer = null;
    if (destroyed || !start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX
      || Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_RATIO) return;
    if (dx < 0) advance();
    else move(-1);
  };

  const onPointerCancel = (): void => { pointer = null; };

  const onArrowKey = (event: KeyboardEvent): void => {
    if (destroyed) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    move(event.key === 'ArrowLeft' ? -1 : 1);
  };

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerCancel);
  options.arrowKeys?.addEventListener('keydown', onArrowKey);

  return {
    get index() { return index; },
    get total() { return total; },
    setTotal(nextTotal, startIndex = 0) {
      total = Math.max(0, nextTotal);
      index = Math.max(0, Math.min(Math.max(0, total - 1), startIndex));
      paint();
    },
    move,
    advance,
    repaint: paint,
    destroy() {
      destroyed = true;
      pointer = null;
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerCancel);
      options.arrowKeys?.removeEventListener('keydown', onArrowKey);
    },
  };
}
