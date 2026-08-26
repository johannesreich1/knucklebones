// DOM geography: which element is where, given that the two players can swap
// screen halves. EVERY lookup goes through sideKey()/S.bottom — never assume
// P1 is at the bottom (pass mode swaps halves, face mode doesn't).
import { SPEC, AI, type Player } from '../core/rules.ts';
import { t } from '../i18n/index.ts';
import { S } from '../state.ts';
import { fit } from './layout.ts';
import { $ } from './query.ts';
import { isFaceToFace, isLandscapeLayout } from './game/root-state.ts';
import { appRoot } from './embed.ts';

export { $ } from './query.ts';

/* An id is an application query, never a document one: an embedding host may
   carry its own colliding ids. Application ids are literal alphanumerics, so
   the selector needs no escaping. */
export function byId(id: string): HTMLElement | null {
  return appRoot().querySelector('#' + id);
}

/* THE HEADER GLASS ARRIVES WITH THE CONTENT. At rest the bar is plain and the
   aurora behind it is unobstructed (user call — frosting a view nobody has
   moved dims the background for nothing). Past that it is a CONTINUOUS function
   of how far the body has actually travelled, not a switch: --sc runs 0..1 over
   the first --band + --headgap pixels, which is exactly the distance the first
   card takes to get behind the bar. Snapping to full on the first pixel read as
   a slab dropping in (user report, from the ladder).
   The distance lives in the STYLESHEET, beside the padding it is derived from,
   so the fade and the layout cannot drift apart — here it is only read.
   ONE capture-phase listener serves EVERY paged view — the ones in the markup,
   the ones built lazily (the library, the online sheet) and the ones appended
   to endlessly (the ladder, match history) — because `scroll` does not bubble
   but it does capture. No view has to opt in, and none can forget. */
interface GlassState { head: HTMLElement | null; ramp: number; sc: number }
const glass = new WeakMap<Element, GlassState>();
function markScrolled(body: Element): void {
  const ov = body.closest('.ov.paged') as HTMLElement | null;
  if (!ov) return;
  let g = glass.get(ov);
  if (!g) {
    /* The ramp is the distance the first card travels to get behind the bar —
       exactly .pbody's own reservation, --band + --headgap. Read from the
       stylesheet so the two cannot drift, and read as those TWO plain lengths
       rather than one calc(): a custom property is substitution-only, so
       getComputedStyle hands back the literal token stream — a calc() comes
       out as the string "calc(22px + 18px)" and parseFloat gives NaN. Asking
       for a derived var here silently fell through to the fallback below,
       which is the drift this was meant to prevent, wearing a disguise.
       Both are fixed px and never change for an overlay, so this is read once. */
    const cs = getComputedStyle(ov);
    const px = (n: string) => parseFloat(cs.getPropertyValue(n));
    const ramp = px('--band') + px('--headgap');
    g = { head: ov.querySelector('.shead'), ramp: ramp > 0 ? ramp : 40, sc: -1 };
    glass.set(ov, g);
  }
  if (!g.head) return;
  // iOS rubber-bands scrollTop NEGATIVE at the top, which would otherwise
  // author a negative opacity and be clamped to nothing anyway — clamp here so
  // the value written is always the one meant
  const y = Math.max(0, (body as HTMLElement).scrollTop);
  /* quantised: a flick fires many events per pixel of travel, and writing an
     unchanged custom property still costs a style invalidation. 1/50 is a step
     every 0.8px of the ramp — far below what an eye resolves in a fade. */
  const sc = Math.round(Math.min(1, y / g.ramp) * 50) / 50;
  if (sc === g.sc) return;
  g.sc = sc;
  /* WRITTEN ON THE BAR, NOT THE OVERLAY. A custom property inherits, so setting
     it on the overlay invalidates the computed style of everything inside it —
     and the view this exists for is the ladder, which holds the whole season.
     Measured on 600 rows at 4x CPU throttle (a mid-range phone): 5515us per
     write on the overlay against 20us on .shead, 275x, a third of a frame gone
     on every scroll event of a flick. .shead::before is the only thing that
     reads --sc, and a pseudo-element inherits from the element it belongs to,
     so the narrow target is also the correct one.
     Do NOT reach for @property to fix this: `inherits:false` would stop the
     value reaching ::before at all and the glass would simply never appear. */
  g.head.style.setProperty('--sc', String(sc));
}
/* Content REBUILT SHORT under a body that kept its offset: the browser clamps
   scrollTop to 0 at once but does not fire the scroll event until the next
   rendering turn, so a stale --sc paints for exactly one frame. Chromium shows
   it (a dark bar over an empty page for ~16ms when the ladder gives way to the
   short profile panel); WebKit does not. Anything that empties or swaps a
   paged body calls this straight after, and there is no frame to see. */
