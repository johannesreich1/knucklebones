// DOM geography: which element is where, given that the two players can swap
// screen halves. EVERY lookup goes through sideKey()/S.bottom — never assume
// P1 is at the bottom (pass mode swaps halves, face mode doesn't).
import { SPEC, AI, type Player } from '../core/rules.ts';
import { S } from '../state.ts';

export const $ = (s: string) => document.querySelector(s) as HTMLElement;

/* THE HEADER GLASS ONLY EXISTS ONCE YOU SCROLL. At rest the bar is plain and
   the aurora behind it is unobstructed (user call — frosting a view nobody has
   moved dims the background for nothing); the frost fades in the moment
   content actually travels under it.
   ONE capture-phase listener serves EVERY paged view — the ones in the markup,
   the ones built lazily (the library, the online sheet) and the ones appended
   to endlessly (the ladder, match history) — because `scroll` does not bubble
   but it does capture. No view has to opt in, and none can forget. */
function markScrolled(body: Element): void {
  body.closest('.ov.paged')?.classList.toggle('scrolled', (body as HTMLElement).scrollTop > 1);
}
let watching = false;
export function watchPagedScroll(): void {
  if (watching) return;
  watching = true;
  document.addEventListener('scroll', (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.classList?.contains('pbody')) markScrolled(t);
  }, true);
}

export function show(sel: string): void {
  const el = $(sel);
  el.classList.add('on');
  /* a view opening at the top must not already wear the glass — and one whose
     body kept its place must. Appending rows fires no scroll event, so the
     state is settled here rather than inferred later. */
  el.querySelectorAll('.pbody').forEach(markScrolled);
}
export function hide(sel: string): void { $(sel).classList.remove('on'); }

export function sideKey(who: Player): 'bot' | 'top' { return who === S.bottom ? 'bot' : 'top'; }
export function ownerOf(sideEl: HTMLElement): Player { return +sideEl.dataset.owner! as Player; }

export function slotEl(who: Player, col: number, slot: number): HTMLElement | null {
  return document.querySelector('#' + sideKey(who) + 'Board .col[data-col="' + col + '"] .slot[data-slot="' + slot + '"]');
}
/* dice stack toward the centre line, so it depends on the half, not the player */
export function slotIdx(who: Player, i: number): number {
  return sideKey(who) === 'bot' ? i : SPEC.rows - 1 - i;
}
export function colEl(who: Player, c: number): HTMLElement | null {
  return document.querySelector('#' + sideKey(who) + 'Board .col[data-col="' + c + '"]');
}
export function chipEl(who: Player, c: number): HTMLElement {
  return document.querySelectorAll('#' + sideKey(who) + 'Cols .chip')[c] as HTMLElement;
}

/* is this player's half displayed upside-down right now? (portrait face mode) */
export function faceRotated(who: Player): boolean {
  // Ask the question the CSS asks -- <html>.face -- not the two local settings
  // it happens to be derived from offline. Online sets S.mode='duo' purely to
  // unlock input gating and never owns S.seat, so re-deriving here rotated
  // every ranked score float for anyone whose local seating was face-to-face.
  return who === AI && document.documentElement.classList.contains('face') &&
         !document.documentElement.classList.contains('land');
}

/* The deploy-truth tag. It lives on the Account panel, which the lazy online
   chunk injects — so this is called BOTH at boot (harmless no-op until the
   panel exists) and when Account opens. One function, so the two callers can
   never format it differently. */
export function stampBuild(): void {
  const el = document.getElementById('buildTag');
  if (el) el.textContent = 'build ' + (document.documentElement.dataset.build || 'dev');
}
