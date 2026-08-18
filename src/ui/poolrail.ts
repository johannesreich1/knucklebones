// The finite-bag rail (LIMITED mode): six neutral mini dice with live
// remaining counts. Shared surface — online play derives the counts from the
// public move log + pending die (see online/play.ts), offline games tally
// their local bag directly. Pure DOM helper; state interpretation stays with
// the callers.
import { DICE_FACES } from '../config.ts';
import { POOL_PER_FACE } from '../core/dice.ts';
import { ME } from '../core/rules.ts';
import { $ } from './dom.ts';
import { makeDie } from './die.ts';

export function showPoolRail(on: boolean): void {
  const rail = $('#poolRail') as HTMLElement;
  rail.hidden = !on;
  if (!on) return;
  rail.innerHTML = '';
  for (let v = 1; v <= DICE_FACES; v++) {
    const w = document.createElement('span');
    w.className = 'pmini';
    w.dataset.v = String(v);
    const d = makeDie(v, ME);
    d.classList.remove('p1');                    // neutral slate, nobody's colour
    w.appendChild(d);
    const c = document.createElement('b');
    c.className = 'pc';
    c.textContent = String(POOL_PER_FACE);
    w.appendChild(c);
    rail.appendChild(w);
  }
}

/* left is indexed by face (1..DICE_FACES); a changed count pulses its mini */
export function renderPoolCounts(left: number[]): void {
  document.querySelectorAll('#poolRail .pmini').forEach((el) => {
    const v = +((el as HTMLElement).dataset.v ?? 0);
    const n = Math.max(0, left[v] ?? 0);
    const c = el.querySelector('.pc')!;
    if (c.textContent !== String(n)) {
      c.textContent = String(n);
      el.classList.remove('tick');
      void (el as HTMLElement).offsetWidth;      // restart the pulse
      el.classList.add('tick');
    }
    el.classList.toggle('out', n <= 0);
  });
}
