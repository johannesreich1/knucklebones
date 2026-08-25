import { subscribeLocale } from '../i18n/index.ts';
import { saveStats } from '../persist.ts';
import { Sfx } from '../ui/audio.ts';
import { $ } from '../ui/dom.ts';
import {
  pickerButtons,
  pickInfo,
  type PickItem,
} from '../ui/library.ts';
import { tap } from '../ui/tap.ts';

export function eventButton(event: Event): HTMLButtonElement | null {
  return event.target instanceof Element
    ? event.target.closest('button') as HTMLButtonElement | null
    : null;
}

export function bindPickerRow(
  selector: string,
  items: PickItem[],
  read: () => string | number,
  write: (value: string) => void,
  available: (item: PickItem) => { enabled: boolean; reason?: string } = () => ({ enabled: true }),
): () => void {
  const strip = $(selector);
  const info = $(selector + 'Info');
  const sync = (): void => {
    const current = String(read());
    strip.querySelectorAll('button').forEach((button) => {
      button.classList.toggle('on', (button as HTMLButtonElement).dataset.v === current);
      const item = items.find((candidate) => candidate.v === (button as HTMLButtonElement).dataset.v);
      const state = item ? available(item) : { enabled: false };
      (button as HTMLButtonElement).disabled = !state.enabled;
      button.classList.toggle('locked', !state.enabled);
      if (item) button.setAttribute('aria-label', state.reason ? `${item.name}. ${state.reason}` : item.name);
      if (state.reason) button.setAttribute('title', state.reason);
      else button.removeAttribute('title');
    });
    info.textContent = pickInfo(items, current);
  };
  tap(strip, (event) => {
    const button = eventButton(event);
    const value = button?.dataset.v;
    if (!button || button.disabled || value === undefined) return;
    write(value);
    saveStats();
    sync();
    Sfx.unlock();
    Sfx.tap();
  });
  const refresh = (): void => {
    const buttons = Array.from(strip.querySelectorAll<HTMLButtonElement>('button'));
    const sameRegistry = buttons.length === items.length
      && buttons.every((button, index) => button.dataset.v === items[index]?.v);
    if (!sameRegistry) {
      strip.innerHTML = pickerButtons(items);
    } else {
      /* Locale changes alter copy, not registry identity. Keep every button
         (and therefore keyboard focus and the delegated gesture) in place. */
      buttons.forEach((button, index) => button.setAttribute('aria-label', items[index].name));
    }
    sync();
  };
  subscribeLocale(refresh);
  refresh();
  return sync;
}
