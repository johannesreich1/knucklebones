// Pointer/tap handling for a rune. The runtime operations are injected so this
// leaf can own the gesture without importing the spell flow back upward.
import { spellById } from '../core/spells.ts';
import { S } from '../state.ts';
import { appRoot, isEmbed, rootRect } from '../ui/embed.ts';
import { Sfx } from '../ui/audio.ts';
import { fxRoot } from '../ui/fx.ts';
import { rootElementFromPoint } from '../ui/query.ts';
import { spellHue, spellIcon } from '../ui/spellicons.ts';
import { isAimedColumn } from './spell-rail.ts';

export interface SpellGesturePorts {
  arm: (id: string) => void;
  disarm: () => void;
  cast: (id: string, column: number) => Promise<boolean>;
  castable: (id: string) => boolean;
  undoable: (id: string) => boolean;
  undoCast: () => boolean;
}

const SLOP = 8;

export function bindSpellGesture(
  button: HTMLButtonElement,
  id: string,
  ports: SpellGesturePorts,
): void {
  if (!window.PointerEvent) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (spellById(id)?.target === 'self') {
        if (ports.undoCast()) return;
        if (ports.castable(id)) void ports.cast(id, -1);
        else bump(button);
        return;
      }
      S.spellArmed === id ? ports.disarm() : tryArm(button, id, ports);
    });
    return;
  }

  button.addEventListener('click', (event) => event.stopPropagation());
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const self = spellById(id)?.target === 'self';
    const wasArmed = S.spellArmed === id;
    if (!ports.castable(id) && !ports.undoable(id)) {
      Sfx.tap();
      bump(button);
      return;
    }
    if (self) Sfx.tap();
    else if (!tryArm(button, id, ports)) return;

    const x0 = event.clientX;
    const y0 = event.clientY;
    let dragging = false;
    const move = (moveEvent: PointerEvent): void => {
      if (!dragging && Math.hypot(moveEvent.clientX - x0, moveEvent.clientY - y0) > SLOP) {
        dragging = true;
        if (self) ports.arm(id);
        showGhost(id);
      }
      if (dragging) moveGhost(moveEvent.clientX, moveEvent.clientY, id);
    };
    const up = (upEvent: PointerEvent): void => {
      upEvent.stopPropagation();
      button.removeEventListener('pointermove', move);
      button.removeEventListener('pointerup', up);
      button.removeEventListener('pointercancel', up);
      if (!dragging) {
        if (self) {
          if (!ports.undoCast()) void ports.cast(id, -1);
          return;
        }
        if (wasArmed) { Sfx.tap(); ports.disarm(); }
        return;
      }
      const target = targetAt(upEvent.clientX, upEvent.clientY, id);
      hideGhost();
      if (target === null) { Sfx.tap(); ports.disarm(); return; }
      void ports.cast(id, target);
    };
    button.addEventListener('pointermove', move);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    try { button.setPointerCapture(event.pointerId); } catch { /* drag without capture */ }
  });
}

function tryArm(button: HTMLButtonElement, id: string, ports: SpellGesturePorts): boolean {
  if (!ports.castable(id)) {
    Sfx.tap();
    bump(button);
    return false;
  }
  Sfx.tap();
  ports.arm(id);
  return true;
}

function bump(button: HTMLElement): void {
  button.classList.remove('bump');
  void button.offsetWidth;
  button.classList.add('bump');
}

let ghost: HTMLElement | null = null;

function showGhost(id: string): void {
  hideGhost();
  const next = document.createElement('div');
  next.className = 'runeghost';
  next.style.setProperty('--sh', spellHue(id));
  next.style.position = isEmbed() ? 'absolute' : 'fixed';
  next.innerHTML = spellIcon(id, 26);
  fxRoot().appendChild(next);
  ghost = next;
}

function moveGhost(x: number, y: number, id: string): void {
  if (!ghost) return;
  const offset = isEmbed() ? rootRect() : { left: 0, top: 0 };
  ghost.style.left = `${x - offset.left}px`;
  ghost.style.top = `${y - offset.top}px`;
  const target = targetAt(x, y, id);
  if (spellById(id)?.target === 'self') {
    setStageHot(target === -1);
    setHot(null);
  } else {
    setHot(target !== null && target >= 0 ? target : null);
  }
}

function hideGhost(): void {
  ghost?.remove();
  ghost = null;
  setStageHot(false);
}

export function targetAt(x: number, y: number, id: string): number | null {
  const element = rootElementFromPoint(x, y);
  if (!element) return null;
  if (spellById(id)?.target === 'self') return element.closest('#dieStage') ? -1 : null;
  const column = element.closest('.col') as HTMLElement | null;
  if (!column) return null;
  const index = Number(column.dataset.col);
  return Number.isInteger(index) && isAimedColumn(index) ? index : null;
}

export function clearSpellTargets(): void {
  setHot(null);
  setStageHot(false);
}

function setHot(column: number | null): void {
  appRoot().querySelectorAll('.col.hot').forEach((element) => element.classList.remove('hot'));
  if (column === null) return;
  appRoot().querySelectorAll(`.col.aim[data-col="${column}"]`)
    .forEach((element) => element.classList.add('hot'));
}

function setStageHot(on: boolean): void {
  appRoot().querySelector('#dieStage')?.classList.toggle('hot', on);
}
