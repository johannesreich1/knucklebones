// Board input is a typed UI seam. The composition root supplies the local
// game and spell operations; ranked play temporarily swaps only placement.
import { ME, SPEC, type Player } from '../core/rules.ts';
import { S } from '../state.ts';
import { ownerOf } from './dom.ts';
import { nope } from './fx.ts';
import { Sfx } from './audio.ts';
import { rootElementFromPoint } from './query.ts';

export type PlaceHandler = (who: Player, col: number) => void | Promise<void>;
export type CastArmedHandler = (target: number | null) => boolean;

export interface InputPorts {
  place: PlaceHandler;
  castArmed: CastArmedHandler;
}

let localPlace: PlaceHandler | null = null;
let placeHandler: PlaceHandler | null = null;
let castArmedHandler: CastArmedHandler = () => false;

export function configureInput(ports: InputPorts): void {
  localPlace = ports.place;
  placeHandler = ports.place;
  castArmedHandler = ports.castArmed;
}

/* Online matches route placements to the server instead of the local machine.
   Everything else about input (gesture, gating and feedback) stays identical. */
export function setPlaceHandler(handler: PlaceHandler | null): void {
  placeHandler = handler ?? localPlace;
}

export interface BoardInputEvent {
  target: EventTarget | null;
  clientX?: number;
  clientY?: number;
}

/* Placement commits on RELEASE over the same column it started on, so a
   mis-tap can be cancelled by sliding a finger off before lifting. Touch
   implicitly captures the pointer to the original element, so the element
   actually under the finger has to be looked up by coordinate. */
let pressedCol: HTMLElement | null = null;

function eventElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

function sideOwner(col: HTMLElement): Player | null {
  const side = col.closest('.side') as HTMLElement | null;
  return side ? ownerOf(side) : null;
}

function playableCol(col: HTMLElement | null): boolean {
  if (!col || S.phase !== 'choose' || S.busy) return false;
  const who = sideOwner(col);
  return who === S.turn && !(S.mode === 'cpu' && who !== ME);
}

export function clearPress(): void {
  pressedCol?.classList.remove('press');
  pressedCol = null;
}

export function boardDown(event: BoardInputEvent): void {
  const col = eventElement(event.target)?.closest('.col') as HTMLElement | null;
  clearPress();
  if (!col || S.spellArmed || !playableCol(col)) return;
  pressedCol = col;
  col.classList.add('press');
}

export function boardUp(event: BoardInputEvent): void {
  const started = pressedCol;
  clearPress();
  let over: HTMLElement | null = null;
  let onStage = false;
  if (event.clientX !== undefined && event.clientY !== undefined) {
    const element = rootElementFromPoint(event.clientX, event.clientY);
    over = element?.closest('.col') as HTMLElement | null;
    onStage = !!element?.closest('#dieStage');
  } else {
    over = started;
  }

  // An armed spell claims the tap: a column, the die in play (-1), or a
  // cancellation. The injected spell port owns the target vocabulary.
  if (S.spellArmed) {
    castArmedHandler(onStage ? -1 : over ? Number(over.dataset.col) : null);
    return;
  }
  if (!started || over !== started) return;
  commitColumn(started);
}

export function commitColumn(col: HTMLElement | null): void {
  if (!col) return;
  const who = sideOwner(col);
  if (who === null || S.phase !== 'choose' || S.busy || who !== S.turn) return;
  if (S.mode === 'cpu' && who !== ME) return;
  const column = Number(col.dataset.col);
  if (!Number.isInteger(column) || column < 0 || column >= SPEC.cols) return;
  if (S.tut?.restrict != null && column !== S.tut.restrict) {
    nope(col);
    Sfx.tap();
    return;
  }
  if (S.boards[who][column].length >= SPEC.rows) {
    nope(col);
    Sfx.tap();
    return;
  }
  Sfx.tap();
  void placeHandler?.(who, column);
}
