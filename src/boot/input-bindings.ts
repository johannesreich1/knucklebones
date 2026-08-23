// Board and keyboard input wiring for both standalone and widget entry points.
import { ME, SPEC } from '../core/rules.ts';
import { S } from '../state.ts';
import { Sfx } from '../ui/audio.ts';
import { dismissAsk } from '../ui/askcard.ts';
import { $, colEl, hide } from '../ui/dom.ts';
import { isEmbed, kbroot } from '../ui/embed.ts';
import { boardDown, boardUp, clearPress, commitColumn } from '../ui/input.ts';
import { sheetOpen } from '../ui/sheet.ts';
import { startLocal } from '../flow/game.ts';
import { castArmed, disarm } from '../flow/spells.ts';

function eventElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

export function bindBoardInput(): void {
  const table = $('#tableEl');
  let sawPointer = false;
  if (window.PointerEvent) {
    table.addEventListener('pointerdown', (event) => {
      sawPointer = true;
      boardDown(event);
    });
    table.addEventListener('pointerup', (event) => boardUp(event));
    table.addEventListener('pointercancel', clearPress);
  } else if ('ontouchstart' in window) {
    table.addEventListener('touchstart', (event) => {
      sawPointer = true;
      boardDown({ target: event.target });
    }, { passive: true });
    table.addEventListener('touchend', (event) => {
      const touch = event.changedTouches[0];
      boardUp(touch
        ? { clientX: touch.clientX, clientY: touch.clientY, target: event.target }
        : { target: event.target });
    });
    table.addEventListener('touchcancel', clearPress);
  }
  // Click is only the fallback for hosts where neither pointer nor touch fires.
  table.addEventListener('click', (event) => {
    if (sawPointer) return;
    commitColumn(eventElement(event.target)?.closest('.col') as HTMLElement | null);
  });
}

export function bindKeyboard(root: HTMLElement): void {
  const target: EventTarget = isEmbed() ? root : document;
  target.addEventListener('keydown', (rawEvent) => {
    if (!(rawEvent instanceof KeyboardEvent)) return;
    if (isEmbed() && !kbroot()) return;
    const columnKey = Number(rawEvent.key);
    if (columnKey >= 1 && columnKey <= SPEC.cols) {
      const column = columnKey - 1;
      const who = S.turn;
      if (castArmed(column)) return;
      if (S.phase === 'choose' && !S.busy && (S.mode === 'duo' || who === ME)) {
        commitColumn(colEl(who, column));
      }
      return;
    }

    if (rawEvent.key === 'Enter' || rawEvent.key === ' ') {
      const pass = $('#ovPass');
      if (pass.classList.contains('on')) {
        pass.click();
      } else if (!root.querySelector('[aria-modal="true"]')) {
        /* #ovStart stays on beneath nested rooms. Only the last visible room
           may claim replay/start, and a modal owns the key while present. */
        const rooms = root.querySelectorAll<HTMLElement>('.ov.on');
        const room = rooms.item(rooms.length - 1);
        if (room && (room.id === 'ovStart' || room.id === 'ovEnd')) {
          Sfx.unlock();
          void startLocal();
        }
      }
      return;
    }

    if (rawEvent.key !== 'Escape' || sheetOpen()) return;
    disarm();
    hide('#ovRules');
    hide('#ovSettings');
    hide('#ovLearn');
    dismissAsk();
    hide('#ovImprint');
    hide('#ovPrivacy');
    for (const id of ['ovModes', 'ovSpells']) {
      if (root.querySelector('#' + id)) hide('#' + id);
    }
  });
}
