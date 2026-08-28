// HOW A FINGER DISMISSES THE CARD. The pointer state machine that decides
// whether a press on the sheet is a tap, a drag, a flick or a spring-back —
// plus the two other doors that end in the same place: the backdrop tap and the
// grabber. Every one of them ends at the caller's `dismiss()`, so this module
// closes nothing itself and knows no duration: it moves the card only through
// the SheetFlight it is handed.
//
// It lives apart from ui/sheet.ts because a gesture is not the sheet. Escape
// reaches the same exit with no finger involved, and the four bug fixes the
// comments below record — the deferred capture, the click-swallow window, the
// fromWash arming, the pointercancel case — are all about pointers and none of
// them about what a sheet is.
import { Sfx } from './audio.ts';
import type { SheetFlight } from './sheet-flight.ts';

export interface SheetGestureSpec {
  overlay: HTMLElement;
  card: HTMLElement;
  /** the announceable door, and the drag surface once the body scrolls */
  grabber: HTMLButtonElement;
  flight: SheetFlight;
  /** an interactive sheet keeps its controls' taps and its body's native scroll */
  interactive: boolean;
  /** Re-read which surface owns the drag, so a press decides on fresh layout. */
  remeasure: () => void;
  /** where all three doors lead */
  dismiss: () => void;
}

/* Past 96px of travel the release sends it out; short of that it springs home
   with a small overshoot — but a FAST flick commits from anywhere, because a
   quick flick that springs back feels stuck. */
const COMMIT = 96, FLICK = 0.5;   // px, px/ms

/** Bind every gesture that can dismiss one sheet. The listener ORDER here is
 *  load-bearing: the click swallower and the backdrop door are both on the
 *  overlay, and when the overlay is itself the target the DOM runs them in
 *  registration order whatever their capture flags say. */
