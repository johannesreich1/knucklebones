import { REDUCED } from '../ui/fx.ts';

const ringRun = new WeakMap<HTMLElement, number>();

export function fillAccountRing(ring: HTMLElement, target: number): void {
  const run = (ringRun.get(ring) ?? 0) + 1;
  ringRun.set(ring, run);
  const from = parseFloat(ring.style.getPropertyValue('--p')) || 0;
  if (REDUCED || Math.abs(target - from) < 0.002) {
    ring.style.setProperty('--p', String(target));
    return;
  }
  const started = performance.now();
  const duration = 850;
  const step = (now: number): void => {
    if (ringRun.get(ring) !== run) return;
    const time = Math.min(1, (now - started) / duration);
    ring.style.setProperty('--p', String(from + (target - from) * (1 - Math.pow(1 - time, 3))));
    if (time < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
