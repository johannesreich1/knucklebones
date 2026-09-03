// THE ONE PAGE TRANSITION: the platform push (design study 57e, selected
// 2026-09-02). The page on top slides in from the right edge; the page
// underneath parallaxes a third of the way out under a darkening scrim; Back
// is the exact reverse. Everything here is transform or opacity — the wipe it
// replaces animated `clip-path` on full-screen blurred overlays and a beam's
// `left`, which cost layout and paint on every frame and heated the phone.
//
// Pure data: the controller (page-motion.ts) owns the surfaces and the
// timing, so this module can be read by tests and design tooling without a
// DOM. Nothing here knows which element is which.

export type PageMotionDirection = 'forward' | 'back';

export const PUSH_DURATION = 420;
export const PUSH_EASE = 'cubic-bezier(.32,.72,0,1)';
export const BRACKET_DURATION = 220;
export const BRACKET_EASE = 'cubic-bezier(.16,1,.3,1)';
export const REDUCED_DURATION = 120;
/** How dark the page underneath goes at the end of a forward push. */
export const SCRIM_OPACITY = .45;
/** How far a reused shell's title travels in with its page. */
export const TITLE_TRAVEL_PX = 24;

/* The page on top starts one viewport to the right; the page underneath
   ends a third of a viewport to the left. Viewport units so a full-screen
   overlay and a panel inside a shell share one recipe. */
const OVER_OFFSTAGE = 'translateX(100vw)';
const UNDER_OFFSTAGE = 'translateX(-33vw)';
const HOME = 'translateX(0)';

export interface PushTimeline {
  /** The departing surface. */
  readonly source: Keyframe[];
  /** The arriving surface. */
  readonly target: Keyframe[];
  /** The scrim over the page underneath. */
  readonly scrim: Keyframe[];
  /** A reused shell's opaque slab, which travels with the page on top. */
  readonly slab: Keyframe[];
  /** A reused shell's title, which arrives with its page. */
  readonly title: Keyframe[];
}

export function pushTimeline(direction: PageMotionDirection): PushTimeline {
  /* THE OPACITY IS LOAD-BEARING, not decoration. Routing removes .on before
     the compositor takes over, and a bare .ov is opacity:0 (overlays.css) with
     its fade cancelled by .page-motion-source — which restores visibility and
     says nothing about opacity. So a departing page is only on screen because
     this timeline holds it there. Without it Back slid an INVISIBLE page out:
     the source alone covers the strip to the right of the arriving page, and
     through that hole the player watched the duel table, in-game Leave button
     included, for the whole 420ms (reported from a device 2026-09-03). The
     wipe this replaced carried the same 1 in every keyframe. */
  const over = [
    { transform: OVER_OFFSTAGE, opacity: 1 },
    { transform: HOME, opacity: 1 },
  ];
  const under = [
    { transform: HOME, opacity: 1 },
    { transform: UNDER_OFFSTAGE, opacity: 1 },
  ];
  const scrim = [{ opacity: 0 }, { opacity: SCRIM_OPACITY }];
  const travel = direction === 'forward' ? TITLE_TRAVEL_PX : -TITLE_TRAVEL_PX;
  const title = [
    { opacity: 0, transform: `translateX(${travel}px)` },
    { opacity: 1, transform: HOME },
  ];
  if (direction === 'forward') {
    return { source: under, target: over, scrim, slab: over, title };
  }
  const reverse = (frames: Keyframe[]): Keyframe[] => [...frames].reverse();
  return {
    source: reverse(over),
    target: reverse(under),
    scrim: reverse(scrim),
    slab: reverse(over),
    title,
  };
}
