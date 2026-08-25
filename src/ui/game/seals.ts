// Protection-seal geometry and its one-shot beats. Both local and ranked
// drivers repaint through this owner; neither flow paints a seal privately.
import { type Player } from '../../core/rules.ts';
import { chipEl, colEl, faceRotated } from '../dom.ts';
import { REDUCED } from '../fx.ts';
import { modeIcon } from '../modeicons.ts';
import { spellIcon } from '../spellicons.ts';
import { appRoot } from '../embed.ts';
import { pinDieGhost, playSpellAnimation } from './spell-motion.ts';

/* The clasp is the ward's one spendable part, so it must survive the board's
   visual noise. W3's first production pass landed a little too fine at the
   smallest cell size; this modestly wider mouth gives the enlarged knot room
   without changing the seal's stand-off or the shield geometry beside it. */
const SEAL_MOUTH = 5;
const SEAL_SLACK_MS = 60;
const WARD_APPROACH_MS = 640;
const WARD_RECOIL_MS = 1024;
const WARD_REBOUND_MS = 384;
const WARD_CONTACT_GAP = 4;
const WARD_REBOUND_PROGRESS = 130 / 174;
const WARD_HIT_EASING = 'cubic-bezier(.3,1.5,.4,1)';

interface SealMetrics {
  cell: number;
  gap: number;
  out: number;
  radius: number;
  height: number;
  engage: number;
  strike: number;
  snap: number;
}

/* Geometry is expressed in the column's real CSS pixels. The corner is asked
   for, never restated: board.css gives the seat and its die one radius, and we
   read it from a real .slot so the seal stays parallel to what is painted.
   The cache is invalidated only when ResizeObserver sees the cells resize. */
let cachedMetrics: SealMetrics | null = null;

