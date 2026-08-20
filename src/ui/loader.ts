// The loading die — ONE loader for every wait (design card 34a, "LD1 pip
// clock"). The die face IS the spinner: all nine pips forced visible, the
// eight rim pips dimming in a clockwise chase while the heart breathes.
// Built on makeDie, so it is the game's own die at any size; the animation
// lives in styles/main.css because the biggest wait of all is the online
// chunk still downloading, when online.css does not exist yet.
// A wait that ends within the loader's .2s grace never shows at all (the
// ldreveal animation in main.css) — a fast answer must not flash a die.
import { ME } from '../core/rules.ts';
import { makeDie } from './die.ts';

/* the bare die, for inline waits — readable from 24px up */
export function loaderDie(size = 44): HTMLElement {
  const d = makeDie(6, ME);
  d.classList.add('ldclock');
  d.style.width = d.style.height = `${size}px`;
  d.style.setProperty('--cell', `${size}px`);
  d.setAttribute('aria-label', 'Loading');
  return d;
}

/* die + label, centred — the panel and full-page form */
export function loaderWait(size = 44, label = 'Loading'): HTMLElement {
  const w = document.createElement('div');
  w.className = 'ldwait';
  w.appendChild(loaderDie(size));
  const m = document.createElement('div');
  m.className = 'ldmsg';
  m.textContent = label;
  w.appendChild(m);
  return w;
}
