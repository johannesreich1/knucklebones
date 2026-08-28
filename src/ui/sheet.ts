// THE SHEET — one card that comes up from the bottom of the screen, and goes
// back down there. Born as the ladder's face-off (design 30c-foexit-grabber,
// user call 2026-08-22) and extracted the moment a second caller wanted it:
// the in-game badge, which deals the ONE mode or rune in play as its own card.
// There is no second copy of any of this. A caller hands in a body, a label
// and (optionally) a tint; the arrival, the wash, the grabber, the drag, the
// flick, the spring and the three doors out are the same code for every sheet
// the game will ever show. It is spelled across three files, one responsibility
// each: this one is the sheet — the spec, the one-at-a-time registry, the
// borrow/return of content and focus, and what dismissal MEANS. ui/sheet-flight
// owns where the card sits on its travel axis; ui/sheet-drag owns how a finger
// gets it dismissed.
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
import { subscribeLocale, t } from '../i18n/index.ts';
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
import { bindSheetGestures } from './sheet-drag.ts';
import { createSheetFlight } from './sheet-flight.ts';

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

  const grabber = ov.querySelector('.fograb') as HTMLButtonElement;
  const refreshInteractiveDragMode = (): void => interactiveLayout?.refresh();
  const flight = createSheetFlight(ov, card);
  /* ONE WAY OUT, THREE DOORS: the drag, the backdrop tap and Escape all end at
     `leave()`, which ends at the one close(). The flight owns how far and how
     fast the card travels; this owns what leaving MEANS for the room it covers,
     which is why the two steps below run inside the flight's own guard. */
  const leave = (): void => flight.leave(() => {
    spec.onDismiss?.();
    /* The established sheet exit stops intercepting the room underneath on
       frame one. Inert must leave on that same frame or the room still cannot
       receive the tap the transparent exit deliberately passes through. */
    releaseBackground();
  }, close);
  bindSheetGestures({
    overlay: ov,
    card,
    grabber,
    flight,
    interactive: !!spec.interactive,
    remeasure: refreshInteractiveDragMode,
    dismiss: leave,
  });
  document.addEventListener('keydown', onKey);
  flight.stage();
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
  flight.arrive();
  card.focus();
  return sheet;
}
