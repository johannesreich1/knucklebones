// THE FLIGHT (design 30c). The card comes up from the bottom of the screen and
// it goes back down there. ONE property carries the travel — `--fo-dy`,
// unitless px below the resting place — and main.css computes the card's
// transform AND the wash's alpha from it, so the two cannot disagree about how
// far the finger has got. `fly()` is the only thing that animates it: three
// flights (in, home, out) differing only by their numbers, handed to the one
// transition as --fo-t/--fo-e.
//
// This module is the sole owner of where the card sits on that axis: every
// duration and easing curve, REDUCED, the off-screen geometry and the `fofly`
// and `foout` classes live here and nowhere else. So the sheet's own exit
// policy (ui/sheet.ts) and the finger that drags the card (ui/sheet-drag.ts)
// both move it without knowing a single number.
import { REDUCED } from './fx.ts';

export interface SheetFlight {
  /** how far below its resting place the card sits right now, in px */
  travel(): number;
  /** Has the one exit already begun? Every door asks before it opens. */
  leaving(): boolean;
  /** Hand the card to the finger from where it IS, mid-flight or not. */
  seize(): void;
  /** Follow the finger to `dy` px below the resting place. */
  hold(dy: number): void;
  /** Park it off the bottom edge, before the overlay enters the document. */
  stage(): void;
  /** Up it comes, with the wash. */
  arrive(): void;
  /** A release short of the commit line: home, with a small overshoot. */
  springBack(): void;
  /** The one exit, and it happens once. `depart` runs synchronously inside the
   *  re-entrancy guard, so a dismissal raised from it cannot start a second
   *  flight; `gone` runs when the card has finished leaving the screen. */
  leave(depart: () => void, gone: () => void): void;
}

export function createSheetFlight(overlay: HTMLElement, card: HTMLElement): SheetFlight {
  let cur = 0, going = false;
  const setDy = (v: number): void => {
    cur = v; overlay.style.setProperty('--fo-dy', String(Math.round(v * 10) / 10));
  };
  const fly = (to: number, ms: number, ease: string): void => {
    overlay.style.setProperty('--fo-t', ms + 'ms');
    overlay.style.setProperty('--fo-e', ease);
    overlay.classList.add('fofly');
    /* WebKit may otherwise coalesce the transition class and destination into
       one style update, so the card simply appears at `to`. Commit the shared
       flight styles while the current dy is still the rendered start. This
       belongs here because arrival, spring-back and exit all use fly(). */
    void card.offsetHeight;
    setDy(to);
  };
  // how far below the fold the card's resting top is — rect.top already
  // carries the current translate, so the resting top is rect.top - cur
  const belowFold = (): number =>
    Math.ceil(window.innerHeight - card.getBoundingClientRect().top + cur + 24);
  return {
    travel: () => cur,
    leaving: () => going,
    seize: () => {
      /* a finger that lands MID-FLIGHT — on the way in, or on a spring-back —
         takes the card from where it IS, not from where the flight was headed,
         or the card jumps to meet the finger */
      const transform = getComputedStyle(card).transform;
      overlay.classList.remove('fofly');   // from here it follows the finger, not a curve
      setDy(transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0);
    },
    hold: (dy) => setDy(Math.max(0, dy)),
    stage: () => setDy(REDUCED ? 0 : window.innerHeight),   // start off the bottom edge...
    arrive: () => fly(0, 340, 'cubic-bezier(.16,1,.3,1)'),   // ...then up it comes with the wash
    springBack: () => fly(0, 220, 'cubic-bezier(.2,1.4,.4,1)'),
    leave: (depart, gone) => {
      if (going) return;
      going = true;
      depart();
      /* IT STOPS TAKING TAPS THE INSTANT IT STARTS LEAVING. The exit is a 190ms
         flight and the wash reaches alpha 0 about 40% into it — but the overlay
         still covers inset:0 until the sheet removes it, so for the rest of the
         flight an INVISIBLE sheet was swallowing the tap meant for whatever is
         underneath. The ✕ this card retired removed the overlay synchronously
         and never had the window; one class gives the flight the same manners. */
      overlay.classList.add('foout');
      // reduced motion: it still arrives and still leaves, it just does not travel
      if (REDUCED) { gone(); return; }
      fly(belowFold(), 180, 'cubic-bezier(.42,0,1,1)');
      window.setTimeout(gone, 190);
    },
  };
}
