// Home, practice, settings, and lazy-online bindings. These controls compose
// existing UI/flow operations; no game rule lives here.
import { type Mode as RulesMode } from '../core/rules.ts';
import {
  SUPPORTED_LOCALES,
  effectiveLocale,
  setLanguageOverride,
  subscribeLocale,
  t,
} from '../i18n/index.ts';
import { captureUserPreferences } from '../preferences.ts';
import {
  DIFFS,
  DUELHUES,
  MODES,
  SEATS,
  S,
  TIMERS,
  oneOf,
  type Mode,
} from '../state.ts';
import { saveStats } from '../persist.ts';
import { newGame, passTap, startLocal } from '../flow/game.ts';
import { requestLeave, leavingForfeits } from '../flow/leave.ts';
import { syncSettingsUI, toMenu } from '../flow/menu.ts';
import { restartLocal } from '../flow/restart.ts';
import { coachTap } from '../flow/tutorial.ts';
import { disarm, renderSpells } from '../flow/spells.ts';
import { Sfx } from '../ui/audio.ts';
import { ask } from '../ui/askcard.ts';
import { $, hide, show } from '../ui/dom.ts';
import { bindEnd } from '../ui/endscreen.ts';
import { isNewcomer } from '../ui/firstrun.ts';
import { updateRecord } from '../ui/game/hud.ts';
import {
  MODE_PICKS,
  SPELL_PICKS,
  openEntry,
  openModes,
  openSpells,
  pickerButtons,
  pickInfo,
  type PickItem,
} from '../ui/library.ts';
import { loaderWait } from '../ui/loader.ts';
import { bindLearnPageBack } from '../ui/learn-page.ts';
import { tap } from '../ui/tap.ts';
import { isEmbed } from '../ui/embed.ts';
import { hueLabel } from '../ui/hue.ts';

function syncUserSettings(): void {
  if (isEmbed()) return;
  const snapshot = captureUserPreferences();
  void import('../online/preferences.ts').then(({ saveAccountPreferences }) =>
    saveAccountPreferences(snapshot));
}

function closestButton(event: Event): HTMLButtonElement | null {
  return event.target instanceof Element
    ? event.target.closest('button') as HTMLButtonElement | null
    : null;
}

function bindSegment(selector: string, key: string, apply: (value: string) => void, accountSetting = false): void {
  tap($(selector), (event) => {
    const button = closestButton(event);
    const value = button?.dataset[key];
    if (!button || button.disabled || value === undefined) return;
    apply(value);
    syncSettingsUI();
    updateRecord();
    saveStats();
    if (accountSetting) syncUserSettings();
    Sfx.unlock();
    Sfx.tap();
  });
}

