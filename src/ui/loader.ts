// The loading die — ONE loader for every wait (design card 34a, "LD1 pip
// clock"). The die face IS the spinner: all nine pips forced visible, the
// eight rim pips dimming in a clockwise chase while the heart breathes.
// Built on makeDie, so it is the game's own die at any size; the animation
// lives in styles/main.css because the biggest wait of all is the online
// chunk still downloading, when online.css does not exist yet.
// A wait that ends within the loader's .2s grace never shows at all (the
// ldreveal animation in main.css) — a fast answer must not flash a die.
import { dieMarkup, escapeMarkupText } from './die-markup.ts';

export const loaderDieMarkup = (size = 44): string => dieMarkup(6, {
  classes: 'p1 ldclock',
  size,
  dataValue: true,
  role: 'img',
  ariaLabel: 'Loading',
});

export const loaderWaitMarkup = (size = 44, label = 'Loading'): string =>
  `<div class="ldwait">${loaderDieMarkup(size)}<div class="ldmsg">${escapeMarkupText(label)}</div></div>`;

function markupElement(markup: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content.firstElementChild as HTMLElement;
}

/* the bare die, for inline waits — readable from 24px up */
export function loaderDie(size = 44): HTMLElement {
  return markupElement(loaderDieMarkup(size));
}

/* die + label, centred — the panel and full-page form */
export function loaderWait(size = 44, label = 'Loading'): HTMLElement {
  return markupElement(loaderWaitMarkup(size, label));
}
