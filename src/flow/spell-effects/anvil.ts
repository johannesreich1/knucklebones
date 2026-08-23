// AN2 — FORGE HEAT, with AN3's single expanding solid border at the reveal.
// The worked die never rotates: it heats, softens, changes face, and cools.
import { anvilTargetIndex } from '../../core/spells.ts';
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../../ui/audio.ts';
import { faceRotated, slotEl, slotIdx } from '../../ui/dom.ts';
import { REDUCED, fxRoot, pin } from '../../ui/fx.ts';
import { renderSide } from '../../ui/game/board.ts';
import {
  cancelSpellAnimations,
  playSpellAnimation,
} from '../../ui/game/spell-motion.ts';
import { spellHue } from '../../ui/spellicons.ts';
import { effectPause, type SpellEffect } from './types.ts';

const HEAT_UP_MS = 310;
const COOL_DOWN_MS = 370;

interface Workpiece {
  root: HTMLElement;
  face: HTMLElement;
  heat: HTMLElement;
  glow: HTMLElement;
  ring: HTMLElement;
}

function cloneFace(source: HTMLElement, who: 0 | 1): HTMLElement {
  const face = source.cloneNode(true) as HTMLElement;
  face.classList.remove('settle', 'dying', 'spellpreview', 'anvilpreview');
  face.classList.add('anvil-workpiece-face');
  face.classList.toggle('p2flip', faceRotated(who));
  face.removeAttribute('role');
  face.removeAttribute('aria-label');
  face.setAttribute('aria-hidden', 'true');
  return face;
}

function makeWorkpiece(source: HTMLElement, who: 0 | 1): Workpiece {
  const root = document.createElement('div');
  root.className = 'anvil-workpiece';
  root.setAttribute('aria-hidden', 'true');
  root.style.setProperty('--spell-hue', spellHue('anvil'));
  pin(root, source.getBoundingClientRect(), 69);

  const face = cloneFace(source, who);
  const heat = document.createElement('i');
  heat.className = 'anvil-forge-heat';
  const glow = document.createElement('i');
  glow.className = 'anvil-forge-glow';
  const ring = document.createElement('i');
  ring.className = 'anvil-recast-ring';
  root.append(face, heat, glow, ring);
  fxRoot().appendChild(root);
  return { root, face, heat, glow, ring };
}

function replaceFace(workpiece: Workpiece, source: HTMLElement, who: 0 | 1): void {
  const face = cloneFace(source, who);
  workpiece.face.replaceWith(face);
  workpiece.face = face;
}

function clearWorkpiece(workpiece: Workpiece): void {
  cancelSpellAnimations(workpiece.root);
  for (const element of workpiece.root.querySelectorAll('*')) cancelSpellAnimations(element);
  workpiece.root.remove();
}

