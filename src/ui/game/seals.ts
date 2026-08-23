// Protection-seal geometry and its one-shot beats. Both local and ranked
// drivers repaint through this owner; neither flow paints a seal privately.
import { type Player } from '../../core/rules.ts';
import { chipEl, colEl } from '../dom.ts';
import { modeIcon } from '../modeicons.ts';
import { spellIcon } from '../spellicons.ts';
import { appRoot } from '../embed.ts';

const SEAL_MOUTH = 4;
const SEAL_ON_MS = 680;
const SEAL_HIT_MS = 520;
const SEAL_SNAP_MS = 720;

interface SealMetrics {
  cell: number;
  gap: number;
  out: number;
  radius: number;
  height: number;
}

/* Geometry is expressed in the column's real CSS pixels. A fixed reference
   box stretched at larger cell sizes made corners and strokes change weight;
   this cache is invalidated only when ResizeObserver sees the cells resize. */
let cachedMetrics: SealMetrics | null = null;

function sealMetrics(): SealMetrics {
  const style = getComputedStyle(appRoot());
  const number = (name: string, fallback: number): number => {
    const value = parseFloat(style.getPropertyValue(name));
    return value > 0 ? value : fallback;
  };
  const cell = number('--cell', 62);
  const gap = number('--gap', 6);
  const out = number('--seal-out', 1.6);
  const column = appRoot().querySelector<HTMLElement>('.col');
  const boardRadius = column ? parseFloat(getComputedStyle(column).borderRadius) : 18;
  return {
    cell,
    gap,
    out,
    radius: boardRadius + out,
    height: 3 * cell + 2 * gap + 2 * out,
  };
}

function metrics(): SealMetrics {
  return cachedMetrics ?? (cachedMetrics = sealMetrics());
}