export function bindSheetGestures(spec: SheetGestureSpec): void {
  const { overlay: ov, card, grabber, flight } = spec;
  /* THE DRAG. A plain sheet owns its whole card. An interactive sheet does the
     same while its content fits, except that a real control always keeps its
     tap. Once the bounded body overflows, native scrolling wins and the full-
     width grabber remains the unambiguous drag surface. That is one policy for
     auth, confirmations, and every later form rather than a private gesture in
     each caller. */
  let id = -1, sy = 0, y0 = 0, moved = false, ly = 0, lt = 0, vy = 0, swallow = false, captured = false;
  let fromWash = false;   // did the press that this click ends start on the backdrop?
  let captureSurface: HTMLElement = card;
  const ownsControl = (target: EventTarget | null): boolean => target instanceof Element
    && !!target.closest('button,input,select,textarea,a,label,[contenteditable="true"],[role="button"]');
  card.addEventListener('pointerdown', (e) => {
    /* A DRAG IN PROGRESS is never hijacked — it holds the capture, so its own
       pointerup is guaranteed and it will clear this itself. A press that has
       NOT passed the slop holds nothing, and an uncaptured press released off
       the window never reports back at all, so a new press takes the gesture
       over rather than finding the card permanently undraggable. */
    if (flight.leaving() || (id !== -1 && moved) || e.button > 0) return;
    spec.remeasure();
    const fromGrabber = e.target instanceof Node && grabber.contains(e.target);
    if (spec.interactive && !fromGrabber
        && (ov.classList.contains('fooverflow') || ownsControl(e.target))) return;
    captureSurface = fromGrabber ? grabber : card;
    flight.seize();
    id = e.pointerId; sy = e.clientY; y0 = e.clientY - flight.travel();
    moved = false; vy = 0; ly = e.clientY; lt = e.timeStamp; swallow = false; captured = false;
    /* NOTHING IS CAPTURED HERE, and that is the whole point. Pointer capture
       retargets the compatibility click to the capture element, so capturing
       on contact turned every TAP on the grabber into a click on .focard: the
       button's own listener never ran, the backdrop's `target === ov` was
       false, and the card sat there (measured in webkit and chromium). A tap
       must reach its own target as an ordinary click; capture is what a DRAG
       needs, and the drag takes it the moment it becomes one. */
  });
  /* The moves and the lift are watched on the OVERLAY, not on the card: until
     the slop is passed there is no capture, and a finger that slides off the
     card's box before then would otherwise take its pointerup with it and
     leave the gesture stuck open. */
  ov.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    if (!moved) {
      if (Math.abs(e.clientY - sy) < 4) return;   // slop, so a tap stays a tap
      moved = true; ov.classList.add('fodrag');
      /* NOW it is a drag, so now it is captured — a scroll can no longer steal
         it mid-way. A synthetic pointer has no active id to capture and the
         gesture still works through these listeners, so never throw here. */
      try { captureSurface.setPointerCapture(e.pointerId); captured = true; } catch { captured = false; }
    }
    const dt = e.timeStamp - lt;
    if (dt > 0) { vy = (e.clientY - ly) / dt; ly = e.clientY; lt = e.timeStamp; }
    flight.hold(e.clientY - y0);
  });
  const drop = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    id = -1;
    ov.classList.remove('fodrag');
    try { captureSurface.releasePointerCapture(e.pointerId); } catch { /* never captured */ }
    if (!moved) return;
    /* THE CHASING CLICK — after a real drag that really LIFTED, and only then.
       Where capture took, the click that follows the lift is handed to .focard
       and means nothing there. Where it did not (a synthetic pointer), the
       click lands on the nearest common ancestor of down and up: the grabber
       if the finger never left it, the overlay itself if it did — and both of
       those are doors, so a spring-back would be chased by the dismissal the
       player just decided against. One click is swallowed for that case.
       A POINTERCANCEL PRODUCES NO CLICK AT ALL, so arming there left the flag
       lying in wait to eat the player's next honest tap on the backdrop.
       NEITHER DOES A TOUCH THAT WAS CAPTURED, which is every real drag on a
       phone: no compatibility click follows it, so the flag was never spent
       and the next tap on the wash — the player changing their mind and
       reaching for the way out — did nothing for 400ms. Measured 3/3 with a
       trusted touch stream. Where capture DID take, the chasing click is
       handed to .focard and is already harmless, so there was nothing to
       swallow either. The flag therefore arms in exactly one case: a lift
       from a gesture that was never captured. */
    /* A captured card drag retargets the compatibility click to the harmless
       card. A grabber capture retargets it to the dismissal button, so that
       same click must be swallowed after a spring-back. */
    if (e.type === 'pointerup' && (!captured || captureSurface === grabber)) {
      swallow = true;
      window.setTimeout(() => { swallow = false; }, 400);
    }
    const flick = e.timeStamp - lt < 80 && vy > FLICK;
    const dy = flight.travel();
    if (dy > COMMIT || (flick && dy > 12)) { Sfx.tap(); spec.dismiss(); }
    else flight.springBack();
  };
  ov.addEventListener('pointerup', drop);
  ov.addEventListener('pointercancel', drop);
  /* A NEW PRESS ANYWHERE ENDS THE WINDOW. The reset above lives on the card's
     own pointerdown, which a tap on the WASH never runs — so a stale flag
     outlived the gesture it belonged to and ate the next tap. The window is
     for one click chasing one lift, and a fresh press means that click is
     never coming.
     THE SAME PRESS ARMS THE BACKDROP, and that is what makes this sheet safe
     to open from a TAP. The face-off is opened by a click listener, so the
     gesture that asked for it is over before the card exists. The in-game
     badge is bound with ui/input's tap(), which fires on POINTERUP — the
     overlay is inserted mid-gesture, and the compatibility click that follows
     the finger is then hit-tested against a wash that was not there when the
     finger went down. Measured: every tap on a chip dealt the card and
     dismissed it in the same breath, with nothing in the DOM to show for it.
     A dismissal must be a press that STARTED on the backdrop, so the door
     arms on pointerdown and the opening gesture can never reach it. */
  ov.addEventListener('pointerdown', (e) => { swallow = false; fromWash = e.target === ov; }, true);
  // capture, so it runs before the backdrop's listener and before the grabber's
  ov.addEventListener('click', (e) => {
    if (!swallow) return;
    swallow = false; e.stopPropagation(); e.preventDefault();
  }, true);

  ov.addEventListener('click', (e) => { if (e.target === ov && fromWash) { Sfx.tap(); spec.dismiss(); } });
  // the grabber is the announceable door: a screen reader and a keyboard both
  // reach it, and a plain tap on the bar dismisses like the drag it advertises
  grabber.addEventListener('click', () => { Sfx.tap(); spec.dismiss(); });
}