function pickerRow(
  selector: string,
  items: PickItem[],
  read: () => string | number,
  write: (value: string) => void,
): () => void {
  const strip = $(selector);
  const info = $(selector + 'Info');
  const sync = (): void => {
    const current = String(read());
    strip.querySelectorAll('button').forEach((button) => {
      button.classList.toggle('on', (button as HTMLButtonElement).dataset.v === current);
    });
    info.textContent = pickInfo(items, current);
  };
  tap(strip, (event) => {
    const button = closestButton(event);
    const value = button?.dataset.v;
    if (!button || value === undefined) return;
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

function huePicker(selector: string, write: (hue: string) => void): void {
  const picker = $(selector);
  picker.innerHTML = DUELHUES.map((hue) =>
    `<button data-h="${hue.id}" style="--h:var(--${hue.id})" aria-label="${hueLabel(hue.id)}"></button>`).join('');
  const lock = document.createElement('div');
  lock.className = 'hues-lock';
  lock.id = `${picker.id}Lock`;
  lock.hidden = true;
  lock.setAttribute('role', 'note');
  lock.innerHTML = '<span class="hues-lock__icon" aria-hidden="true"><span class="hues-lock__shackle"></span></span><span class="hues-lock__copy"></span>';
  picker.append(lock);
  picker.setAttribute('aria-describedby', lock.id);
  tap(picker, (event) => {
    const button = closestButton(event);
    const hue = button?.dataset.h;
    if (!button || button.disabled || hue === undefined) return;
    write(hue);
    syncSettingsUI();
    updateRecord();
    saveStats();
    syncUserSettings();
    Sfx.unlock();
    Sfx.tap();
  });
}

function bindLanguagePicker(): void {
  const cycle = (step: -1 | 1): void => {
    const current = SUPPORTED_LOCALES.indexOf(effectiveLocale());
    const next = SUPPORTED_LOCALES[
      (current + step + SUPPORTED_LOCALES.length) % SUPPORTED_LOCALES.length
    ];
    S.localeOverride = next;
    setLanguageOverride(next);
    syncSettingsUI();
    updateRecord();
    saveStats();
    syncUserSettings();
    Sfx.unlock();
    Sfx.tap();
  };
  tap($('#languagePrevious'), () => cycle(-1));
  tap($('#languageNext'), () => cycle(1));
}

export function bindMenus(root: HTMLElement): void {
  tap($('#ovPass'), passTap);

  const openPractice = (mode: Mode): void => {
    S.mode = mode;
    saveStats();
    syncSettingsUI();
    hide('#ovStart');
    show('#ovPractice');
  };
  tap($('#btnVsCpu'), () => { Sfx.unlock(); Sfx.tap(); openPractice('cpu'); });
  tap($('#btnDuoHome'), () => { Sfx.unlock(); Sfx.tap(); openPractice('duo'); });

  tap($('#btnLearn'), () => {
    Sfx.unlock();
    Sfx.tap();
    $('#ovLearn').classList.toggle('fresh', isNewcomer());
    hide('#ovStart');
    show('#ovLearn');
  });
  tap($('#btnLearnBack'), () => { Sfx.tap(); hide('#ovLearn'); show('#ovStart'); });
  tap($('#btnLearnTut'), () => { Sfx.unlock(); Sfx.tap(); newGame({ tutorial: true }); });
  tap($('#btnLearnRules'), () => { Sfx.tap(); show('#ovRules'); });
  tap($('#btnLearnModes'), () => { Sfx.tap(); openModes(); });
  tap($('#btnLearnSpells'), () => { Sfx.tap(); openSpells(); });
  bindLearnPageBack('ovRules');
  tap($('#btnImprint'), () => { Sfx.tap(); show('#ovImprint'); });
  tap($('#btnPrivacy'), () => { Sfx.tap(); show('#ovPrivacy'); });
  for (const id of ['Imprint', 'Privacy']) {
    tap($('#btn' + id + 'Back'), () => { Sfx.tap(); hide('#ov' + id); });
  }
  tap($('#btnPracticeBack'), () => { Sfx.tap(); hide('#ovPractice'); show('#ovStart'); });

  tap($('#btnLeave'), async () => {
    Sfx.tap();
    const ranked = leavingForfeits();
    const tutorial = !ranked && !!S.tut;
    const leave = await ask({
      head: () => ranked ? t('game', 'leave.forfeitTitle') : t('game', 'leave.quitTitle'),
      body: () => ranked
        ? t('game', 'leave.forfeitBody')
        : t('game', 'leave.quitBody'),
      confirm: () => ranked
        ? t('game', 'leave.forfeit')
        : t('game', tutorial ? 'leave.quitTutorial' : 'leave.quit'),
      cancel: () => t('game', 'leave.keepPlaying'),
      alternate: !ranked && !tutorial
        ? { label: () => t('game', 'leave.restart'), run: restartLocal }
        : undefined,
    });
    if (leave) { requestLeave(); toMenu(); }
  });
  tap($('#btnSettingsBack'), () => { Sfx.tap(); hide('#ovSettings'); });
  tap($('#coach'), coachTap);
  root.addEventListener('pointerdown', coachTap, true);

  pickerRow('#modePick', MODE_PICKS, () => S.localMode, (value) => {
    /* MODE_PICKS is the validated source and includes RANDOM (-1), while the
       active rules mode excludes that pre-game promise. */
    if (MODE_PICKS.some((item) => item.v === value)) S.localMode = Number(value) as RulesMode;
  });
  pickerRow('#spellPick', SPELL_PICKS, () => S.spell, (value) => {
    S.spell = value;
    disarm();
    renderSpells();
  });

  bindSegment('#modeSeg', 'm', (value) => { S.mode = oneOf(MODES, value, S.mode); });
  bindSegment('#diffSeg', 'd', (value) => { S.diff = oneOf(DIFFS, value, S.diff); });
  bindSegment('#timerSeg', 't', (value) => { S.timer = oneOf(TIMERS, Number(value), S.timer); });
  bindSegment('#seatSeg', 'seat', (value) => { S.seat = oneOf(SEATS, value, S.seat); });
  bindSegment('#sndSeg', 's', (value) => { S.sound = value === '1'; }, true);
  bindSegment('#faceSeg', 'f', (value) => { S.numerals = value === 'nums'; }, true);

  huePicker('#p1Pick', (hue) => { S.p1Hue = hue; });
  huePicker('#p2Pick', (hue) => { S.p2Hue = hue; });
  bindLanguagePicker();
  syncSettingsUI();
  bindSegment('#cbSeg', 'b', (value) => { S.colorblind = value === '1'; }, true);
  bindSegment('#motionSeg', 'rm', (value) => { S.reducedMotion = value === '1'; }, true);

  tap($('#btnPlay'), () => { Sfx.unlock(); Sfx.tap(); void startLocal(); });
  bindEnd();
  tap($('#rec'), (event) => {
    const chip = event.target instanceof Element
      ? event.target.closest('.rchip[data-lib]') as HTMLElement | null
      : null;
    if (chip?.dataset.lib && chip.dataset.id
        && openEntry(chip.dataset.lib, chip.dataset.id)) Sfx.tap();
  });

  let onlineBusy = false;
  const goOnline = (view: 'play' | 'board' | 'account'): void => {
    Sfx.unlock();
    Sfx.tap();
    if (onlineBusy) return;
    onlineBusy = true;
    const loading = $('#ovLoad');
    if (!loading.firstChild) loading.appendChild(loaderWait(56));
    show('#ovLoad');
    import('../online/ui.ts').then((online) => online.openOnline(view, {
      startTutorial: () => newGame({ tutorial: true }),
    }))
      .finally(() => { onlineBusy = false; hide('#ovLoad'); });
  };
  tap($('#btnOnline'), () => goOnline('play'));
  tap($('#btnBoardHome'), () => goOnline('board'));
  tap($('#btnSettingsHome'), () => { Sfx.unlock(); Sfx.tap(); show('#ovSettings'); });
  tap($('#homeChip'), () => goOnline('account'));
}