export function sealMarkup(span: number): string {
  const m = metrics();
  const width = m.cell * span + m.gap * (span - 1) + 2 * m.out;
  const height = m.height;
  const middle = width / 2;
  const radius = m.radius;
  const fixed = (value: number): number => +value.toFixed(2);

  const roundedRect = (inset: number): string => {
    const r = Math.max(0.5, radius - inset);
    return 'M' + fixed(inset + r) + ' ' + fixed(inset)
      + 'H' + fixed(width - inset - r)
      + 'a' + fixed(r) + ' ' + fixed(r) + ' 0 0 1 ' + fixed(r) + ' ' + fixed(r)
      + 'V' + fixed(height - inset - r)
      + 'a' + fixed(r) + ' ' + fixed(r) + ' 0 0 1 ' + fixed(-r) + ' ' + fixed(r)
      + 'H' + fixed(inset + r)
      + 'a' + fixed(r) + ' ' + fixed(r) + ' 0 0 1 ' + fixed(-r) + ' ' + fixed(-r)
      + 'V' + fixed(inset + r)
      + 'a' + fixed(r) + ' ' + fixed(r) + ' 0 0 1 ' + fixed(r) + ' ' + fixed(-r) + 'Z';
  };
  const shieldHalf = (direction: -1 | 1): string =>
    'M' + fixed(middle) + ' ' + fixed(height)
    + 'H' + fixed(direction < 0 ? radius : width - radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 ' + (direction < 0 ? 1 : 0)
    + ' ' + fixed(direction * radius) + ' ' + fixed(-radius)
    + 'V' + fixed(radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 ' + (direction < 0 ? 1 : 0)
    + ' ' + fixed(-direction * radius) + ' ' + fixed(-radius) + 'H' + fixed(middle);
  const wardArc = (direction: -1 | 1): string =>
    'M' + fixed(middle + direction * SEAL_MOUTH) + ' 0'
    + 'H' + fixed(direction < 0 ? radius : width - radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 ' + (direction < 0 ? 0 : 1)
    + ' ' + fixed(direction * radius) + ' ' + fixed(radius)
    + 'V' + fixed(height - radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 ' + (direction < 0 ? 0 : 1)
    + ' ' + fixed(-direction * radius) + ' ' + fixed(radius) + 'H' + fixed(middle);

  const loop = roundedRect(0);
  const ward = span === 1
    ? '<g class="smint">'
      + '<path class="sa sal" pathLength="240" d="' + wardArc(-1) + '"/>'
      + '<path class="sa sar" pathLength="240" d="' + wardArc(1) + '"/>'
      + '<g class="sclasp">'
      + '<path class="sp spl" d="M' + fixed(middle) + ' -3.4 ' + fixed(middle - 4.6)
        + ' 0 ' + fixed(middle) + ' 3.4"/>'
      + '<path class="sp spr" d="M' + fixed(middle) + ' -3.4 ' + fixed(middle + 4.6)
        + ' 0 ' + fixed(middle) + ' 3.4"/>'
      + '<circle class="sv" cx="' + fixed(middle) + '" cy="0" r="1.5"/>'
      + '</g></g>'
    : '';

  return '<svg class="seal" data-n="' + span + '" viewBox="0 0 ' + fixed(width) + ' '
    + fixed(height) + '" preserveAspectRatio="none" aria-hidden="true">'
    + '<g class="sgold"><g class="sset">'
    + '<path class="sl" d="' + loop + '"/>'
    + '<path class="si" d="' + roundedRect(3) + '"/>'
    + '<path class="sb" pathLength="480" d="' + loop + '"/>'
    + '</g>'
    + '<path class="sd" pathLength="240" d="' + shieldHalf(-1) + '"/>'
    + '<path class="sd" pathLength="240" d="' + shieldHalf(1) + '"/>'
    + '<circle class="sj" cx="' + fixed(middle) + '" cy="0" r="3.5"/>'
    + '</g>' + ward + '</svg>';
}

let sealObserver: ResizeObserver | null = null;

function reseal(): void {
  appRoot().querySelectorAll<HTMLElement>('.col>.seal').forEach((seal) => {
    seal.outerHTML = sealMarkup(Number(seal.dataset.n) || 1);
  });
}

export function watchSealCells(): void {
  if (typeof ResizeObserver === 'undefined') return;
  sealObserver ??= new ResizeObserver(() => {
    cachedMetrics = null;
    reseal();
  });
  appRoot().querySelectorAll<HTMLElement>('.col').forEach((column) => sealObserver!.observe(column));
}

/* Adjacent permanent column shields share one enclosure. The leading column
   owns its run's seal; wards remain span-one because each ward is one charge. */
export function setSealSpan(column: HTMLElement, span: number): boolean {
  const seal = column.querySelector<HTMLElement>('.seal');
  if (!seal || Number(seal.dataset.n) === span) return false;
  seal.outerHTML = sealMarkup(span);
  column.style.setProperty('--seal-span', String(span));
  return true;
}

function sealHost(column: HTMLElement | null): HTMLElement | null {
  let host = column;
  while (host?.classList.contains('sealmerged')) {
    host = host.previousElementSibling as HTMLElement | null;
  }
  return host?.classList.contains('col') ? host : column;
}

const beatOff = new WeakMap<HTMLElement, Record<string, ReturnType<typeof setTimeout>>>();

function oneShot(element: HTMLElement | null, className: string, duration: number): void {
  if (!element) return;
  let timers = beatOff.get(element);
  if (!timers) {
    timers = {};
    beatOff.set(element, timers);
  }
  const old = timers[className];
  if (old !== undefined) clearTimeout(old);
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  timers[className] = setTimeout(() => element.classList.remove(className), duration);
}

function restart(element: HTMLElement | null, className: string): void {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

export function playSealEngage(column: HTMLElement): void {
  oneShot(column, 'sealon', SEAL_ON_MS);
}

export function shieldBlocked(who: Player, col: number): void {
  restart(chipEl(who, col).querySelector<HTMLElement>('.sh'), 'block');
  oneShot(sealHost(colEl(who, col)), 'sealhit', SEAL_HIT_MS);
}

export function wardBurned(who: Player, col: number): void {
  restart(chipEl(who, col).querySelector<HTMLElement>('.wd'), 'block');
  oneShot(colEl(who, col), 'sealsnap', SEAL_SNAP_MS);
}

/* Kept here beside seal ownership: score rendering uses these exact marks and
   must never duplicate their icon anatomy. */
export function shieldMark(): string { return modeIcon('colshield', 13); }
export function wardMark(): string { return spellIcon('ward', 13); }
