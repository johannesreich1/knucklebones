// Locale-owned reveal contracts shared by the broad rune-deal scenarios.
// Keep registry traversal, live repaint observations, and translated-copy
// expectations here so reveal stories do not encode a particular locale order.
import { LOCALE_REGISTRY, RESOURCES } from '../../../src/i18n/index.ts';

const LOCALE_IDS = LOCALE_REGISTRY.map(({ id }) => id);

export const gameCopyFor = (locale) => RESOURCES[locale].game;

export async function observeLocale(page) {
  return page.$eval('html', (root) => root.dataset.locale);
}

export function localeCycleFrom(initialLocale, transitions) {
  const initialIndex = LOCALE_IDS.indexOf(initialLocale);
  if (initialIndex < 0) throw new TypeError(`Unknown initial locale: ${initialLocale}`);
  return Array.from({ length: transitions + 1 }, (_value, offset) =>
    LOCALE_IDS[(initialIndex + offset) % LOCALE_IDS.length]);
}

export async function restoreLocale(page, targetLocale) {
  return page.evaluate(({ expectedLocale, localeIds }) => {
    for (let clicks = 0;
      document.documentElement.dataset.locale !== expectedLocale && clicks < localeIds.length;
      clicks++) {
      document.getElementById('languageNext').click();
    }
    if (document.documentElement.dataset.locale !== expectedLocale) {
      throw new Error(`Could not restore reveal locale ${expectedLocale}`);
    }
    return document.documentElement.dataset.locale;
  }, { expectedLocale: targetLocale, localeIds: LOCALE_IDS });
}

export async function repaintRandomTwoOwner(page, initialLocale) {
  return page.evaluate(({ expectedInitialLocale, localeIds }) => {
    const owner = document.querySelector('#wheelSettled .wowner');
    const activeOwner = document.getElementById('wheelOwner');
    const titleCopy = document.querySelector('#wheelTitle .wtitlecopy');
    const pill = document.querySelector('#wheelSettled .wpill');
    const stage = document.getElementById('wheelStage');
    const moving = [...stage.querySelectorAll('*')]
      .flatMap((node) => node.getAnimations())
      .find((animation) => animation.playState === 'running') ?? null;
    const state = () => JSON.stringify({
      gen: window.__kb.S.gen,
      scoring: window.__kb.S.scoring,
      spellCharges: window.__kb.S.spellCharges,
      boards: window.__kb.S.boards,
    });
    const before = {
      owner: owner.textContent.trim(), activeOwner: activeOwner.textContent.trim(),
      pill: pill.textContent.trim(), title: titleCopy.textContent.trim(),
    };
    const stateBefore = state();
    const beforeLocale = document.documentElement.dataset.locale;
    document.getElementById('languageNext').click();
    const after = {
      owner: owner.textContent.trim(), activeOwner: activeOwner.textContent.trim(),
      pill: pill.textContent.trim(), title: titleCopy.textContent.trim(),
    };
    const repaintedLocale = document.documentElement.dataset.locale;
    const sameOwner = document.querySelector('#wheelSettled .wowner') === owner;
    const sameActiveOwner = document.getElementById('wheelOwner') === activeOwner;
    const sameTitleCopy = document.querySelector('#wheelTitle .wtitlecopy') === titleCopy;
    const samePill = document.querySelector('#wheelSettled .wpill') === pill;
    const sameStage = document.getElementById('wheelStage') === stage;
    const sameAnimation = !moving || [...stage.querySelectorAll('*')]
      .flatMap((node) => node.getAnimations()).includes(moving);
    for (let clicks = 0;
      document.documentElement.dataset.locale !== expectedInitialLocale && clicks < localeIds.length;
      clicks++) {
      document.getElementById('languageNext').click();
    }
    if (document.documentElement.dataset.locale !== expectedInitialLocale) {
      throw new Error(`Could not restore reveal locale ${expectedInitialLocale}`);
    }
    const restored = {
      owner: owner.textContent.trim(),
      activeOwner: activeOwner.textContent.trim(),
      title: titleCopy.textContent.trim(),
    };
    return {
      before, after, restored, beforeLocale, repaintedLocale,
      restoredLocale: document.documentElement.dataset.locale,
      hadRunningAnimation: !!moving,
      sameOwner, sameActiveOwner, sameTitleCopy, samePill, sameStage, sameAnimation,
      stateBefore, stateAfter: state(),
    };
  }, { expectedInitialLocale: initialLocale, localeIds: LOCALE_IDS });
}

