// PI5 — THE SNATCH. The last die in their column has to tear through every
// die between it and the centre line before it can cross to the caster.
import { SPEC, type Player } from '../../core/rules.ts';
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../../ui/audio.ts';
import { colEl, faceRotated, slotEl, slotIdx } from '../../ui/dom.ts';
import { REDUCED } from '../../ui/fx.ts';
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
  delta: SpellMotionDelta;
}

function translated(point: SpellMotionDelta): string {
  return `translate(${point.x}px,${point.y}px) scale(${point.scale})`;
}

function unitToward(delta: SpellMotionDelta): { x: number; y: number } {
  const distance = Math.hypot(delta.x, delta.y) || 1;
  return { x: delta.x / distance, y: delta.y / distance };
}

function flightPoints(
  blockers: readonly PilferBlocker[],
  target: SpellMotionDelta,
): { duration: number; contacts: number[]; points: TimedPoint[] } {
  const toward = unitToward(target);
  const points: TimedPoint[] = [{ x: 0, y: 0, scale: 1, milliseconds: 0 }];
  const contacts: number[] = [];
  let milliseconds = 65;

  // The grip tests the die once. This is tension, not a collision: a one-die
  // source column gets this pull but no blocker impact at all.
  points.push({
    x: toward.x * 5,
    y: toward.y * 5,
    scale: 1.04,
    milliseconds,
  });
  milliseconds += 45;
  points.push({
    x: toward.x * -3,
    y: toward.y * -3,
    scale: .99,
    milliseconds,
  });

  for (const blocker of blockers) {
    milliseconds += 85;
    contacts.push(milliseconds);
    // The exact contact coordinate comes from the blocker die's live rect.
    points.push({ ...blocker.delta, scale: 1.09, milliseconds });
    milliseconds += 48;
    points.push({
      x: blocker.delta.x - toward.x * 8,
      y: blocker.delta.y - toward.y * 8,
      scale: .98,
      milliseconds,
    });
    milliseconds += 52;
    points.push({
      x: blocker.delta.x + toward.x * 6,
      y: blocker.delta.y + toward.y * 6,
      scale: 1.03,
      milliseconds,
    });
  }

  const last = points[points.length - 1];
  const perpendicular = { x: -toward.y * 9, y: toward.x * 9 };
  milliseconds += 105;
  points.push({
    x: (last.x + target.x) / 2 + perpendicular.x,
    y: (last.y + target.y) / 2 + perpendicular.y,
    scale: (last.scale + target.scale) / 2 * 1.06,
    milliseconds,
  });
  milliseconds += 135;
  points.push({ ...target, milliseconds });
  return { duration: milliseconds, contacts, points };
}

function flightKeyframes(points: readonly TimedPoint[], duration: number): Keyframe[] {
  return points.map((point) => ({
    transform: translated(point),
    offset: point.milliseconds / duration,
  }));
}

function strainKeyframes(
  contacts: readonly number[],
  duration: number,
  horizontal: boolean,
): Keyframe[] {
  const scale = (amount: number): string => horizontal
    ? `scaleX(${amount})`
    : `scaleY(${amount})`;
  const frames: Keyframe[] = [
    { transform: scale(1), offset: 0 },
    { transform: scale(1.012), offset: 105 / duration },
  ];
  contacts.forEach((contact, index) => {
    frames.push({
      transform: scale(1.022 + index * .012),
      offset: contact / duration,
    });
    frames.push({
      transform: scale(.992),
      offset: Math.min((contact + 55) / duration, .9),
    });
  });
  frames.push(
    { transform: scale(.982), offset: Math.max(.7, (duration - 90) / duration) },
    { transform: scale(1), offset: 1 },
  );
  return frames.sort((a, b) => Number(a.offset) - Number(b.offset));
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
  pinned.ghost.style.setProperty('--spell-hue', spellHue('pilfer'));

  const blockers: PilferBlocker[] = [];
  for (let index = sourceIndex - 1; index >= 0; index--) {
    const die = slotEl(foe, column, slotIdx(foe, index))?.firstElementChild as HTMLElement | null;
    if (die) blockers.push({ die, delta: pinned.deltaTo(die) });
  }
  const path = flightPoints(blockers, pinned.deltaTo(targetSlot));
  const toward = unitToward(pinned.deltaTo(targetSlot));
  const horizontal = Math.abs(toward.x) > Math.abs(toward.y);
  const oldOrigin = sourceColumn.style.transformOrigin;
  sourceColumn.style.transformOrigin = horizontal
    ? (toward.x > 0 ? 'left center' : 'right center')
    : (toward.y > 0 ? 'center top' : 'center bottom');
  sourceColumn.classList.add('pilfer-straining');
  sourceColumn.dataset.pilferCollisions = String(blockers.length);
  pinned.ghost.dataset.pilferCollisions = String(blockers.length);
  blockers.forEach((blocker, index) => {
    blocker.die.classList.add('pilfer-blocker');
    blocker.die.dataset.pilferCollision = String(index + 1);
  });

  const sideAnimations: Promise<boolean>[] = [playSpellAnimation(
    sourceColumn,
    strainKeyframes(path.contacts, path.duration, horizontal),
    { duration: path.duration, easing: 'cubic-bezier(.5,0,.3,1)' },
    isCurrent,
  )];
  blockers.forEach((blocker, index) => {
    const contact = path.contacts[index];
    sideAnimations.push(playSpellAnimation(blocker.die, [
      { transform: 'translate(0,0) scale(1)' },
      {
        transform: `translate(${toward.x * 5}px,${toward.y * 5}px) scale(1.05)`,
        offset: .42,
      },
      {
        transform: `translate(${toward.x * -2}px,${toward.y * -2}px) scale(.98)`,
        offset: .72,
      },
      { transform: 'translate(0,0) scale(1)' },
    ], {
      delay: Math.max(0, contact - 48),
      duration: 142,
      easing: 'cubic-bezier(.3,0,.25,1)',
    }, isCurrent));
  });

  try {
    const arrived = await playSpellAnimation(
      pinned.ghost,
      flightKeyframes(path.points, path.duration),
      { duration: path.duration, easing: 'cubic-bezier(.7,0,.2,1)' },
      isCurrent,
    );
    await Promise.all(sideAnimations);
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
        { transform: 'scale(1.055)' },
        { transform: 'scale(.965)', offset: .46 },
        { transform: 'scale(1)' },
      ], {
        duration: 180,
        easing: 'cubic-bezier(.2,1.25,.4,1)',
      }, isCurrent);
      cancelSpellAnimations(landed);
      landed.classList.remove('pilfer-soft-settle');
    }
  } finally {
    pinned.remove();
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
