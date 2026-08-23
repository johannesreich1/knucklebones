// The title screen and settings panel: what they show. Mid-game resume was
// removed by design; leaving an offline game simply ends it. The composition
// root injects the two flow operations this screen needs.
import { S } from '../state.ts';
import { $, show, hide } from '../ui/dom.ts';
import { stopTimer } from './timer.ts';
import { clearTut } from './tutorial.ts';
import { clearHints } from '../ui/game/hints.ts';
import { setNumeralPresentation } from '../ui/game/root-state.ts';
import { appRoot } from '../ui/embed.ts';
import { REDUCED, setReducedMotion } from '../ui/fx.ts';

export interface MenuPorts {
  cancelPass: () => void;
  renderSpells: () => void;
}

let menuPorts: MenuPorts = {
  cancelPass: () => undefined,
  renderSpells: () => undefined,
};

export function configureMenu(ports: MenuPorts): void {
  menuPorts = ports;
}

function segOn(selector: string, key: string, value: string): void {
  appRoot().querySelectorAll<HTMLButtonElement>(selector + ' button').forEach((button) => {
    button.classList.toggle('on', button.dataset[key] === value);
  });
}

/* Single source of truth for what the title screen should look like now. */
export function syncSettingsUI(): void {
  const duo = S.mode === 'duo';
  $('#diffCard').hidden = duo;
  $('#seatCard').hidden = !duo;
  $('#timerCard').hidden = !duo;
  $('#btnPlay').textContent = duo ? 'Play duel' : 'Play vs AI';
  segOn('#modeSeg', 'm', S.mode);
  segOn('#diffSeg', 'd', S.diff);
  segOn('#timerSeg', 't', String(S.timer));
  segOn('#seatSeg', 'seat', S.seat);
  segOn('#sndSeg', 's', S.sound ? '1' : '0');
  segOn('#faceSeg', 'f', S.numerals ? 'nums' : 'pips');
  segOn('#cbSeg', 'b', S.colorblind ? '1' : '0');
  setReducedMotion(S.reducedMotion);
  segOn('#motionSeg', 'rm', REDUCED ? '1' : '0');

  /* Colour blind mode overrides the displayed pair without changing the
     stored picks. Multiplier fallbacks remain distinct from each side. */
  const p1 = S.colorblind ? 'cy' : S.p1Hue;
  const p2 = S.colorblind ? 'gold' : S.p2Hue;
  const style = appRoot().style;
  style.setProperty('--wdc', `var(--${S.colorblind ? 'red' : 'wdc-mint'})`);
  const pairs: Array<readonly ['p1' | 'p2', string]> = [['p1', p1], ['p2', p2]];
  for (const [slot, hue] of pairs) {
    style.setProperty(`--${slot}`, `var(--${hue})`);
    style.setProperty(`--${slot}-rgb`, `var(--${hue}-rgb)`);
    style.setProperty(`--${slot}-hi`, `var(--${hue}-hi)`);
    const mx2 = S.colorblind || hue === 'gold' ? 'ice' : 'gold';
    const mx3 = S.colorblind || hue === 'orange' ? 'red' : 'orange';
    style.setProperty(`--${slot}-mx2`, `var(--${mx2})`);
    style.setProperty(`--${slot}-mx2-rgb`, `var(--${mx2}-rgb)`);
    style.setProperty(`--${slot}-mx3`, `var(--${mx3})`);
    style.setProperty(`--${slot}-mx3-rgb`, `var(--${mx3}-rgb)`);
  }

  const syncPick = (selector: string, mine: string, other: string): void => {
    appRoot().querySelectorAll<HTMLButtonElement>(selector + ' button').forEach((button) => {
      button.classList.toggle('on', button.dataset.h === mine);
      button.disabled = S.colorblind || button.dataset.h === other;
      if (S.colorblind) button.setAttribute('aria-describedby', 'colNote');
      else button.removeAttribute('aria-describedby');
    });
  };
  syncPick('#p1Pick', p1, p2);
  syncPick('#p2Pick', p2, p1);
  $('#colNote').hidden = !S.colorblind;
  setNumeralPresentation(S.numerals);
  menuPorts.renderSpells();
}

/* Leaving a game in progress ends it — offline games are quick by design. */
export function toMenu(): void {
  S.gen++;
  S.phase = 'over';
  stopTimer();
  clearTut();
  clearHints();
  menuPorts.cancelPass();
  hide('#ovPass');
  hide('#ovPractice');
  hide('#ovSettings');
  show('#ovStart');
}
