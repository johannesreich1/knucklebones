// PI5 — THE SNATCH. The last die in their column has to tear through every
// die between it and the centre line before it can cross to the caster.
import { SPEC, type Player } from '../../core/rules.ts';
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../../ui/audio.ts';
import { colEl, faceRotated, slotEl, slotIdx } from '../../ui/dom.ts';
import { REDUCED, fxRoot, pin } from '../../ui/fx.ts';
import { renderSide } from '../../ui/game/board.ts';
import {
  cancelSpellAnimations,
  pinDieGhost,
  playSpellAnimation,
  type SpellMotionDelta,
} from '../../ui/game/spell-motion.ts';
import { spellHue } from '../../ui/spellicons.ts';
import { effectPause, type SpellEffect } from './types.ts';

interface TimedPoint extends SpellMotionDelta {
  milliseconds: number;
}

interface PilferBlocker {
  die: HTMLElement;
}

interface PilferPath {
  duration: number;
  contacts: number[];
  points: TimedPoint[];
  release: number;
}

function translated(point: SpellMotionDelta): string {
  return `translate(${point.x}px,${point.y}px) scale(${point.scale})`;
}

function unitToward(delta: SpellMotionDelta): { x: number; y: number } {
  const distance = Math.hypot(delta.x, delta.y) || 1;
  return { x: delta.x / distance, y: delta.y / distance };
}

function flightPoints(
  blockerCount: number,
  target: SpellMotionDelta,
): PilferPath {
  const toward = unitToward(target);
  const points: TimedPoint[] = [{ x: 0, y: 0, scale: 1, milliseconds: 0 }];
  const contacts: number[] = [];

  if (blockerCount === 0) {
    // The centre-most die has nothing to fight through. It only lifts enough
    // to show the grip, holds, then tears straight across — no false rebound.
    points.push({
      x: toward.x * 4,
      y: toward.y * 4,
      scale: 1.02,
      milliseconds: 288,
    });
    points.push({
      x: toward.x * 4,
      y: toward.y * 4,
      scale: 1.02,
      milliseconds: 512,
    });
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
        x: toward.x * (13 + index * 4),
        y: toward.y * (13 + index * 4),
        scale: 1.06 + index * .015,
        milliseconds: contact,
      });
      points.push({
        x: toward.x * (4 + index),
        y: toward.y * (4 + index),
        scale: 1,
        milliseconds: contact + 224,
      });
    }
  }

  const release = 512 + blockerCount * 512;
  const duration = release + 480;
  points.push({ ...target, milliseconds: duration });
  return { duration, contacts, points, release };
}

function flightKeyframes(points: readonly TimedPoint[], duration: number): Keyframe[] {
  return points.map((point) => ({
    transform: translated(point),
    offset: point.milliseconds / duration,
  }));
}