export function verifyRandomTwoLocaleRepaint(localizedOwner, beforeLocale, afterLocale, check) {
  const beforeGame = gameCopyFor(beforeLocale);
  const afterGame = gameCopyFor(afterLocale);
  check(localizedOwner.beforeLocale === beforeLocale
      && localizedOwner.repaintedLocale === afterLocale
      && localizedOwner.restoredLocale === beforeLocale
      && localizedOwner.before.owner === beforeGame.player.you
      && localizedOwner.before.activeOwner === beforeGame.player.ai
      && localizedOwner.before.title === beforeGame.reveal.runeFor
      && localizedOwner.after.owner === afterGame.player.you
      && localizedOwner.after.activeOwner === afterGame.player.ai
      && localizedOwner.after.title === afterGame.reveal.runeFor
      && localizedOwner.restored.owner === localizedOwner.before.owner
      && localizedOwner.restored.activeOwner === localizedOwner.before.activeOwner
      && localizedOwner.restored.title === localizedOwner.before.title
      && localizedOwner.hadRunningAnimation
      && localizedOwner.sameOwner && localizedOwner.sameActiveOwner
      && localizedOwner.sameTitleCopy && localizedOwner.samePill
      && localizedOwner.sameStage && localizedOwner.sameAnimation
      && localizedOwner.stateAfter === localizedOwner.stateBefore,
  'locale repaint rebuilt, skipped, or restarted the owner eyebrow during the second shuffle',
  localizedOwner);
}

export function verifyDealLocaleRepaint(both, initialLocale, check) {
  const [dealLocale, modeLocale, runeLocale, holdLocale] = both.localeRepaint.cycle;
  const modeLocaleCopy = gameCopyFor(modeLocale);
  const runeCopy = gameCopyFor(runeLocale);
  const holdCopy = gameCopyFor(holdLocale);
  const repaintedRune = both.localeRepaint.rune.rune;
  const heldRune = both.localeRepaint.hold.rune;
  const heldMode = Object.entries(runeCopy.modes).find(([_id, copy]) =>
    copy.name === both.turned.settled[0]?.name
      && copy.blurb === both.turned.settled[0]?.rule)?.[0];
  const heldModeBefore = heldMode ? runeCopy.modes[heldMode] : null;
  const heldModeAfter = heldMode ? holdCopy.modes[heldMode] : null;

  check(both.localeRepaint.mode.locale === modeLocale
      && both.localeRepaint.mode.title === modeLocaleCopy.reveal.gameMode
      && both.localeRepaint.mode.sameOverlay && both.localeRepaint.mode.sameStage
      && both.localeRepaint.mode.sameDial && both.localeRepaint.mode.sameComet
      && both.localeRepaint.mode.sameAnimation
      && both.localeRepaint.mode.stateAfter === both.localeRepaint.mode.stateBefore,
  'changing locale rebuilt or restarted the live mode dial', both.localeRepaint.mode);
  check(both.localeRepaint.rune.locale === runeLocale
      && both.localeRepaint.rune.beforeTitle === modeLocaleCopy.reveal.matchRune
      && both.localeRepaint.rune.title === runeCopy.reveal.matchRune
      && both.localeRepaint.rune.before === modeLocaleCopy.runes[repaintedRune].name
      && both.localeRepaint.rune.label === runeCopy.runes[repaintedRune].name
      && both.localeRepaint.rune.sameStage && both.localeRepaint.rune.sameCard
      && both.localeRepaint.rune.sameLabel && both.localeRepaint.rune.sameDeckCard
      && both.localeRepaint.rune.sameAnimation
      && both.localeRepaint.rune.stateAfter === both.localeRepaint.rune.stateBefore,
  'changing locale rebuilt/restarted the rune deal or left its card label stale',
  both.localeRepaint.rune);
  check(dealLocale === initialLocale
      && both.localeRepaint.hold.locale === holdLocale
      && both.localeRepaint.restoredLocale === dealLocale
      && both.localeRepaint.hold.before.name === runeCopy.runes[heldRune].name
      && both.localeRepaint.hold.after.name === holdCopy.runes[heldRune].name
      && both.localeRepaint.hold.before.blurb === runeCopy.runes[heldRune].blurb
      && both.localeRepaint.hold.after.blurb === holdCopy.runes[heldRune].blurb
      && heldModeBefore != null && heldModeAfter != null
      && both.localeRepaint.hold.before.settled.includes(heldModeBefore.name)
      && both.localeRepaint.hold.before.settled.includes(heldModeBefore.blurb)
      && both.localeRepaint.hold.after.settled.includes(heldModeAfter.name)
      && both.localeRepaint.hold.after.settled.includes(heldModeAfter.blurb)
      && both.localeRepaint.hold.before.hint === runeCopy.reveal.tapReady
      && both.localeRepaint.hold.after.hint === holdCopy.reveal.tapReady
      && both.localeRepaint.hold.sameOverlay && both.localeRepaint.hold.sameStage
      && both.localeRepaint.hold.sameCard && both.localeRepaint.hold.sameLabel
      && both.localeRepaint.hold.sameName && both.localeRepaint.hold.sameBlurb
      && both.localeRepaint.hold.sameSettled
      && both.localeRepaint.hold.stateAfter === both.localeRepaint.hold.stateBefore,
  'holding reveal did not repaint every answer in place or changed game state',
  both.localeRepaint.hold);
}