function sealMetrics(): SealMetrics {
  const style = getComputedStyle(appRoot());
  const number = (name: string, fallback: number): number => {
    const value = parseFloat(style.getPropertyValue(name));
    return value > 0 ? value : fallback;
  };
  /* Build minification can rewrite 950ms as .95s. Parse the unit explicitly so
     the shipped one-shot window cannot collapse to a single millisecond. */
  const milliseconds = (name: string, fallback: number): number => {
    const value = style.getPropertyValue(name).trim();
    const amount = parseFloat(value);
    if (!(amount > 0)) return fallback;
    if (/ms$/.test(value)) return amount;
    if (/s$/.test(value)) return amount * 1000;
    return amount;
  };
  const cell = number('--cell', 62);
  const gap = number('--gap', 6);
  const out = number('--seal-out', 1.6);
  const slot = appRoot().querySelector<HTMLElement>('.slot');
  const cellRadius = slot ? parseFloat(getComputedStyle(slot).borderRadius) : 14;
  return {
    cell,
    gap,
    out,
    radius: (cellRadius > 0 ? cellRadius : 14) + out,
    height: 3 * cell + 2 * gap + 2 * out,
    engage: milliseconds('--seal-engage', 950),
    strike: milliseconds('--seal-strike', 1200),
    snap: milliseconds('--seal-snap', 1600),
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

  /* One frame edge, cornered at the cell radius grown by the stand-off. The
     former inset copy read as a second outline, not as extra line weight. */
  const loop = 'M' + fixed(radius) + ' 0'
    + 'H' + fixed(width - radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 1 ' + fixed(radius) + ' ' + fixed(radius)
    + 'V' + fixed(height - radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 1 ' + fixed(-radius) + ' ' + fixed(radius)
    + 'H' + fixed(radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 1 ' + fixed(-radius) + ' ' + fixed(-radius)
    + 'V' + fixed(radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 1 ' + fixed(radius) + ' ' + fixed(-radius) + 'Z';
  const shieldHalf = (direction: -1 | 1): string =>
    'M' + fixed(middle) + ' ' + fixed(height)
    + 'H' + fixed(direction < 0 ? radius : width - radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 ' + (direction < 0 ? 1 : 0)
    + ' ' + fixed(direction * radius) + ' ' + fixed(-radius)
    + 'V' + fixed(radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 ' + (direction < 0 ? 1 : 0)
    + ' ' + fixed(-direction * radius) + ' ' + fixed(-radius) + 'H' + fixed(middle);
  /* Direction is part of the animation contract, not interchangeable SVG
     geometry. Each half starts at the hinge opposite table centre and ends at
     the clasp. sealclose therefore grows toward the clasp; sealunwind removes
     from the clasp back toward the hinge. The transformed group mirrors that
     one rule for all four board orientations. */
  const wardArc = (direction: -1 | 1): string =>
    'M' + fixed(middle) + ' ' + fixed(height)
    + 'H' + fixed(direction < 0 ? radius : width - radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 ' + (direction < 0 ? 1 : 0)
    + ' ' + fixed(direction * radius) + ' ' + fixed(-radius)
    + 'V' + fixed(radius)
    + 'a' + fixed(radius) + ' ' + fixed(radius) + ' 0 0 ' + (direction < 0 ? 1 : 0)
    + ' ' + fixed(-direction * radius) + ' ' + fixed(-radius)
    + 'H' + fixed(middle + direction * SEAL_MOUTH);

  const ward = span === 1
    ? '<g class="smint">'
      + '<path class="sa sal" pathLength="240" d="' + wardArc(-1) + '"/>'
      + '<path class="sa sar" pathLength="240" d="' + wardArc(1) + '"/>'
      + '<g class="sclasp">'
      + '<path class="sp spl" d="M' + fixed(middle) + ' -4.2 ' + fixed(middle - 5.7)
        + ' 0 ' + fixed(middle) + ' 4.2"/>'
      + '<path class="sp spr" d="M' + fixed(middle) + ' -4.2 ' + fixed(middle + 5.7)
        + ' 0 ' + fixed(middle) + ' 4.2"/>'
      + '<circle class="sv" cx="' + fixed(middle) + '" cy="0" r="1.9"/>'
      + '</g></g>'
    : '';

  return '<svg class="seal" data-n="' + span + '" viewBox="0 0 ' + fixed(width) + ' '
    + fixed(height) + '" preserveAspectRatio="none" aria-hidden="true">'
    + '<g class="sgold"><g class="sset">'
    + '<path class="sl" d="' + loop + '"/>'
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
const beatElements = new Set<HTMLElement>();

function oneShot(element: HTMLElement | null, className: string, duration: number): void {
  if (!element) return;
  let timers = beatOff.get(element);
  if (!timers) {
    timers = {};
    beatOff.set(element, timers);
    beatElements.add(element);
  }
  const old = timers[className];
  if (old !== undefined) clearTimeout(old);
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  timers[className] = setTimeout(() => element.classList.remove(className), duration);
}

/* A duel restart is a hard presentation boundary. Seal beats deliberately
   outlive a spent Ward long enough to show its snap, so their timers/classes
   must be cancelled explicitly instead of leaking into the next board paint. */
export function clearSealPresentation(): void {
  for (const element of beatElements) {
    const timers = beatOff.get(element);
    if (timers) Object.values(timers).forEach(clearTimeout);
    beatOff.delete(element);
  }
  beatElements.clear();
  appRoot().querySelectorAll<HTMLElement>('.sealon,.sealhit,.sealsnap')
    .forEach((element) => element.classList.remove('sealon', 'sealhit', 'sealsnap'));
  appRoot().querySelectorAll<HTMLElement>('.sh.block,.wd.block')
    .forEach((element) => element.classList.remove('block'));
  appRoot().querySelectorAll<HTMLElement>('.ward-strike-ghost')
    .forEach((element) => element.remove());
}

function restart(element: HTMLElement | null, className: string): void {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

export function playSealEngage(column: HTMLElement): void {
  oneShot(column, 'sealon', metrics().engage + SEAL_SLACK_MS);
}

/* The clasp is transformed independently from the shared shield frame. Ask
   the painted rivet for its page-space box whenever a cast or strike needs the
   mouth; deriving a direction from player/portrait state here would duplicate
   CSS geometry and drift as soon as seating changes. */
export function wardClaspRect(who: Player, col: number): DOMRect | null {
  const rivet = colEl(who, col)?.querySelector<SVGGraphicsElement>('.smint .sv');
  const clasp = rivet?.getBoundingClientRect();
  if (clasp?.width && clasp.height) return clasp;
  // Score rendering normally guarantees span-one Ward geometry, including on
  // COLUMN SHIELD. The chip mark is a truthful last-resort target during a
  // resize/reseal frame rather than sending an attack toward a zero rectangle.
  return chipEl(who, col).querySelector<HTMLElement>('.wd .sico')
    ?.getBoundingClientRect() ?? null;
}

export interface WardStrikeSpec {
  attacker: Player;
  target: Player;
  targetColumn: number;
  source: HTMLElement | null;
  isCurrent: () => boolean;
  impact: () => void;
}

/* Only a hostile action that openStrikes has proved reaches WARD calls this.
   Usually it would take victims; on a full COLUMN SHIELD column it instead
   burns the scoring WARD while the permanent shield keeps every die. The copy
   starts on the settled attacker, meets the transformed centre-facing clasp,
   then follows W3's long recoil while that spendable clasp snaps. */
export async function playWardStrike(spec: WardStrikeSpec): Promise<boolean> {
  const target = wardClaspRect(spec.target, spec.targetColumn);
  if (REDUCED || !spec.source || !target) {
    if (!spec.isCurrent()) return false;
    spec.impact();
    return true;
  }

  const classes = ['ward-strike-ghost'];
  if (faceRotated(spec.attacker)) classes.push('p2flip');
  const pinned = pinDieGhost(spec.source, { classes, zIndex: 66 });
  const centreDelta = pinned.deltaTo(target);
  const distance = Math.hypot(centreDelta.x, centreDelta.y) || 1;
  const unit = { x: centreDelta.x / distance, y: centreDelta.y / distance };
  /* W3 lands the die's leading edge just shy of the clasp. Centre-to-centre
     made a full die dive halfway through the tiny rivet and obscured the one
     piece of the seal the strike is meant to explain. */
  const edge = Math.abs(unit.x) * pinned.sourceRect.width / 2
    + Math.abs(unit.y) * pinned.sourceRect.height / 2;
  const contact = {
    x: centreDelta.x - unit.x * (edge + WARD_CONTACT_GAP),
    y: centreDelta.y - unit.y * (edge + WARD_CONTACT_GAP),
  };
  const translated = (amount: number): string =>
    `translate(${contact.x * amount}px,${contact.y * amount}px)`;

  try {
    const arrived = await playSpellAnimation(pinned.ghost, [
      { transform: translated(0), opacity: 1, easing: WARD_HIT_EASING },
      { transform: translated(1), opacity: 1, easing: WARD_HIT_EASING },
    ], { duration: WARD_APPROACH_MS, easing: 'linear' }, spec.isCurrent);
    if (!arrived || !spec.isCurrent()) return false;

    spec.impact();

    const recoiled = await playSpellAnimation(pinned.ghost, [
      {
        transform: translated(1),
        opacity: 1,
        easing: WARD_HIT_EASING,
      },
      {
        transform: translated(WARD_REBOUND_PROGRESS),
        offset: WARD_REBOUND_MS / WARD_RECOIL_MS,
        opacity: .72,
        easing: WARD_HIT_EASING,
      },
      {
        transform: translated(0),
        opacity: 0,
        easing: WARD_HIT_EASING,
      },
    ], { duration: WARD_RECOIL_MS, easing: 'linear' }, spec.isCurrent);
    return recoiled;
  } finally {
    pinned.remove();
  }
}

export function shieldBlocked(who: Player, col: number): void {
  restart(chipEl(who, col).querySelector<HTMLElement>('.sh'), 'block');
  oneShot(sealHost(colEl(who, col)), 'sealhit', metrics().strike + SEAL_SLACK_MS);
}

export function wardBurned(who: Player, col: number): void {
  if (REDUCED) {
    colEl(who, col)?.classList.remove('sealsnap');
    return;
  }
  restart(chipEl(who, col).querySelector<HTMLElement>('.wd'), 'block');
  oneShot(colEl(who, col), 'sealsnap', metrics().snap + SEAL_SLACK_MS);
}

/* Kept here beside seal ownership: score rendering uses these exact marks and
   must never duplicate their icon anatomy. */
export function shieldMark(): string { return modeIcon('colshield', 13); }
export function wardMark(): string { return spellIcon('ward', 13); }
