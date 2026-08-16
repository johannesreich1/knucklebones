// The die as a component: one factory returns a fully-styled element, usable
// on the board, the centre stage, the title screen and the widget alike.
import { ME, type Player } from '../core/rules';
import { $ } from './dom';
import { nameOf } from './identity';

/* Pip positions on the die FACE's own 3×3 grid, per value. This is dice
   anatomy, not board shape — a 4-column game mode still rolls these dice. */
const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
};
const FACE_CELLS = 9;

export function makeDie(v: number, who: Player): HTMLElement {
  const d = document.createElement('div');
  d.className = 'die ' + (who === ME ? 'p1' : 'p2');
  d.dataset.v = String(v);
  d.setAttribute('role', 'img');
  d.setAttribute('aria-label', v + ', ' + nameOf(who).toLowerCase());
  const on = PIPS[v] || [];
  for (let i = 0; i < FACE_CELLS; i++) {
    const p = document.createElement('span');
    p.className = 'pip' + (on.indexOf(i) >= 0 ? ' on' : '');
    p.setAttribute('aria-hidden', 'true');
    d.appendChild(p);
  }
  const n = document.createElement('b');
  n.className = 'num'; n.textContent = String(v); n.setAttribute('aria-hidden', 'true');
  d.appendChild(n);
  return d;
}

export function setStageDie(v: number, who?: Player): void {
  const st = $('#dieStage'); st.innerHTML = '';
  st.setAttribute('aria-label', v ? ('Rolled ' + v + ' for ' + nameOf(who!).toLowerCase()) : 'No die rolled yet');
  if (v) {
    const d = makeDie(v, who!);
    d.removeAttribute('role'); d.removeAttribute('aria-label');
    st.appendChild(d);
  }
}
