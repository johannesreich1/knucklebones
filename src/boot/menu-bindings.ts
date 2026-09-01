// Home, practice, settings, and lazy-online bindings. These controls compose
// existing UI/flow operations; no game rule lives here.
import { type Mode as RulesMode } from '../core/rules.ts';
import {
  SUPPORTED_LOCALES,
  effectiveLocale,
  setLanguageOverride,
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
import {
  RUNE_TRIAL_PICK,
  localPoolAccess,
  modePickAvailable,
  runePickAvailable,
} from '../local-options.ts';
import {
  collectedRuneIds,
  confirmedRankedPoolTier,
  subscribeRuneCollection,
} from '../rune-collection-cache.ts';
import { newGame, startLocal } from '../flow/game.ts';
import { requestLeave, leavingForfeits } from '../flow/leave.ts';
import { syncSettingsUI, toMenu } from '../flow/menu.ts';
import { passTap } from '../flow/pass-card.ts';
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
} from '../ui/library.ts';
import { bindLearnPageBack } from '../ui/learn-page.ts';
import { tap } from '../ui/tap.ts';
import { isEmbed } from '../ui/embed.ts';
import { hueLabel } from '../ui/hue.ts';
import { isProfileAvatar } from '../profile-avatar.ts';
import { readProfileCache } from '../profile-cache.ts';
import { setProfileAppIconEnabled } from '../native/app-icon.ts';
import { bindOnlineDoors } from './online-door.ts';
import { bindPickerRow, eventButton } from './picker-row.ts';

function syncUserSettings(): void {
  if (isEmbed()) return;
  const snapshot = captureUserPreferences();
  void import('../online/preferences.ts').then(({ saveAccountPreferences }) =>
    saveAccountPreferences(snapshot));
}

