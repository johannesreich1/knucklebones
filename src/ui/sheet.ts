// THE SHEET — one card that comes up from the bottom of the screen, and goes
// back down there. Born as the ladder's face-off (design 30c-foexit-grabber,
// user call 2026-08-22) and extracted the moment a second caller wanted it:
// the in-game badge, which deals the ONE mode or rune in play as its own card.
// There is no second copy of any of this. A caller hands in a body, a label
// and (optionally) a tint; everything below — the arrival, the wash, the
// grabber, the drag, the flick, the spring, the three doors out — is the same
// code for every sheet the game will ever show.
//
// WHY THE CLASS NAMES STAYED `fo*`. This is the sheet's family, not the
// face-off's, but it ships under the names it was born with on purpose: two
// design cards (design/screens/product/30-leaderboard-faceoff, 30c-foexit-grabber)
// write `.faceoff/.focard/.fograb/.fobar` by hand and are explicit about
// wearing the SHIPPED rules at their shipped sizes, and those cards are synced
// separately from this repo's commits. Renaming would leave them painting
// unstyled boxes with nothing here able to fix them. The component is the
// SHEET; `fo` is what its CSS is called.
//
// Lives in ui/ rather than online/: the badge exists in every game, offline
// included, and ui/ is the layer both drivers already share.
import { Sfx } from './audio.ts';
import { subscribeLocale, t } from '../i18n/index.ts';
import { REDUCED } from './fx.ts';
import { appRoot } from './embed.ts';
import {
  makeModalBackgroundInert,
  restoreModalBackground,
  type InertSnapshot,
} from './modal-background.ts';
import {
  observeInteractiveSheetLayout,
  type InteractiveSheetLayout,
} from './sheet-interactive-layout.ts';

export interface SheetSpec {
  /** the card's content, below the grabber. Trusted markup — escape first. */
  body?: string;
  /** A stable interactive subtree. It is restored to its exact DOM slot on close. */
  content?: HTMLElement;
  /** what a screen reader calls this dialog */
  label: string | (() => string);
  /** the variant's own class on the overlay ('faceoff', 'faceoff solo', 'libsheet') */
  cls?: string;
  /** the card's own light: a hue token that dresses border, glow and heading */
  tint?: string;
  /** Forms keep working controls and scroll only when their bounded body overflows. */
  interactive?: boolean;
  /** Repaint only locale-owned descendants already mounted in the card. */
  repaintLocale?: (card: HTMLElement) => void;
  /** Called when the player dismisses through Escape, backdrop, grabber or drag. */
  onDismiss?: () => void;
  /** Called after every close, including a caller-requested immediate close. */
  onClose?: () => void;
  /** Override the control that regains focus when the sheet is gone.
   * A resolver survives callers that repaint their opener while this sheet is open. */
  restoreFocus?: HTMLElement | null | (() => HTMLElement | null);
}
export interface Sheet {
  ov: HTMLElement;
  card: HTMLElement;
  /** Close immediately. Successful transitions can suppress returning to the opener. */
  close: (restoreOpener?: boolean) => void;
}

/* ONE SHEET AT A TIME. Nothing can currently stack them — a sheet covers
   inset:0, so the control that would open the next one is behind it — but a
   sheet left standing owns a document keydown listener, and two of those
   answering one Escape is the kind of leak that only shows up as a second
   card flickering away. */
let live: Sheet | null = null;
export const sheetOpen = (): boolean => !!live;

/** Close the one shared sheet before a higher-priority route takes the room. */
export function closeOpenSheet(restoreOpener = true): boolean {
  const active = live;
  if (!active) return false;
  active.close(restoreOpener);
  return true;
}

