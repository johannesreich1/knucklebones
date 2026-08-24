// The die as a component: one factory returns a fully-styled element, usable
// on the board, the centre stage, the title screen and the widget alike.
import { ME, type Player } from '../core/rules.ts';
import { formatNumber, subscribeLocale, t } from '../i18n/index.ts';
import { $ } from './dom.ts';
import { dieMarkup } from './die-markup.ts';
import { appRoot } from './embed.ts';
import { nameOf } from './identity.ts';

export function makeDie(v: number, who: Player): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = dieMarkup(v, {
    classes: who === ME ? 'p1' : 'p2',
    dataValue: true,
    role: 'img',
    ariaLabel: t('game', 'die.faceForPlayer', { value: formatNumber(v), player: nameOf(who) }),
  });
  const die = template.content.firstElementChild as HTMLElement;
  die.dataset.kbPlayer = String(who);
  return die;
}

function repaintDieLabels(): void {
  if (typeof document === 'undefined') return;
  appRoot().querySelectorAll<HTMLElement>('.die[role="img"][data-kb-player][data-v]').forEach((die) => {
    const value = Number(die.dataset.v);
    const who = Number(die.dataset.kbPlayer) as Player;
    if (Number.isFinite(value) && (who === 0 || who === 1)) {
      die.setAttribute('aria-label', t('game', 'die.faceForPlayer', {
        value: formatNumber(value), player: nameOf(who),
      }));
    }
  });
}

let liveStage: { value: number; who?: Player } | null = null;
function repaintStageLabel(): void {
  if (!liveStage || typeof document === 'undefined') return;
  const stage = appRoot().querySelector<HTMLElement>('#dieStage');
  if (!stage) return;
  const { value, who } = liveStage;
  stage.setAttribute('aria-label', value
    ? t('game', 'die.rolledForPlayer', { value: formatNumber(value), player: nameOf(who!) })
    : t('game', 'die.noneRolled'));
}

subscribeLocale(() => {
  repaintDieLabels();
  repaintStageLabel();
});

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
  st.removeAttribute('data-i18n-attr');
  liveStage = { value: v, who };
  repaintStageLabel();
  if (v) {
    const d = makeGameDie(v, who!);
    d.removeAttribute('role'); d.removeAttribute('aria-label');
    st.appendChild(d);
  }
}
