// The iOS back gesture, for an app with no history stack: a rightward drag
// from the left screen edge presses the SAME Back control the open view's header
// shows. The header button stays the one navigation driver — the gesture is
// another finger on it, so the two can never disagree about where back leads.
//
// Views without that control refuse the gesture, each for its own reason:
// home is the root, the pass/result/loading screens have no "up", a question
// card (ask) wants an answer, matchmaking's hidden Back means Cancel is the only
// honest exit, and mid-game there is no paged view open at all.
import { press } from './tap.ts';
import { appRoot } from './embed.ts';
import { topPagedOverlay } from './page-surface.ts';

const EDGE = 24;    // arm zone: how far from the left edge a swipe may start
const TRAVEL = 60;  // rightward travel that commits it
const DRIFT = 30;   // vertical drift that reveals a scroll instead

/* The control an edge swipe would press: the shared Back component of the
   genuinely topmost page. page-surface owns z-index/DOM-order arbitration and
   refuses sheets or a non-page overlay that currently owns the room. */
function backControl(): HTMLElement | null {
  const top = topPagedOverlay(appRoot());
  const ico = top?.querySelector<HTMLElement>('.shead [data-page-back]');
  /* `press()` deliberately drives the real control programmatically, and a
     synthetic click is not stopped by HTML's inert hit-testing. Respect the
     same interaction boundary explicitly so a transient modal/page-owned mode
     cannot be escaped through its inert header. */
  return ico && !ico.closest('[inert]') && getComputedStyle(ico).visibility === 'visible'
    ? ico
    : null;
}

export function bindSwipeBack(): void {
  let armed: HTMLElement | null = null;
  let x0 = 0, y0 = 0;
  document.addEventListener('touchstart', (e) => {
    armed = null;
    if (e.touches.length !== 1 || e.touches[0].clientX > EDGE) return;
    armed = backControl();
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!armed) return;
    const t = e.touches[0];
    const dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
    if (dy > DRIFT && dy > dx) { armed = null; return; }   // a scroll, not a swipe
    if (dx < TRAVEL || dx < dy * 2) return;
    const ctl = armed;
    armed = null;
    /* commit — unless the touch itself already navigated (a touch that lands
       ON a bound control acts on pointerdown): press only the view we armed */
    if (backControl() === ctl) press(ctl);
  }, { passive: true });
  const disarm = (): void => { armed = null; };
  document.addEventListener('touchend', disarm);
  document.addEventListener('touchcancel', disarm);
}
