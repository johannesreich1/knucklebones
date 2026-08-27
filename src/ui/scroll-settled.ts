/* MAY I WRITE scrollTop RIGHT NOW?
   iOS WebKit treats a programmatic scroll write during a touch-driven scroll as
   "the gesture is over": the fling dies with a jolt. A windowed list needs the
   occasional write anyway, so it asks here first and the write waits for a
   moment when nobody is mid-gesture.
   The answer is deliberately conservative and deliberately RETRYABLE. This
   reports "the scroll has PAUSED", which is the most a timer can honestly claim
   — Chrome's own scrollend announcement says as much — so whatever it gates
   must be idempotent and must be offered again on the next scroll event rather
   than dropped. Anything built on "the fling has ended" is built on a guess. */

/* After the last finger lifts. WebKit keeps attributing writes to the
   just-ended gesture for a beat; this is TanStack Virtual's shipped number for
   the same problem, roughly nine frames at 60Hz. */
const REST_MS = 150;
/* Quiet time with no scroll event. Deceleration fires an event every frame
   until it stops, so silence is the momentum test where scrollend is missing.
   150ms to match the only prior art (TanStack's isScrollingResetDelay); a
   shorter window loses to one long task, and this app already profiles against
   a 4x-throttled phone where a single style write measured 5.5ms. */
const QUIET_MS = 150;
/* scrollHeight and clientHeight are integer-rounded while scrollTop is
   subpixel, so a genuinely settled bottom can read a pixel past the computed
   maximum. At 0.5 the end of a list reports "never settled" and whatever waits
   on it never fires — precisely where an infinite list needs it most. */
const EDGE_SLACK = 1.5;

export interface ScrollSettled {
  /** True when a write will not cost the reader their momentum. */
  settled(): boolean;
  /** True while the scroller is in iOS elastic overscroll. A write here both
      kills the bounce and can strand the content, so it is a hard veto. */
  elastic(): boolean;
  /** Has this scroller seen touch at all? A mouse or trackpad reader is never
      mid-fling in the way this guards against. */
  touchDriven(): boolean;
  destroy(): void;
}

/* `wake` is called when a write that was refused might now be allowed, so the
   caller never has to poll. It fires on scroll, on touch end, and once each
   timer elapses — a flush is never left waiting for an event that will not
   come, which is the failure mode of gating on scroll events alone. */
export function watchScrollSettled(
  scroller: HTMLElement,
  wake: () => void,
  now: () => number = () => performance.now(),
): ScrollSettled {
  let fingers = 0;
  let lastTouchEnd = -Infinity;
  let lastScroll = -Infinity;
  let sawTouch = false;
  let ended = false;
  let timer = 0;
  let dead = false;

  const wakeIn = (ms: number): void => {
    if (dead || timer) return;
    timer = setTimeout(() => {
      timer = 0;
      if (!dead) wake();
    }, ms) as unknown as number;
  };

  const listen = (type: string, fn: () => void): void => {
    scroller.addEventListener(type, fn, { passive: true });
  };

  const down = (): void => {
    fingers++;
    sawTouch = true;
    ended = false;
  };
  const up = (): void => {
    fingers = Math.max(0, fingers - 1);
    if (fingers === 0) lastTouchEnd = now();
    wakeIn(REST_MS);
  };
  const scrolled = (): void => {
    lastScroll = now();
    ended = false;
    wake();
    wakeIn(QUIET_MS);
  };
  /* An accelerator, never a dependency. Detected by CAPABILITY rather than by
     version: scrollend landed in Safari 26.2, so on most of the installed iOS
     base the quiet timer below is the PRIMARY path, not a legacy fallback. */
  const supportsScrollend = typeof window !== 'undefined' && 'onscrollend' in window;
  const finished = (): void => { ended = true; wake(); };

  listen('touchstart', down);
  listen('touchend', up);
  listen('touchcancel', up);
  listen('scroll', scrolled);
  if (supportsScrollend) listen('scrollend', finished);

  const elastic = (): boolean => {
    /* iOS rubber-bands scrollTop NEGATIVE at the top and past the maximum at
       the bottom — src/ui/dom.ts already clamps for the same reason. Note this
       signal disappears entirely under overscroll-behavior: none, so a rule
       adding that to this scroller would silently make elastic() always false. */
    const y = scroller.scrollTop;
    const max = scroller.scrollHeight - scroller.clientHeight;
    return y < -EDGE_SLACK || y > max + EDGE_SLACK;
  };

  return {
    elastic,
    touchDriven: () => sawTouch,
    settled(): boolean {
      if (fingers > 0) return false;                        // a finger owns it
      const t = now();
      if (t - lastTouchEnd < REST_MS) return false;         // the gesture's tail
      if (!ended && t - lastScroll < QUIET_MS) return false; // still moving
      return !elastic();                                    // not mid-bounce
    },
    destroy(): void {
      dead = true;
      if (timer) clearTimeout(timer);
      timer = 0;
      scroller.removeEventListener('touchstart', down);
      scroller.removeEventListener('touchend', up);
      scroller.removeEventListener('touchcancel', up);
      scroller.removeEventListener('scroll', scrolled);
      if (supportsScrollend) scroller.removeEventListener('scrollend', finished);
    },
  };
}
