// The die as a component: one factory returns a fully-styled element, usable
// on the board, the centre stage, the title screen and the widget alike.
import { ME, type Player } from '../core/rules.ts';
import { $ } from './dom.ts';
import { dieMarkup } from './die-markup.ts';
import { nameOf } from './identity.ts';

export function makeDie(v: number, who: Player): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = dieMarkup(v, {
    classes: who === ME ? 'p1' : 'p2',
    dataValue: true,
    role: 'img',
    ariaLabel: `${v}, ${nameOf(who).toLowerCase()}`,
  });
  return template.content.firstElementChild as HTMLElement;
}

/* Only dice that are part of a live duel follow the pips/numerals setting.
   Brand dice, avatars and matchmaking decoration use makeDie() directly;
   loaders render the same fixed face through dieMarkup(). */
export function makeGameDie(v: number, who: Player): HTMLElement {
  const die = makeDie(v, who);
  die.classList.add('game-die');
  return die;
}

export function setStageDie(v: number, who?: Player): void {
  const st = $('#dieStage'); st.innerHTML = '';
  st.setAttribute('aria-label', v ? ('Rolled ' + v + ' for ' + nameOf(who!).toLowerCase()) : 'No die rolled yet');
  if (v) {
    const d = makeGameDie(v, who!);
    d.removeAttribute('role'); d.removeAttribute('aria-label');
    st.appendChild(d);
  }
}
