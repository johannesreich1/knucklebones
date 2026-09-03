import { REDUCED } from '../../ui/fx.ts';

/** The fill the ring is showing, or is on its way to. Held HERE rather than
    read back off --p, because Profile asks for the same fill several times per
    open (account-screen.ts) and a mid-sweep --p makes each of those look like a
    new destination — which is how one open came to sweep twice. */
interface RingFill {
  readonly run: number;
  readonly target: number;
}

const ringFill = new WeakMap<HTMLElement, RingFill>();
/** Closer than this and it is the same fill: a 270deg arc cannot show it. */
const SAME = .002;

/** Empty the ring and forget the fill it was showing, so the next fill sweeps
    in from nothing. This is what makes an ARRIVAL at Profile animate while a
    restatement of the frame already on screen does not. */
export function clearAccountRing(ring: HTMLElement): void {
  ringFill.set(ring, { run: (ringFill.get(ring)?.run ?? 0) + 1, target: 0 });
  ring.style.setProperty('--p', '0');
}

export function fillAccountRing(ring: HTMLElement, target: number): void {
  const shown = ringFill.get(ring);
  /* Already showing this fill, or already on its way to it. Starting again
     would re-ease the same journey from wherever this frame caught it. */
  if (shown && Math.abs(target - shown.target) < SAME) return;
  const run = (shown?.run ?? 0) + 1;
  ringFill.set(ring, { run, target });
  const from = parseFloat(ring.style.getPropertyValue('--p')) || 0;
  if (REDUCED || Math.abs(target - from) < SAME) {
    ring.style.setProperty('--p', String(target));
    return;
  }
  const started = performance.now();
  const duration = 850;
  const step = (now: number): void => {
    if (ringFill.get(ring)?.run !== run) return;
    const time = Math.min(1, (now - started) / duration);
    ring.style.setProperty('--p', String(from + (target - from) * (1 - Math.pow(1 - time, 3))));
    if (time < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
