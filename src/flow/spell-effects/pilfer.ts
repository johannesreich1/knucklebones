// PI5 — THE SNATCH. The last die in their column has to tear through every
// die between it and the centre line before it can cross to the caster.
import { SPEC, type Player } from '../../core/rules.ts';
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../../ui/audio.ts';
import { colEl, faceRotated, slotEl, slotIdx } from '../../ui/dom.ts';
import { REDUCED, burst } from '../../ui/fx.ts';
import { renderSide } from '../../ui/game/board.ts';
import { wardClaspRect } from '../../ui/game/seals.ts';
import {
  cancelSpellAnimations,
  pinDieGhost,
  playSpellAnimation,
} from '../../ui/game/spell-motion.ts';
import { settleWardBreak } from '../../ui/game/ward-score.ts';
import { spellHue } from '../../ui/spellicons.ts';
import { pilferFlight, pilferStrain, unitToward } from './pilfer-path.ts';
import { effectPause, type SpellEffect } from './types.ts';

interface PilferBlocker { die: HTMLElement; }

const LANDING_EASING = 'cubic-bezier(.2,1.7,.4,1)';
const WARD_TUG_EASING = 'cubic-bezier(.3,1.5,.4,1)';
const WARD_TUG_MS = 320, WARD_RECOIL_MS = 720;

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
  let targetMarked = false;

  const clearTarget = (): void => {
    if (!targetMarked || !targetSlot) return;
    targetMarked = false;
    targetSlot.classList.remove('pilfer-room');
    targetSlot.style.removeProperty('--spell-hue');
  };

  const commit = (): void => {
    if (applied || !isCurrent()) return;
    applied = true;
    clearTarget();
    apply();
    // The score, multipliers, source vacancy and destination owner all change
    // on the same arrival frame. Nothing else on either board is animated.
    renderSide(who, false);
    renderSide(foe, false);
  };

  Sfx.spell();
  vibrate([10, 30, 14]);

  /* WARD turns PILFER into an answered theft: the selected die strains toward
     the caster, meets the mint clasp, then settles back exactly where it was.
     No ghost crosses the board and no destination room lights, because the
     authoritative mutation moves no die—even when the receiver is full. */
  if (S.charm.wards[foe][column] > 0) {
    const commitWardBreak = (): void => {
      if (applied || !isCurrent()) return;
      applied = true;
      settleWardBreak(foe, column, apply, () => {
        const clasp = wardClaspRect(foe, column);
        if (clasp) burst(clasp.left + clasp.width / 2, clasp.top + clasp.height / 2,
          spellHue('pilfer'), 8);
      });
    };

    if (REDUCED || !source || !sourceColumn || sourceIndex < 0) {
      commitWardBreak();
      if (applied) {
        renderSide(foe, false);
        renderSide(who, false);
      }
      await effectPause(0);
      return;
    }

    const receivingColumn = colEl(who, column);
    const from = source.getBoundingClientRect();
    const toward = receivingColumn?.getBoundingClientRect();
    const delta = toward ? {
      x: toward.left + toward.width / 2 - from.left - from.width / 2,
      y: toward.top + toward.height / 2 - from.top - from.height / 2,
      scale: 1,
    } : { x: 0, y: who === 1 ? 1 : -1, scale: 1 };
    const unit = unitToward(delta);
    const tug = `translate(${unit.x * 12}px,${unit.y * 12}px) scale(1.055)`;
    sourceColumn.classList.add('pilfer-ward-challenge');
    try {
      const reached = await playSpellAnimation(source, [
        { transform: 'translate(0,0) scale(1)', easing: WARD_TUG_EASING },
        { transform: tug, easing: WARD_TUG_EASING },
      ], { duration: WARD_TUG_MS, easing: 'linear' }, isCurrent);
      if (!reached || !isCurrent()) return;
      commitWardBreak();
      if (!applied) return;
      await playSpellAnimation(source, [
        { transform: tug, opacity: 1, easing: WARD_TUG_EASING },
        { transform: `translate(${unit.x * -3}px,${unit.y * -3}px) scale(.985)`,
          opacity: .9, offset: .42, easing: WARD_TUG_EASING },
        { transform: 'translate(0,0) scale(1)', opacity: 1, easing: WARD_TUG_EASING },
      ], { duration: WARD_RECOIL_MS, easing: 'linear' }, isCurrent);
      if (isCurrent()) {
        renderSide(foe, true);
        renderSide(who, false);
      }
    } finally {
      cancelSpellAnimations(source);
      sourceColumn.classList.remove('pilfer-ward-challenge');
      revealColumn(who, column);
      revealColumn(foe, column);
    }
    return;
  }

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
  targetSlot.classList.add('pilfer-room');
  targetSlot.style.setProperty('--spell-hue', hue);
  targetMarked = true;

  const blockers: PilferBlocker[] = [];
  for (let index = sourceIndex - 1; index >= 0; index--) {
    const die = slotEl(foe, column, slotIdx(foe, index))?.firstElementChild as HTMLElement | null;
    if (die) blockers.push({ die });
  }
  const target = pinned.deltaTo(targetSlot);
  const flight = pilferFlight(blockers.length, target);
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
  if (flight.contacts.length > 0) {
    const strain = pilferStrain(flight.contacts, flight.duration, horizontal);
    sideAnimations.push(playSpellAnimation(
      sourceColumn,
      strain.frames,
      { duration: strain.duration, easing: 'linear' },
      isCurrent,
    ));
  }
  try {
    const arrived = await playSpellAnimation(
      pinned.ghost,
      flight.frames,
      // Keep the authored millisecond waypoints literal. An effect-level
      // curve remaps every keyframe offset and makes the die start crossing
      // the board before the visible resistance/release beat.
      { duration: flight.duration, easing: 'linear' },
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
        { transform: 'scale(1.1)', easing: LANDING_EASING },
        { transform: 'scale(.94)', offset: 4 / 9, easing: LANDING_EASING },
        { transform: 'scale(1)', easing: LANDING_EASING },
      ], {
        duration: 576,
        easing: 'linear',
      }, isCurrent);
      cancelSpellAnimations(landed);
      landed.classList.remove('pilfer-soft-settle');
    }
    await Promise.all(sideAnimations);
  } finally {
    clearTarget();
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
