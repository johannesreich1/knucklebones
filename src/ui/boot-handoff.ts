/* THE BOOT HANDOFF — design study 15b / A2 "Land and settle", chosen 2026-09-03.
 *
 * The launcher tile, the launch screen and the Home hero are one object. Until
 * now the join between the last two was a hard cut: the OS painted its static
 * frame, the webview took the screen, and Home was simply THERE. This is the
 * beat that carries one into the other.
 *
 * WHAT IT DOES. The webview's first painted frame reproduces the launch screen
 * — the mark at the storyboard's size, dead centre, colourless, because the
 * launch image is greyscale so that ONE image can stand in front of 42 hue
 * pairs. It then rises to its seat in the hero over 340ms and takes the
 * player's own colours on the way, with the type and the stack coming up
 * behind it. The colour arriving IS the handoff: it is the first thing in the
 * boot sequence that could not have been baked into a static image.
 *
 * THE END STATE IS transform:none. The start is an offset measured at runtime;
 * the end is the mark's real seat by construction, so it cannot land in the
 * wrong place on a device whose layout differs from the one it was tuned on.
 * The study's first draft hard-coded the travel and dropped the die onto the
 * wordmark — that is what this signature exists to prevent.
 */
import { SPLASH_MARK_FRACTION } from '../app-icon-registry.ts';
import { HOME_MARK_SIZE } from './split-mark.ts';

/** The mark paints 96 of its 120-unit canvas, so a 96px frame inks 76.8px. */
const HOME_MARK_INK = HOME_MARK_SIZE * (96 / 120);

/* Long enough for the two transitions the CSS runs (340ms mark, 320ms stack
   starting at 180) plus a frame of slack. It only removes classes. */
const HANDOFF_MS = 700;

/**
 * Stage the boot handoff on `root`, measuring from `mark`'s settled seat.
 *
 * Call once, after Home's first layout and before anything else moves. Returns
 * false when the handoff was declined — reduced motion, a mark that is not
 * laid out, or a viewport we cannot measure — leaving Home in its settled
 * state, which is the correct fallback rather than a degraded animation.
 */
export function playBootHandoff(root: HTMLElement, mark: HTMLElement): boolean {
  let reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { reduced = false; }
  if (reduced) return false;

  const seat = mark.getBoundingClientRect();
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  if (!seat.width || !viewW || !viewH) return false;

  /* The storyboard renders one square under scaleAspectFill, so on any screen
     the square covers by its LONGER side and is cropped on the other. The
     mark's ink is a fixed fraction of that square — which is why this reads
     max(), not the width. */
  const splashInk = SPLASH_MARK_FRACTION * Math.max(viewW, viewH);
  const scale = splashInk / HOME_MARK_INK;

  root.style.setProperty('--boot-dx', `${(viewW / 2 - (seat.left + seat.width / 2)).toFixed(2)}px`);
  root.style.setProperty('--boot-dy', `${(viewH / 2 - (seat.top + seat.height / 2)).toFixed(2)}px`);
  root.style.setProperty('--boot-scale', scale.toFixed(4));
  root.classList.add('booting');

  /* Two frames, not one: the first lets the browser adopt the start state, the
     second starts the transition from it. Collapsing them makes the transition
     run from the SETTLED values and the mark never travels. */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.classList.add('boot-run');
    window.setTimeout(() => {
      root.classList.remove('booting', 'boot-run');
      for (const name of ['--boot-dx', '--boot-dy', '--boot-scale']) {
        root.style.removeProperty(name);
      }
    }, HANDOFF_MS);
  }));
  return true;
}
