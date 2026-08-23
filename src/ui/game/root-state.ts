// Typed ownership of the game shell's #kbroot state contract. Each function
// exposes a game/layout fact rather than an arbitrary class name, and the
// dependent-state invariants live here:
//   - `rowswitch` always implies `rowmode`;
//   - `castself` always implies `casting`;
//   - `p2turn` may only exist during face-to-face seating.

import { appRoot } from '../embed.ts';

type GameRootClass =
  | 'rowmode' | 'rowswitch'
  | 'face' | 'p2turn'
  | 'land' | 'shortv' | 'sidepts'
  | 'casting' | 'castself'
  | 'numerals' | 'clock' | 'tut' | 'reduce-motion';

function setClass(name: GameRootClass, on: boolean): void {
  appRoot().classList.toggle(name, on);
}

export type ScoringPresentation = 'columns' | 'row-multiply' | 'row-switch';

export function setScoringPresentation(mode: ScoringPresentation): void {
  setClass('rowmode', mode !== 'columns');
  setClass('rowswitch', mode === 'row-switch');
}

export type SeatingPresentation = 'shared' | 'face-to-face';

export function setSeatingPresentation(mode: SeatingPresentation): void {
  const face = mode === 'face-to-face';
  setClass('face', face);
  if (!face) setClass('p2turn', false);
}

export function isFaceToFace(): boolean {
  return appRoot().classList.contains('face');
}

export type ActiveHalf = 'none' | 'top' | 'bottom';

export function setTurnPresentation(active: ActiveHalf): void {
  setClass('p2turn', isFaceToFace() && active === 'top');
}

/* These layout facts are independent: a viewport may be short while a menu
   deliberately stays portrait, and side points are possible only after the
   cell/gutter budget has been measured. */
export function setLandscapeLayout(on: boolean): void { setClass('land', on); }
export function setShortViewport(on: boolean): void { setClass('shortv', on); }
export function setSidePointsLayout(on: boolean): void { setClass('sidepts', on); }

export function isLandscapeLayout(): boolean {
  return appRoot().classList.contains('land');
}

export type CastingPresentation = 'none' | 'column' | 'self';

export function setCastingPresentation(target: CastingPresentation): void {
  setClass('casting', target !== 'none');
  setClass('castself', target === 'self');
}

export function setNumeralPresentation(on: boolean): void { setClass('numerals', on); }
export function setReducedMotionPresentation(on: boolean): void { setClass('reduce-motion', on); }
export function setClockPresentation(on: boolean): void { setClass('clock', on); }
export function setTutorialPresentation(on: boolean): void { setClass('tut', on); }
