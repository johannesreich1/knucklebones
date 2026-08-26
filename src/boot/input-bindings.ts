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
import { castArmedByIndex, disarm } from '../flow/spells.ts';
import { closeOpenLegalPage } from '../ui/legal.ts';

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
    if (S.spellArmed) {
      /* A synthetic/accessibility click reports (0,0), not the column's page
         coordinates. Hand the typed input seam the semantic target instead. */
      boardUp({ target: event.target });
      return;
    }
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
      if (castArmedByIndex(column)) return;
      if (S.phase === 'choose' && !S.busy && (S.mode === 'duo' || who === ME)) {
        commitColumn(colEl(who, column));
      }
      return;
    }

    if (rawEvent.key === 'Enter' || rawEvent.key === ' ') {
      /* Native controls already turn these keys into their own click. Letting
         the document shortcut answer too made a focused Ranked button start a
         local first-game offer and the online route from one key press. */
      if (eventElement(rawEvent.target)?.closest(
        'button,a[href],input,select,textarea,[role="button"],[contenteditable="true"]',
      )) return;
      const pass = $('#ovPass');
      if (pass.classList.contains('on')) {
        pass.click();
      } else if (!root.querySelector('.faceoff [aria-modal="true"],.ov.on[aria-modal="true"]')) {
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

    if (rawEvent.key !== 'Escape') return;
    if (closeOpenLegalPage()) {
      rawEvent.preventDefault();
      return;
    }
    if (sheetOpen()) return;
    disarm();
    hide('#ovRules');
    hide('#ovSettings');
    hide('#ovLearn');
    dismissAsk();
    for (const id of ['ovModes', 'ovSpells']) {
      if (root.querySelector('#' + id)) hide('#' + id);
    }
  });
}
