// THE RESULT'S IDENTITY PLATES — who played, and the one slam that says so.
//
// Split out of ui/endscreen.ts so the shell keeps room for the spec, the live
// wiring and the entrance; this file owns the last deal, the once-per-result
// stamp window, the re-deal theatre, and the plates' locale repaint. Every
// reader of `dealt` lives here, so the stamp rule cannot be half-applied from
// somewhere else.
import { $ } from './dom.ts';
import { Sfx } from './audio.ts';
import { fillPlate, repaintPlateLocale, type PlateSpec } from './plate.ts';

/* an identity plate on the result (design 36f) — the home plate's spec plus
   an optional door. With a tap the row is a <button> and grows its chevron. */
export interface EndPlate extends PlateSpec { tap?: () => void }

/* the last deal, kept so the theatre can run again on a screen that was only
   covered — the plates are the one thing here that is worth a second showing */
let dealt: EndPlate[] = [];

/* A NEW result: re-arming the stamp and dealing is ONE call, because that pair
   IS the once-per-result slam rule (see setPlates). Split apart, a caller can
   present a fresh verdict whose stamp never slams — or re-arm a late re-deal
   of the SAME result, which is why that path still calls setPlates directly. */
export function dealFreshPlates(plates: EndPlate[]): void {
  delete $('#endPlates').dataset.dealtAt;   // the stamp may slam again
  setPlates(plates);
}

/* the plates can arrive LATE too, for the same reason the context line does —
   ranked deals them from cache and re-deals once the fresh standing lands */
export function setPlates(plates: EndPlate[]): void {
  const box = $('#endPlates');
  dealt = plates;
  /* the slam (styles: .pstamp) plays ONCE per result — a re-deal carries
     fresh numbers, not a fresh verdict. But only once it truly played: a
     re-deal landing inside the slam's delay+duration window (~1.7s) rebuilds
     the stamp before it ever rendered, so there the animation restarts
     instead of being suppressed — the player still sees exactly one slam. */
  const first = Number(box.dataset.dealtAt || 0);
  box.classList.toggle('restamp', !!first && performance.now() - first > 1700);
  if (plates.length && !first) box.dataset.dealtAt = String(performance.now());
  box.innerHTML = '';
  box.hidden = !plates.length;
  for (const p of plates) {
    const el = document.createElement(p.tap ? 'button' : 'div');
    // the result's plates wear the roomier cut by default; a spec may override
    fillPlate(el, { large: true, ...p, chev: p.chev ?? !!p.tap });
    if (p.tap) el.addEventListener('click', () => { Sfx.tap(); p.tap!(); });
    box.appendChild(el);
  }
}

/* THE PLATES' THEATRE, RUN AGAIN — and nothing else on the screen with it.
   A screen that was merely COVERED (the own plate's door to the profile, see
   online/ui) comes back to a still frame, so it gets one beat of life: the
   cards deal in turn, the stamp slams, the beaten row takes the hit. The
   title landed once and the fireworks fired once — replaying those would
   announce a second verdict rather than resume the one already given (user
   call). Dealing them FRESH is what re-arms the slam and rebuilds the rows,
   and rebuilding a node is what restarts a CSS animation. */
export function replayPlates(): void {
  if (!dealt.length) return;
  dealFreshPlates(dealt);
}

/** Repaint the mounted rows in the current locale, adopting `next` first when
    a fresh deal is a translation of what is on screen rather than a different
    result — the rows are zipped to `dealt` by index, so a differing length
    must keep the deal the player is actually looking at. */
export function repaintPlatesLocale(next?: EndPlate[]): void {
  if (next?.length === dealt.length) dealt = next;
  const box = $('#endPlates');
  Array.from(box.children).forEach((plate, index) => {
    const spec = dealt[index];
    if (spec) repaintPlateLocale(plate as HTMLElement, { large: true, ...spec });
  });
}

/** The screen is gone: forget the deal so nothing can replay it onto a result
    that is no longer being shown. The rows themselves are left where they are
    — the next result rebuilds the box. */
export function forgetPlates(): void {
  dealt = [];
}
