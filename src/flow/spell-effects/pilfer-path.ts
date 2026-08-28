// PI5 — the authored geometry of THE SNATCH, kept apart from the DOM
// choreography that plays it. Every millisecond here is a waypoint of the
// selected study rather than a derived value: how long the die pulls locally
// before it may release, when it meets each blocker in turn, and the column
// strain that answers those contacts. Nothing below touches the document, so
// the tables stay readable — and checkable — without a browser.
import type { SpellMotionDelta } from '../../ui/game/spell-motion.ts';

interface TimedPoint extends SpellMotionDelta { milliseconds: number; }

const FLIGHT_EASING = 'cubic-bezier(.7,0,.2,1)';
const STRAIN_EASING = 'cubic-bezier(.5,0,.3,1)';

export interface PilferFlight {
  duration: number;
  /** Offsets at which the flying die meets each blocker, in order. */
  contacts: readonly number[];
  frames: Keyframe[];
}

export interface PilferStrain {
  duration: number;
  frames: Keyframe[];
}

function translated(point: SpellMotionDelta): string {
  return `translate(${point.x}px,${point.y}px) scale(${point.scale})`;
}

/** Direction of a delta as a unit vector; a zero delta reads as zero, not NaN. */
export function unitToward(delta: SpellMotionDelta): { x: number; y: number } {
  const distance = Math.hypot(delta.x, delta.y) || 1;
  return { x: delta.x / distance, y: delta.y / distance };
}

/**
 * The whole flight for `blockerCount` dice standing in the way: its authored
 * duration, the contact beats a straining column has to answer, and the
 * keyframes that carry the die to `target`.
 */
export function pilferFlight(
  blockerCount: number,
  target: SpellMotionDelta,
): PilferFlight {
  const toward = unitToward(target);
  const points: TimedPoint[] = [{ x: 0, y: 0, scale: 1, milliseconds: 0 }];
  const contacts: number[] = [];

  if (blockerCount === 0) {
    // Nothing sits between this die and the centre line: no resistance beat,
    // no staged hold. It releases on tap and takes PI5's 480ms crossing.
  } else {
    // PI5's selected one-blocker study spends 1.024s pulling locally before
    // release: +10, -3, +13, +4 pixels. Extra depth repeats only that local
    // resistance beat; the flying die never visits a blocker's centre.
    points.push({
      x: toward.x * 10,
      y: toward.y * 10,
      scale: 1.04,
      milliseconds: 288,
    });
    points.push({
      x: toward.x * -3,
      y: toward.y * -3,
      scale: .99,
      milliseconds: 544,
    });
    for (let index = 0; index < blockerCount; index++) {
      const contact = 800 + index * 512;
      contacts.push(contact);
      points.push({
        x: toward.x * 13,
        y: toward.y * 13,
        scale: 1.06,
        milliseconds: contact,
      });
      points.push({
        x: toward.x * 4,
        y: toward.y * 4,
        scale: 1,
        milliseconds: contact + 224,
      });
    }
  }

  const release = blockerCount === 0 ? 0 : 512 + blockerCount * 512;
  const duration = release + 480;
  points.push({ ...target, milliseconds: duration });
  return {
    duration,
    contacts,
    frames: points.map((point) => ({
      transform: translated(point),
      offset: point.milliseconds / duration,
      easing: FLIGHT_EASING,
    })),
  };
}

/**
 * The source column's answer to those contacts: it stretches along the axis of
 * flight at each one and only relaxes 256ms after the die has landed. Contact
 * beats overlap at depth, so the collected frames are ordered by time before
 * they become offsets.
 */
export function pilferStrain(
  contacts: readonly number[],
  flightDuration: number,
  horizontal: boolean,
): PilferStrain {
  const scale = (amount: number): string => horizontal
    ? `scaleX(${amount})`
    : `scaleY(${amount})`;
  const duration = flightDuration + 256;
  const frames: Array<Keyframe & { milliseconds?: number }> = [
    { transform: scale(1), milliseconds: 0 },
  ];
  contacts.forEach((contact) => {
    frames.push({
      transform: scale(1.045),
      milliseconds: contact,
    }, {
      transform: scale(1.02),
      milliseconds: contact + 224,
    }, {
      transform: scale(.975),
      milliseconds: contact + 384,
    });
  });
  frames.push({
    transform: scale(1.01),
    milliseconds: flightDuration - 64,
  }, {
    transform: scale(1),
    milliseconds: duration,
  });
  return {
    duration,
    frames: frames
      .sort((a, b) => Number(a.milliseconds) - Number(b.milliseconds))
      .map(({ milliseconds = 0, ...frame }) => ({
        ...frame,
        offset: milliseconds / duration,
        easing: STRAIN_EASING,
      })),
  };
}