function strainKeyframes(
  contacts: readonly number[],
  flightDuration: number,
  horizontal: boolean,
): { duration: number; frames: Keyframe[] } {
  const scale = (amount: number): string => horizontal
    ? `scaleX(${amount})`
    : `scaleY(${amount})`;
  const duration = flightDuration + 256;
  const frames: Array<Keyframe & { milliseconds?: number }> = [
    { transform: scale(1), milliseconds: 0 },
  ];
  contacts.forEach((contact, index) => {
    const last = index === contacts.length - 1;
    frames.push({
      transform: scale((last ? 1.045 : 1.035) + index * .01),
      milliseconds: contact,
    }, {
      transform: scale(last ? 1.02 : .992),
      milliseconds: contact + 224,
    }, {
      transform: scale(last ? .975 : 1.005),
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
      .map(({ milliseconds = 0, ...frame }) => ({ ...frame, offset: milliseconds / duration })),
  };
}

function releaseSnap(
  sourceRect: DOMRect,
  toward: { x: number; y: number },
  horizontal: boolean,
  hue: string,
): HTMLElement {
  const snap = document.createElement('i');
  snap.className = 'pilfer-release-snap';
  snap.style.setProperty('--spell-hue', hue);
  const long = Math.min(44, sourceRect.width * .85);
  const short = 3;
  const width = horizontal ? short : long;
  const height = horizontal ? long : short;
  const reach = sourceRect.width * .62;
  const centreX = sourceRect.left + sourceRect.width / 2 + toward.x * reach;
  const centreY = sourceRect.top + sourceRect.height / 2 + toward.y * reach;
  pin(snap, new DOMRect(centreX - width / 2, centreY - height / 2, width, height), 69);
  fxRoot().appendChild(snap);
  return snap;
}

function revealColumn(who: Player, column: number): void {
  for (let index = 0; index < SPEC.rows; index++) {
    const die = slotEl(who, column, slotIdx(who, index))?.firstElementChild as HTMLElement | null;
    if (die) die.style.visibility = '';
  }
}

export const pilferEffect: SpellEffect = async (who, column, apply) => {
  const foe = (1 - who) as Player;
  const generation = S.gen;
  const isCurrent = (): boolean => S.gen === generation;
  const sourceIndex = S.boards[foe][column].length - 1;
  const targetIndex = S.boards[who][column].length;
  const sourceSlot = slotEl(foe, column, slotIdx(foe, sourceIndex));
  const targetSlot = slotEl(who, column, slotIdx(who, targetIndex));
  const source = sourceSlot?.firstElementChild as HTMLElement | null;
  const sourceColumn = colEl(foe, column);
  let applied = false;

  const commit = (): void => {
    if (applied || !isCurrent()) return;
    applied = true;
    apply();
    // The score, multipliers, source vacancy and destination owner all change
    // on the same arrival frame. Nothing else on either board is animated.
    renderSide(who, false);
    renderSide(foe, false);
  };

  Sfx.spell();
  vibrate([10, 30, 14]);

  if (REDUCED || !source || !sourceColumn || !targetSlot || sourceIndex < 0) {
    commit();
    if (applied) Sfx.mult();
    await effectPause(0);
    return;
  }

  const pinned = pinDieGhost(source, {
    classes: ['pilfer-ghost'],
    hideSource: true,
    zIndex: 68,
  });
  // A numeral cloned out of the far half no longer inherits that half's seat
  // transform. Preserve the victim's reading while it remains their colour.
  pinned.ghost.classList.toggle('p2flip', faceRotated(foe));
  const hue = spellHue('pilfer');

  const blockers: PilferBlocker[] = [];
  for (let index = sourceIndex - 1; index >= 0; index--) {
    const die = slotEl(foe, column, slotIdx(foe, index))?.firstElementChild as HTMLElement | null;
    if (die) blockers.push({ die });
  }
  const target = pinned.deltaTo(targetSlot);
  const path = flightPoints(blockers.length, target);
  const toward = unitToward(target);
  const horizontal = Math.abs(toward.x) > Math.abs(toward.y);
  const oldOrigin = sourceColumn.style.transformOrigin;
  sourceColumn.style.transformOrigin = horizontal
    ? (toward.x > 0 ? 'left center' : 'right center')
    : (toward.y > 0 ? 'center top' : 'center bottom');
  sourceColumn.classList.toggle('pilfer-straining', blockers.length > 0);
  sourceColumn.dataset.pilferCollisions = String(blockers.length);
  pinned.ghost.dataset.pilferCollisions = String(blockers.length);
  blockers.forEach((blocker, index) => {
    blocker.die.classList.add('pilfer-blocker');
    blocker.die.dataset.pilferCollision = String(index + 1);
  });

  const sideAnimations: Promise<boolean>[] = [];
  if (path.contacts.length > 0) {
    const strain = strainKeyframes(path.contacts, path.duration, horizontal);
    sideAnimations.push(playSpellAnimation(
      sourceColumn,
      strain.frames,
      { duration: strain.duration, easing: 'cubic-bezier(.5,0,.3,1)' },
      isCurrent,
    ));
  }
  const snap = releaseSnap(pinned.sourceRect, toward, horizontal, hue);
  const snapScale = (amount: number): string => horizontal
    ? `scaleY(${amount})`
    : `scaleX(${amount})`;
  sideAnimations.push(playSpellAnimation(snap, [
    { opacity: 0, transform: snapScale(.2) },
    { opacity: 1, transform: snapScale(1), offset: 160 / 608 },
    { opacity: 0, transform: snapScale(2.4) },
  ], {
    delay: path.release,
    duration: 608,
    easing: 'ease-out',
  }, isCurrent));

  try {
    const arrived = await playSpellAnimation(
      pinned.ghost,
      flightKeyframes(path.points, path.duration),
      // Keep the authored millisecond waypoints literal. An effect-level
      // curve remaps every keyframe offset and makes the die start crossing
      // the board before the visible resistance/release beat.
      { duration: path.duration, easing: 'linear' },
      isCurrent,
    );
    if (!arrived || !isCurrent()) return;

    commit();
    if (!applied) return;
    Sfx.mult();

    const landed = slotEl(who, column, slotIdx(who, targetIndex))
      ?.firstElementChild as HTMLElement | null;
    if (landed) landed.style.visibility = 'hidden';
    pinned.remove();
    if (landed) {
      landed.style.visibility = '';
      landed.classList.add('pilfer-soft-settle');
      await playSpellAnimation(landed, [
        { transform: 'scale(1.1)' },
        { transform: 'scale(.94)', offset: 4 / 9 },
        { transform: 'scale(1)' },
      ], {
        duration: 576,
        easing: 'cubic-bezier(.2,1.7,.4,1)',
      }, isCurrent);
      cancelSpellAnimations(landed);
      landed.classList.remove('pilfer-soft-settle');
    }
    await Promise.all(sideAnimations);
  } finally {
    pinned.remove();
    cancelSpellAnimations(snap);
    snap.remove();
    cancelSpellAnimations(sourceColumn);
    sourceColumn.classList.remove('pilfer-straining');
    delete sourceColumn.dataset.pilferCollisions;
    sourceColumn.style.transformOrigin = oldOrigin;
    for (const blocker of blockers) {
      cancelSpellAnimations(blocker.die);
      blocker.die.classList.remove('pilfer-blocker');
      delete blocker.die.dataset.pilferCollision;
    }
    revealColumn(who, column);
    revealColumn(foe, column);
  }
};