export function showSheet(spec: SheetSpec): Sheet {
  live?.close();
  if ((spec.body === undefined) === (spec.content === undefined)) {
    throw new TypeError('A sheet needs exactly one of body or content');
  }
  const opener = spec.restoreFocus !== undefined
    ? spec.restoreFocus
    : document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ov = document.createElement('div');
  ov.className = 'faceoff' + (spec.cls ? ' ' + spec.cls : '')
    + (spec.interactive ? ' fointeractive' : '');
  ov.innerHTML = `<div class="focard${spec.tint ? ' hued' : ''}" role="dialog" aria-modal="true" tabindex="-1">
    <button type="button" class="fograb" aria-label="${t('common', 'actions.close')}"><span class="fobar"></span></button>
  </div>`;
  const card = ov.querySelector('.focard') as HTMLElement;
  const resolvedLabel = (): string => typeof spec.label === 'function' ? spec.label() : spec.label;
  /* the label is SET, not interpolated: a nickname carries whatever the player
     typed, and an attribute built by string concatenation is one quote away
     from being someone else's markup */
  card.setAttribute('aria-label', resolvedLabel());
  if (spec.tint) card.style.setProperty('--mh', spec.tint);
  const contentHome = spec.content ? {
    parent: spec.content.parentNode,
    next: spec.content.nextSibling,
  } : null;
  if (spec.body !== undefined) card.insertAdjacentHTML('beforeend', spec.body);
  else card.appendChild(spec.content!);

  let unbindLocale = (): void => undefined;
  let interactiveLayout: InteractiveSheetLayout | null = null;
  let closed = false;
  let background: readonly InertSnapshot[] = [];
  let backgroundRestored = false;
  const releaseBackground = (): void => {
    if (backgroundRestored) return;
    backgroundRestored = true;
    restoreModalBackground(background);
  };
  const close = (restoreOpener = true): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    unbindLocale();
    interactiveLayout?.disconnect();
    if (spec.content && contentHome) {
      if (contentHome.parent) {
        if (contentHome.next?.parentNode === contentHome.parent) {
          contentHome.parent.insertBefore(spec.content, contentHome.next);
        } else {
          contentHome.parent.appendChild(spec.content);
        }
      } else {
        spec.content.remove();
      }
    }
    ov.remove();
    releaseBackground();
    if (live === sheet) live = null;
    spec.onClose?.();
    /* Escape's own default handling can replace a synchronous focus after the
       listener returns, so restore on the next frame. A replacement sheet wins
       through `live`, and successful navigation calls close(false). */
    if (restoreOpener) requestAnimationFrame(() => {
      const target = typeof opener === 'function' ? opener() : opener;
      if (live || !target?.isConnected || target.inert || !target.getClientRects().length) return;
      target.focus({ preventScroll: true });
    });
  };
  const onKey = (e: KeyboardEvent): void => {
    /* The legal modal is allowed to stack over a sheet. Its earlier keyboard
       owner prevents the event after closing only that top layer. */
    if (e.key === 'Escape' && !e.defaultPrevented) leave();
  };

  /* ---- THE FLIGHT (design 30c). It comes up from the bottom and it goes back
     down there. ONE property carries the travel — `--fo-dy`, unitless px below
     the resting place — and main.css computes the card's transform AND the
     wash's alpha from it, so the two cannot disagree about how far the finger
     has got. `fly()` is the only thing that animates it: three flights (in,
     home, out) differing only by their numbers, handed to the one transition
     as --fo-t/--fo-e. And ONE WAY OUT, three doors: the drag, the backdrop
     tap and Escape all end at `leave()`, which ends at the one close(). */
  let cur = 0, going = false;
  const setDy = (v: number): void => {
    cur = v; ov.style.setProperty('--fo-dy', String(Math.round(v * 10) / 10));
  };
  const fly = (to: number, ms: number, ease: string): void => {
    ov.style.setProperty('--fo-t', ms + 'ms');
    ov.style.setProperty('--fo-e', ease);
    ov.classList.add('fofly');
    /* WebKit may otherwise coalesce the transition class and destination into
       one style update, so the card simply appears at `to`. Commit the shared
       flight styles while the current dy is still the rendered start. This
       belongs here because arrival, spring-back and exit all use fly(). */
    void card.offsetHeight;
    setDy(to);
  };
  // how far below the fold the card's resting top is — rect.top already
  // carries the current translate, so the resting top is rect.top - cur
  const gone = (): number => Math.ceil(window.innerHeight - card.getBoundingClientRect().top + cur + 24);
  const leave = (): void => {
    if (going) return;
    going = true;
    spec.onDismiss?.();
    /* The established sheet exit stops intercepting the room underneath on
       frame one. Inert must leave on that same frame or the room still cannot
       receive the tap the transparent exit deliberately passes through. */
    releaseBackground();
    /* IT STOPS TAKING TAPS THE INSTANT IT STARTS LEAVING. The exit is a 190ms
       flight and the wash reaches alpha 0 about 40% into it — but the overlay
       still covers inset:0 until close() removes it, so for the rest of the
       flight an INVISIBLE sheet was swallowing the tap meant for whatever is
       underneath. The ✕ this card retired removed the overlay synchronously
       and never had the window; one class gives the flight the same manners. */
    ov.classList.add('foout');
    // reduced motion: it still arrives and still leaves, it just does not travel
    if (REDUCED) { close(); return; }
    fly(gone(), 180, 'cubic-bezier(.42,0,1,1)');
    window.setTimeout(close, 190);
  };

  /* THE DRAG. A plain sheet owns its whole card. An interactive sheet does the
     same while its content fits, except that a real control always keeps its
     tap. Once the bounded body overflows, native scrolling wins and the full-
     width grabber remains the unambiguous drag surface. That is one policy for
     auth, confirmations, and every later form rather than a private gesture in
     each caller. Past 96px of travel the release sends it out; short of that it
     springs home with a small overshoot — but a FAST flick commits from
     anywhere, because a quick flick that springs back feels stuck. */
  const COMMIT = 96, FLICK = 0.5;   // px, px/ms
  let id = -1, sy = 0, y0 = 0, moved = false, ly = 0, lt = 0, vy = 0, swallow = false, captured = false;
  let fromWash = false;   // did the press that this click ends start on the backdrop?
  const grabber = ov.querySelector('.fograb') as HTMLButtonElement;
  let captureSurface: HTMLElement = card;
  const refreshInteractiveDragMode = (): void => interactiveLayout?.refresh();
  const ownsControl = (target: EventTarget | null): boolean => target instanceof Element
    && !!target.closest('button,input,select,textarea,a,label,[contenteditable="true"],[role="button"]');
  card.addEventListener('pointerdown', (e) => {
    /* A DRAG IN PROGRESS is never hijacked — it holds the capture, so its own
       pointerup is guaranteed and it will clear this itself. A press that has
       NOT passed the slop holds nothing, and an uncaptured press released off
       the window never reports back at all, so a new press takes the gesture
       over rather than finding the card permanently undraggable. */
    if (going || (id !== -1 && moved) || e.button > 0) return;
    refreshInteractiveDragMode();
    const fromGrabber = e.target instanceof Node && grabber.contains(e.target);
    if (spec.interactive && !fromGrabber
        && (ov.classList.contains('fooverflow') || ownsControl(e.target))) return;
    captureSurface = fromGrabber ? grabber : card;
    /* a finger that lands MID-FLIGHT — on the way in, or on a spring-back —
       takes the card from where it IS, not from where the flight was headed,
       or the card jumps to meet the finger */
    const t = getComputedStyle(card).transform;
    ov.classList.remove('fofly');   // from here it follows the finger, not a curve
    setDy(t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0);
    id = e.pointerId; sy = e.clientY; y0 = e.clientY - cur;
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
    setDy(Math.max(0, e.clientY - y0));
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
    if (cur > COMMIT || (flick && cur > 12)) { Sfx.tap(); leave(); }
    else fly(0, 220, 'cubic-bezier(.2,1.4,.4,1)');
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

  ov.addEventListener('click', (e) => { if (e.target === ov && fromWash) { Sfx.tap(); leave(); } });
  // the grabber is the announceable door: a screen reader and a keyboard both
  // reach it, and a plain tap on the bar dismisses like the drag it advertises
  grabber.addEventListener('click', () => { Sfx.tap(); leave(); });
  document.addEventListener('keydown', onKey);
  setDy(REDUCED ? 0 : window.innerHeight);   // start off the bottom edge...
  const root = appRoot();
  root.appendChild(ov);
  background = makeModalBackgroundInert(root, ov);
  /* CLAIMED BEFORE ANYTHING BELOW CAN THROW: from the line above the overlay
     covers the room and every sibling is inert, and closeOpenSheet() reaches
     the only way out through `live`. Registering last left a card nobody could
     dismiss standing over an inert app if the lines below ever threw. */
  const sheet: Sheet = { ov, card, close };
  live = sheet;
  if (spec.interactive && spec.content) {
    interactiveLayout = observeInteractiveSheetLayout(ov, card, spec.content);
  }
  unbindLocale = subscribeLocale(() => {
    (ov.querySelector('.fograb') as HTMLButtonElement)
      .setAttribute('aria-label', t('common', 'actions.close'));
    card.setAttribute('aria-label', resolvedLabel());
    spec.repaintLocale?.(card);
    refreshInteractiveDragMode();
  });
  fly(0, 340, 'cubic-bezier(.16,1,.3,1)');   // ...resolved, then up it comes with the wash
  card.focus();
  return sheet;
}