export const anvilEffect: SpellEffect = async (who, column, apply) => {
  const generation = S.gen;
  const isCurrent = (): boolean => S.gen === generation;
  const targetIndex = anvilTargetIndex(S.boards[who][column]);
  const targetSlot = targetIndex === null
    ? null
    : slotEl(who, column, slotIdx(who, targetIndex));
  const source = targetSlot?.firstElementChild as HTMLElement | null;
  let applied = false;

  const commit = (): void => {
    if (applied || !isCurrent()) return;
    applied = true;
    apply();
    // The new face, its new multiplier and the column/total scores repaint at
    // the white-hot cut, while the overlay preserves the die's exact centre.
    renderSide(who, false);
    Sfx.mult();
  };

  Sfx.spell();
  vibrate([10, 30, 14]);
  source?.classList.remove('spellpreview', 'anvilpreview');

  if (REDUCED || targetIndex === null || !source || !targetSlot) {
    commit();
    await effectPause(0);
    return;
  }

  const workpiece = makeWorkpiece(source, who);
  source.style.visibility = 'hidden';
  let paintedTarget: HTMLElement | null = null;

  try {
    const heated = await Promise.all([
      playSpellAnimation(workpiece.root, [
        { transform: 'scale(1,1)' },
        { transform: 'scale(1.025,.985)', offset: .55 },
        { transform: 'scale(1.07,.9)' },
      ], { duration: HEAT_UP_MS, easing: 'cubic-bezier(.4,0,.3,1)' }, isCurrent),
      playSpellAnimation(workpiece.face, [
        { filter: 'brightness(1) saturate(1)' },
        { filter: 'brightness(1.5) saturate(.9)', offset: .58 },
        { filter: 'brightness(2.7) saturate(.35) contrast(.88)' },
      ], { duration: HEAT_UP_MS, easing: 'ease-in' }, isCurrent),
      playSpellAnimation(workpiece.heat, [
        { opacity: .12, filter: 'brightness(1)' },
        { opacity: .68, filter: 'brightness(1.35)', offset: .58 },
        { opacity: 1, filter: 'brightness(2.4) saturate(.45)' },
      ], { duration: HEAT_UP_MS, easing: 'ease-in' }, isCurrent),
      playSpellAnimation(workpiece.glow, [
        { opacity: .12, transform: 'scale(.82)' },
        { opacity: 1, transform: 'scale(1.08)' },
      ], { duration: HEAT_UP_MS, easing: 'ease-out' }, isCurrent),
    ]);
    if (heated.some((completed) => !completed) || !isCurrent()) return;

    commit();
    if (!applied) return;
    paintedTarget = slotEl(who, column, slotIdx(who, targetIndex))
      ?.firstElementChild as HTMLElement | null;
    if (!paintedTarget) return;
    paintedTarget.style.visibility = 'hidden';
    replaceFace(workpiece, paintedTarget, who);

    // Retire the heat-up fills before the second phase starts from their exact
    // end values. Otherwise the finished pre-animation would reassert itself
    // after cooling and leave a permanently squashed workpiece.
    cancelSpellAnimations(workpiece.root);
    cancelSpellAnimations(workpiece.heat);
    cancelSpellAnimations(workpiece.glow);

    await Promise.all([
      playSpellAnimation(workpiece.root, [
        { transform: 'scale(1.07,.9)' },
        { transform: 'scale(.96,1.06)', offset: .25 },
        { transform: 'scale(1,1)', offset: .72 },
        { transform: 'scale(1,1)' },
      ], { duration: COOL_DOWN_MS, easing: 'cubic-bezier(.35,0,.25,1)' }, isCurrent),
      playSpellAnimation(workpiece.face, [
        { filter: 'brightness(2.7) saturate(.35) contrast(.88)' },
        { filter: 'brightness(1.45) saturate(.82)', offset: .42 },
        { filter: 'brightness(1) saturate(1)' },
      ], { duration: COOL_DOWN_MS, easing: 'ease-out' }, isCurrent),
      playSpellAnimation(workpiece.heat, [
        { opacity: 1, filter: 'brightness(2.4) saturate(.45)' },
        { opacity: .76, filter: 'brightness(1.35)', offset: .28 },
        { opacity: 0, filter: 'brightness(1)' },
      ], { duration: COOL_DOWN_MS, easing: 'ease-out' }, isCurrent),
      playSpellAnimation(workpiece.glow, [
        { opacity: 1, transform: 'scale(1.08)' },
        { opacity: .46, transform: 'scale(1.2)', offset: .48 },
        { opacity: 0, transform: 'scale(1.32)' },
      ], { duration: COOL_DOWN_MS, easing: 'ease-out' }, isCurrent),
      // The one borrowed AN3 beat: a SOLID border expands exactly once from
      // the face-change moment. There is no spinning ring before or after it.
      playSpellAnimation(workpiece.ring, [
        { opacity: 0, transform: 'scale(.5)' },
        { opacity: 1, transform: 'scale(1)', offset: .16 },
        { opacity: 0, transform: 'scale(2.4)' },
      ], { duration: COOL_DOWN_MS, easing: 'ease-out' }, isCurrent),
    ]);
  } finally {
    clearWorkpiece(workpiece);
    source.style.visibility = '';
    const currentTarget = targetIndex === null
      ? null
      : slotEl(who, column, slotIdx(who, targetIndex))?.firstElementChild as HTMLElement | null;
    if (paintedTarget) paintedTarget.style.visibility = '';
    if (currentTarget) currentTarget.style.visibility = '';
  }
};