function bindSegment(selector: string, key: string, apply: (value: string) => void, accountSetting = false): void {
  tap($(selector), (event) => {
    const button = eventButton(event);
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
    const button = eventButton(event);
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
  /* The away warning is an acknowledgement, not a gate: dismissing it does not
     place a die, and the turn clock underneath keeps running. Bound here with
     the other static overlays so boot never has to reach into the lazy-loaded
     online chunk; the match driver only decides when to show it. */
  tap($('#ovAway'), () => { Sfx.tap(); hide('#ovAway'); });

  let syncModePicker = (): void => undefined;
  let syncSpellPicker = (): void => undefined;
  /* The one roster a local setup may draw from, rebuilt on demand: the cache
     carries both the collection and the confirmed tier, and subscribeRuneCollection
     below re-syncs the rows the moment either changes. */
  const localAccess = (mode: Mode = S.mode) =>
    localPoolAccess(mode, collectedRuneIds(), confirmedRankedPoolTier());
  const normalizeLocalChoice = (mode: Mode): void => {
    const collected = collectedRuneIds();
    const choice = S.localChoices[mode];
    /* CLASSIC is in every tier, so a pick the ladder has taken back always has
       somewhere to land. */
    if (!modePickAvailable(choice.localMode, localAccess(mode))) choice.localMode = 0;
    if (!runePickAvailable(mode, choice.spell, collected)) choice.spell = '';
    S.localMode = choice.localMode;
    S.spell = choice.spell;
  };
  const activateLocalChoice = (mode: Mode): void => {
    S.mode = mode;
    normalizeLocalChoice(mode);
  };
  const syncPracticePicks = (): void => {
    syncModePicker();
    syncSpellPicker();
    const trial = S.localMode === RUNE_TRIAL_PICK;
    const card = $('#spellCard');
    card.classList.toggle('choice-card--locked', trial);
    card.setAttribute('aria-disabled', String(trial));
    const lock = $('#spellPickLock');
    lock.hidden = !trial;
    if (trial) {
      const copy = t('game', 'runeTrial.setupOwnChoice');
      $('#spellPickInfo').textContent = copy;
      $('#spellPickLockCopy').textContent = copy;
    }
  };

  const openPractice = (mode: Mode): void => {
    activateLocalChoice(mode);
    saveStats();
    syncSettingsUI();
    syncPracticePicks();
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
      /* A touch activation does not consistently focus its button. Name the
         actual opener so cancellation, backdrop, Escape, and a short drag all
         return keyboard/screen-reader position to the in-game leave control. */
      restoreFocus: $('#btnLeave'),
      alternate: !ranked && !tutorial
        ? { label: () => t('game', 'leave.restart'), run: restartLocal }
        : undefined,
    });
    /* An interceptor that returns true has HANDLED the departure — ranked
       keeps the player on the board so the settled forfeit can open the same
       result screen the winner gets. Only an unhandled quit navigates from
       here, which is the contract flow/leave has always documented. */
    if (leave && !requestLeave()) toMenu();
  });
  tap($('#btnSettingsBack'), () => { Sfx.tap(); hide('#ovSettings'); });
  tap($('#coach'), coachTap);
  root.addEventListener('pointerdown', coachTap, true);

  syncModePicker = bindPickerRow('#modePick', MODE_PICKS, () => S.localMode, (value) => {
    /* The validated picks include setup promises that are not rules modes. */
    if (MODE_PICKS.some((item) => item.v === value)) {
      S.localMode = Number(value) as RulesMode;
      S.localChoices[S.mode].localMode = S.localMode;
      syncPracticePicks();
    }
  }, (item) => {
    const selected = Number(item.v);
    const enabled = modePickAvailable(selected, localAccess());
    if (enabled) return { enabled };
    /* An ordinary mode is held by the ladder alone; only Rune Ritual can also
       be waiting on a collection, so only it needs the two-reason split. */
    if (selected !== RUNE_TRIAL_PICK) return { enabled, reason: t('game', 'modeLock.reachBone') };
    const collected = collectedRuneIds();
    const reachedTrial = confirmedRankedPoolTier() === 'ivory' || collected.length > 0;
    return { enabled, reason: t('game', reachedTrial
      ? 'runeTrial.lockCollectThree'
      : 'runeTrial.lockTrialReachIvory') };
  });
  syncSpellPicker = bindPickerRow('#spellPick', SPELL_PICKS, () => S.spell, (value) => {
    S.spell = value;
    S.localChoices[S.mode].spell = value;
    disarm();
    renderSpells();
  }, (item) => {
    if (S.localMode === RUNE_TRIAL_PICK) {
      return { enabled: false, reason: t('game', 'runeTrial.setupOwnChoice') };
    }
    const collected = collectedRuneIds();
    const enabled = runePickAvailable(S.mode, item.v, collected);
    const reachedTrial = confirmedRankedPoolTier() === 'ivory' || collected.length > 0;
    const random = item.v === 'random' || item.v === 'random2';
    const reason = enabled ? undefined : random
      ? t('game', 'runeTrial.lockCollectTwo')
      : !reachedTrial
        ? t('game', 'runeTrial.lockReachIvory')
        : t('game', 'runeTrial.lockWinRune');
    return { enabled, reason };
  });

  bindSegment('#modeSeg', 'm', (value) => {
    activateLocalChoice(oneOf(MODES, value, S.mode));
    syncPracticePicks();
  });
  bindSegment('#diffSeg', 'd', (value) => { S.diff = oneOf(DIFFS, value, S.diff); });
  bindSegment('#timerSeg', 't', (value) => { S.timer = oneOf(TIMERS, Number(value), S.timer); });
  bindSegment('#seatSeg', 'seat', (value) => { S.seat = oneOf(SEATS, value, S.seat); });
  bindSegment('#sndSeg', 's', (value) => { S.sound = value === '1'; }, true);
  bindSegment('#appIconSeg', 'ai', (value) => {
    const cached = readProfileCache();
    const avatar = cached?.accountId && isProfileAvatar(cached.avatar)
      ? cached.avatar : undefined;
    void setProfileAppIconEnabled(value === '1', avatar);
  });
  bindSegment('#faceSeg', 'f', (value) => { S.numerals = value === 'nums'; }, true);

  huePicker('#p1Pick', (hue) => { S.p1Hue = hue; });
  huePicker('#p2Pick', (hue) => { S.p2Hue = hue; });
  bindLanguagePicker();
  syncSettingsUI();
  syncPracticePicks();
  subscribeRuneCollection(() => { normalizeLocalChoice(S.mode); syncPracticePicks(); saveStats(); });
  bindSegment('#cbSeg', 'b', (value) => { S.colorblind = value === '1'; }, true);
  bindSegment('#motionSeg', 'rm', (value) => { S.reducedMotion = value === '1'; }, true);

  tap($('#btnPlay'), () => { Sfx.unlock(); Sfx.tap(); void startLocal(); });
  bindEnd();
  const openBadgeEntry = (event: Event): void => {
    const chip = event.target instanceof Element
      ? event.target.closest('.rchip[data-lib]') as HTMLElement | null
      : null;
    if (chip?.dataset.lib && chip.dataset.id
        && openEntry(chip.dataset.lib, chip.dataset.id)) Sfx.tap();
  };
  /* Asymmetric rune buttons move between these three stable hosts as the
     viewport and seat ownership change; the one delegated action follows. */
  ['#rec', '#runeTagTop', '#runeTagBot'].forEach((selector) => {
    tap($(selector), openBadgeEntry);
  });

  bindOnlineDoors({ startTutorial: () => newGame({ tutorial: true }) });
  tap($('#btnSettingsHome'), () => { Sfx.unlock(); Sfx.tap(); show('#ovSettings'); });
}
