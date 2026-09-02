// The title screen and settings panel: what they show. Mid-game resume was
// removed by design; leaving an offline game simply ends it. The composition
// root injects the two flow operations this screen needs.
import { S } from '../state.ts';
import { $, show, hide } from '../ui/dom.ts';
import { stopTimer } from './timer.ts';
import { clearTut } from './tutorial.ts';
import { clearHints } from '../ui/game/hints.ts';
import { setNumeralPresentation, setOpponentTurnPresentation } from '../ui/game/root-state.ts';
import { appRoot } from '../ui/embed.ts';
import { paintHuePair } from '../ui/hues.ts';
import { REDUCED, setReducedMotion } from '../ui/fx.ts';
import { effectiveLocale, localeSelfName, t } from '../i18n/index.ts';
import { hueLabel } from '../ui/hue.ts';
import {
  profileAppIconAvailable,
  profileAppIconEnabled,
} from '../native/app-icon.ts';

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
  $('#btnPlay').textContent = duo
    ? t('game', 'practice.playDuel')
    : t('game', 'practice.playVersusAi');
  segOn('#modeSeg', 'm', S.mode);
  segOn('#diffSeg', 'd', S.diff);
  segOn('#timerSeg', 't', String(S.timer));
  segOn('#seatSeg', 'seat', S.seat);
  segOn('#sndSeg', 's', S.sound ? '1' : '0');
  $('#appIconCard').hidden = !profileAppIconAvailable();
  segOn('#appIconSeg', 'ai', profileAppIconEnabled() ? '1' : '0');
  segOn('#faceSeg', 'f', S.numerals ? 'nums' : 'pips');
  segOn('#cbSeg', 'b', S.colorblind ? '1' : '0');
  setReducedMotion(S.reducedMotion);
  segOn('#motionSeg', 'rm', REDUCED ? '1' : '0');
  $('#languageLabel').textContent = t('settings', 'language');
  $('#languagePrevious').setAttribute('aria-label', t('settings', 'previousLanguage'));
  $('#languageNext').setAttribute('aria-label', t('settings', 'nextLanguage'));
  $('#languageValue').textContent = localeSelfName(effectiveLocale());

  /* Colour blind mode overrides the displayed pair without changing the
     stored picks; paintHuePair owns that substitution and the multiplier
     fallbacks, because a ranked table paints the same pair swapped. */
  const p1 = S.colorblind ? 'cy' : S.p1Hue;
  const p2 = S.colorblind ? 'gold' : S.p2Hue;
  const style = appRoot().style;
  style.setProperty('--wdc', `var(--${S.colorblind ? 'red' : 'wdc-mint'})`);
  paintHuePair(style, [S.p1Hue, S.p2Hue], S.colorblind);

  const syncPick = (selector: string, mine: string, other: string): void => {
    const picker = $(selector);
    picker.querySelectorAll<HTMLButtonElement>('button[data-h]').forEach((button) => {
      button.classList.toggle('on', button.dataset.h === mine);
      button.disabled = S.colorblind || button.dataset.h === other;
    });
    picker.classList.toggle('hues--locked', S.colorblind);
    picker.setAttribute('aria-disabled', String(S.colorblind));
    const lock = picker.querySelector<HTMLElement>('.hues-lock');
    if (lock) {
      lock.hidden = !S.colorblind;
      const copy = lock.querySelector<HTMLElement>('.hues-lock__copy');
      if (copy) copy.textContent = t('settings', 'colourBlindPalette');
    }
  };
  syncPick('#p1Pick', p1, p2);
  syncPick('#p2Pick', p2, p1);
  appRoot().querySelectorAll<HTMLButtonElement>('.hues button[data-h]').forEach((button) => {
    if (button.dataset.h) button.setAttribute('aria-label', hueLabel(button.dataset.h));
  });
  setNumeralPresentation(S.numerals);
  menuPorts.renderSpells();
}

/* Leaving a game in progress ends it — offline games are quick by design. */
export function toMenu(): void {
  S.gen++;
  S.phase = 'over';
  setOpponentTurnPresentation(false);
  stopTimer();
  clearTut();
  clearHints();
  menuPorts.cancelPass();
  hide('#ovPass');
  hide('#ovPractice');
  hide('#ovSettings');
  show('#ovStart');
}