export function settleGlass(sel: string): void {
  appRoot().querySelector(sel)?.querySelectorAll('.pbody').forEach(markScrolled);
}
let watching = false;
export function watchPagedScroll(): void {
  if (watching) return;
  watching = true;
  appRoot().addEventListener('scroll', (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.classList?.contains('pbody')) markScrolled(t);
  }, true);
}

/* Opening or closing a screen can change the ORIENTATION POLICY — landscape
   belongs to the table and to its setup and result screens, not to menus
   (ui/layout.ts LANDSCAPE_SCREENS) — so the fit is re-taken here rather than
   waiting for a resize that will never come. layout reads the dependency-free
   query helper, so this behavior points one way: dom -> layout. */
export function show(sel: string): void {
  const el = $(sel);
  el.classList.add('on');
  fit();
  /* a view opening at the top must not already wear the glass — and one whose
     body kept its place must. Appending rows fires no scroll event, so the
     state is settled here rather than inferred later. */
  el.querySelectorAll('.pbody').forEach(markScrolled);
}
export function hide(sel: string): void { $(sel).classList.remove('on'); fit(); }

export function sideKey(who: Player): 'bot' | 'top' { return who === S.bottom ? 'bot' : 'top'; }
export function ownerOf(sideEl: HTMLElement): Player { return +sideEl.dataset.owner! as Player; }

export function slotEl(who: Player, col: number, slot: number): HTMLElement | null {
  return appRoot().querySelector('#' + sideKey(who) + 'Board .col[data-col="' + col + '"] .slot[data-slot="' + slot + '"]');
}
/* dice stack toward the centre line, so it depends on the half, not the player */
export function slotIdx(who: Player, i: number): number {
  return sideKey(who) === 'bot' ? i : SPEC.rows - 1 - i;
}
export function colEl(who: Player, c: number): HTMLElement | null {
  return appRoot().querySelector('#' + sideKey(who) + 'Board .col[data-col="' + c + '"]');
}
export function chipEl(who: Player, c: number): HTMLElement {
  return appRoot().querySelectorAll('#' + sideKey(who) + 'Cols .chip')[c] as HTMLElement;
}

/* is this player's half displayed upside-down right now? (portrait face mode) */
export function faceRotated(who: Player): boolean {
  // Ask the question the CSS asks -- #kbroot.face -- not the two local settings
  // it happens to be derived from offline. Online sets S.mode='duo' purely to
  // unlock input gating and never owns S.seat, so re-deriving here rotated
  // every ranked score float for anyone whose local seating was face-to-face.
  return who === AI && isFaceToFace() && !isLandscapeLayout();
}

/* The deploy-truth tag. It lives on the Account panel, which the lazy online
   chunk injects — so this is called BOTH at boot (harmless no-op until the
   panel exists) and when Account opens. One function, so the two callers can
   never format it differently. */
export function stampBuild(): void {
  const root = appRoot();
  const el = root.querySelector('#buildTag');
  // A full-page build owns <html>; an embedded build owns only #kbroot. Read
  // the narrowest owner first so a widget never borrows (or mutates) its host's
  // release identity.
  if (el) el.textContent = t('common', 'build', { tag: root.dataset.build
    || document.documentElement.dataset.build || 'dev' });
}
