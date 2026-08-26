import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { LOCALE_REGISTRY } from '../../../../src/i18n/locale.ts';
import { checkReachableTargets, checkSurface, frame,
  inspectSurface as inspect } from '../harness/layout-inspection.mjs';
import { LOCALE_IDS as LOCALES, chooseLocale } from '../harness/locale-control.mjs';
import { requiredHomeTargets, SURFACE_SIZES,
  waitForSurface } from '../harness/surface-readiness.mjs';
import {
  prepareCollectedRandomTwoReveal,
  restoreCollectedRunes,
} from '../../support/random-two-reveal.mjs';

const FIRST_REPAINT_LOCALE = LOCALE_REGISTRY[1];
const SECOND_REPAINT_LOCALE = LOCALE_REGISTRY[2];

async function openSettings(page) {
  await page.evaluate(() => window.__kb.goHome());
  await waitForSurface(page, '#ovStart', '#btnSettingsHome');
  await page.click('#btnSettingsHome');
  await waitForSurface(page, '#ovSettings', '#languagePicker');
  await page.locator('#languagePicker').scrollIntoViewIfNeeded();
  await frame(page);
}

async function inspectLearningSurfaces(page, check, label) {
  await page.evaluate(() => window.__kb.goHome());
  await waitForSurface(page, '#ovStart', '#btnLearn');
  const home = await inspect(page, '#ovStart', [
    '.eyebrow', '.sub2', '#homeChip', '#btnOnline', '#btnBoardHome',
    '#btnSettingsHome', '.quiet .cap', '#btnVsCpu', '#btnDuoHome', '#btnLearn',
  ]);
  await page.click('#btnLearn');
  await waitForSurface(page, '#ovLearn', '#btnLearnRules');
  const hub = await inspect(page, '#ovLearn .pbody', [
    '.learnrow', '.lname', '.lblurb',
  ]);
  await checkReachableTargets(page, check, `learn-hub-${label}`,
    ['#btnLearnTut', '#btnLearnRules', '#btnLearnModes', '#btnLearnSpells']);

  await page.click('#btnLearnRules');
  await waitForSurface(page, '#ovRules', '.rules h3');
  const rules = await inspect(page, '#ovRules .pbody', [
    '.rules h3', '.rules p',
  ]);
  await page.click('[data-learn-back="ovRules"]');
  await frame(page);

  await page.click('#btnLearnModes');
  await waitForSurface(page, '#ovModes', '.modecard');
  const modes = await inspect(page, '#ovModes .pbody', [
    '.modecard',
    '.mcname', '.mcblurb', '.mcdetail',
  ]);
  await page.click('[data-learn-back="ovModes"]');
  await frame(page);

  await page.click('#btnLearnSpells');
  await waitForSurface(page, '#ovSpells', '.modecard');
  const runes = await inspect(page, '#ovSpells .pbody', [
    '.modecard',
    '.mcname', '.mcblurb', '.mcdetail',
  ]);
  await page.click('[data-learn-back="ovSpells"]');
  await frame(page);
  await page.click('#btnLearnBack');
  await waitForSurface(page, '#ovStart', '#btnLearn');
  return { home, hub, rules, modes, runes };
}

async function inspectSetup(page) {
  await page.click('#btnSettingsBack');
  await page.evaluate(() => { window.__kb.openPractice(); });
  await page.click('#modeSeg button[data-m="duo"]');
  await page.locator('#modePick').scrollIntoViewIfNeeded();
  await page.locator('#modePick').evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'center' }));
  await frame(page);
  const mode = await inspect(page, '#modePick', ['button']);
  const modeInfo = [];
  for (let index = 0; index < await page.locator('#modePick button').count(); index++) {
    await page.locator('#modePick button').nth(index).click();
    await frame(page);
    modeInfo.push(await inspect(page, '#modePickInfo', [':scope']));
  }
  await page.locator('#spellPick').scrollIntoViewIfNeeded();
  await page.locator('#spellPick').evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'center' }));
  await frame(page);
  const rune = await inspect(page, '#spellPick', ['button']);
  const runeInfo = [];
  for (let index = 0; index < await page.locator('#spellPick button').count(); index++) {
    await page.locator('#spellPick button').nth(index).click();
    await frame(page);
    runeInfo.push(await inspect(page, '#spellPickInfo', [':scope']));
  }
  return { mode, modeInfo, rune, runeInfo };
}

async function showTutorial(page) {
  await page.evaluate(() => {
    window.__kb.newGame({ tutorial: true });
    window.__kb.S.gen++; // hold the localized welcome prompt and cancel its roll
  });
  await page.waitForFunction(() => !document.getElementById('coach')?.hidden);
  await frame(page);
  return inspect(page, '#coach', ['#coachMsg', '#coachHint']);
}

async function showPassPhone(page) {
  await page.evaluate(() => {
    const game = window.__kb;
    game.S.mode = 'duo';
    game.S.seat = 'pass';
    game.S.bottom = 1;
    game.applySides();
    const coach = document.getElementById('coach');
    if (coach) coach.hidden = true;
    const who = document.getElementById('passWho');
    if (who) who.textContent = game.nameOf(0);
    document.getElementById('ovPass')?.classList.add('on');
  });
  await waitForSurface(page, '#ovPass', '#passWho');
  const surface = await inspect(page, '#ovPass', [
    '#passWho', '.hint', '.mini', '.tapline',
  ]);
  await page.evaluate(() => document.getElementById('ovPass')?.classList.remove('on'));
  await frame(page);
  return surface;
}

async function showResult(page) {
  await page.evaluate(async () => {
    const game = window.__kb;
    const state = game.S;
    state.mode = 'duo';
    state.seat = 'face';
    state.starter = 1;
    state.timer = 0;
    game.newGame();
    state.gen++; // cancel the delayed opening roll; this test places the last die
    state.turn = 1;
    state.bottom = 1;
    state.phase = 'choose';
    state.busy = false;
    state.die = 6;
    state.boards[0] = [[1], [2], [3]];
    state.boards[1] = [[6, 6, 6], [5, 5, 5], [4, 4]];
    game.applySides();
    game.renderAll(false);
    game.setStageDie(6);
    await game.place(1, 2);
  });
  await page.waitForSelector('#ovEnd.on', { timeout: 8000 });
  await frame(page);
  return inspect(page, '#ovEnd', [
    '#endTitle', '#endSub', '#endYouLbl', '#endCpuLbl', '#endMeta',
    '#btnAgain:not([hidden])', '#btnEndQuiet:not([hidden])', '#btnShare:not([hidden])',
  ]);
}

async function inspectReveal(page) {
  /* CPU practice exposes only collected runes. Lend exactly two: enough for
     RANDOM x2, while Rune Trial correctly remains unavailable. */
  const previousRuneCache = await prepareCollectedRandomTwoReveal(page);
  /* Playwright sends the bound pointerdown/up pair here, so the action does
     not depend on tap()'s guarded click-only fallback. */
  await page.click('#btnPlay');
  await page.evaluate(() => {
    Math.random = window.__kbTestOriginalRandom;
    delete window.__kbTestOriginalRandom;
  });
  /* Reduced motion lands the dial synchronously, so `hunting` can correctly
     disappear before Playwright's first observation; the landed dial remains. */
  await page.waitForSelector('#ovWheel.on .dial', { timeout: 8000 });
  await page.waitForTimeout(80);
  await frame(page);
  const wheel = await inspect(page, '#ovWheel', ['#wheelTitle', '#wheelStage', '.dial']);
  await page.waitForSelector('#ovWheel.dealing .rdealt.up', { timeout: 15000 });
  /* Reduced motion deliberately retains the 60ms stage handoff transition.
     Measure the readable resting frame, not its scaled first paint. */
  await page.waitForTimeout(80);
  await frame(page);
  const deal = await inspect(page, '#ovWheel', [
    '#wheelTitle', '#wheelTitle .wtitlecopy', '#wheelOwner',
    '.rfelt', '.rdealt', '.rface .rlbl', '#wheelName', '#wheelBlurb',
  ]);
  await page.waitForSelector('#ovWheel.holding', { timeout: 15000 });
  await page.waitForTimeout(80);
  await frame(page);
  const held = await inspect(page, '#ovWheel', [
    '#wheelTitle', '#wheelTitle .wtitlecopy', '#wheelOwner',
    '#wheelSettled .wowner', '#wheelSettled .wpill', '#wheelSettled .wblurb',
    '#wheelName', '#wheelBlurb',
    '#wheelHold b', '#wheelHold span',
  ]);
  await page.locator('#ovWheel').dispatchEvent('pointerdown');
  await page.waitForFunction(() => !document.getElementById('ovWheel')?.classList.contains('on'));
  await page.evaluate(() => { window.__kb.S.gen++; });
  await restoreCollectedRunes(page, previousRuneCache);
  return { wheel, deal, held };
}

export async function runConstrainedSurfaceScenarios(suite) {
  const { standaloneUrl, out, check, attachErrors, localeContext } = suite;
  out.localeSurfaces = {};
  const context = await localeContext(['en-US'], { viewport: { width: 320, height: 568 } });
  const page = attachErrors(await context.newPage(), 'locale-surfaces');
  await page.goto(standaloneUrl);
  await page.waitForFunction(() => window.__kb);

  /* Copy feedback owns a full 1.5s state, not a one-off English text write.
     A locale repaint during that window must translate the active state and
     let the original timer restore Share in the new locale. */
  await chooseLocale(page, 'en');
  const revealOwners = Object.fromEntries(LOCALES.map((locale) => [locale, {
    prompt: RESOURCES[locale].game.reveal.runeFor,
    first: RESOURCES[locale].game.player.you,
    second: RESOURCES[locale].game.player.ai,
  }]));
  await page.evaluate(() => {
    const game = window.__kb;
    game.showEnd({
      outcome: 'win',
      title: 'VICTORY',
      sub: 'Test result',
      you: { score: 1, label: 'YOU' },
      them: { score: 0, label: 'AI' },
      quiet: { label: 'Close', run: game.closeEnd },
      share: 'Test result',
    });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    });
    const share = document.getElementById('btnShare');
    window.__localeShareButton = share;
    share?.setAttribute('data-locale-sentinel', 'kept');
  });
  await page.waitForSelector('#ovEnd.on');
  await page.click('#btnShare');
  await page.waitForFunction((copied) =>
    document.getElementById('btnShare')?.textContent?.trim() === copied,
  RESOURCES.en.game.result.copied);
  await page.waitForTimeout(700); // clear tap()'s native-click guard while feedback is still active
  await page.evaluate(() => document.getElementById('languageNext')?.click());
  await page.waitForFunction(({ locale, languageTag, copied }) =>
    document.documentElement.dataset.locale === locale
      && document.documentElement.lang === languageTag
      && document.getElementById('btnShare')?.textContent?.trim() === copied,
  { locale: FIRST_REPAINT_LOCALE.id,
    languageTag: FIRST_REPAINT_LOCALE.languageTag,
    copied: RESOURCES[FIRST_REPAINT_LOCALE.id].game.result.copied });
  out.localeShareFeedback = await page.evaluate(() => {
    const share = document.getElementById('btnShare');
    return {
      active: share?.textContent?.trim(),
      sameButton: share === window.__localeShareButton,
      sentinel: share?.getAttribute('data-locale-sentinel'),
    };
  });
  await page.waitForFunction((share) => document.getElementById('btnShare')?.textContent?.trim()
    === share, RESOURCES[FIRST_REPAINT_LOCALE.id].game.result.share, { timeout: 3000 });
  out.localeShareFeedback.restored = await page.$eval('#btnShare', (button) => button.textContent?.trim());
  check(out.localeShareFeedback.active === RESOURCES[FIRST_REPAINT_LOCALE.id].game.result.copied
    && out.localeShareFeedback.restored === RESOURCES[FIRST_REPAINT_LOCALE.id].game.result.share
    && out.localeShareFeedback.sameButton && out.localeShareFeedback.sentinel === 'kept',
  'result copy feedback did not survive, translate, and expire across a locale repaint',
  out.localeShareFeedback);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  });
  await page.click('#btnShare');
  await page.waitForFunction((copyFailed) =>
    document.getElementById('btnShare')?.textContent?.trim() === copyFailed,
  RESOURCES[FIRST_REPAINT_LOCALE.id].game.result.copyFailed);
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById('languageNext')?.click());
  await page.waitForFunction(({ locale, languageTag, copyFailed }) =>
    document.documentElement.dataset.locale === locale
      && document.documentElement.lang === languageTag
      && document.getElementById('btnShare')?.textContent?.trim() === copyFailed,
  { locale: SECOND_REPAINT_LOCALE.id,
    languageTag: SECOND_REPAINT_LOCALE.languageTag,
    copyFailed: RESOURCES[SECOND_REPAINT_LOCALE.id].game.result.copyFailed });
  out.localeShareFeedback.failure = await page.$eval('#btnShare', (button) => button.textContent?.trim());
  await page.waitForFunction((share) => document.getElementById('btnShare')?.textContent?.trim()
    === share, RESOURCES[SECOND_REPAINT_LOCALE.id].game.result.share, { timeout: 3000 });
  out.localeShareFeedback.failureRestored = await page.$eval(
    '#btnShare', (button) => button.textContent?.trim());
  check(out.localeShareFeedback.failure === RESOURCES[SECOND_REPAINT_LOCALE.id].game.result.copyFailed
    && out.localeShareFeedback.failureRestored === RESOURCES[SECOND_REPAINT_LOCALE.id].game.result.share,
  'result copy-failure feedback did not survive, translate, and expire across a locale repaint',
  out.localeShareFeedback);
  await page.click('#btnEndQuiet');
  await page.waitForTimeout(700); // clear tap()'s guard before cycling through hidden Settings controls
  await chooseLocale(page, 'en');

  for (const locale of LOCALES) {
    out.localeSurfaces[locale] = {};
    for (const size of SURFACE_SIZES) {
      const label = `${size.name}/${locale}`;
      await page.setViewportSize({ width: size.width, height: size.height });
      await chooseLocale(page, locale);
      const learning = await inspectLearningSurfaces(page, check, label);
      checkSurface(check, `home-${label}`, learning.home,
        { allowScrollable: true, targets: false });
      const homeTargets = await requiredHomeTargets(page);
      check(homeTargets.complete, `home-${label} does not expose every required action group`, homeTargets);
      await checkReachableTargets(page, check, `home-${label}`, homeTargets.targets);
      checkSurface(check, `learn-hub-${label}`, learning.hub,
        { allowScrollable: true, targets: false });
      checkSurface(check, `rules-${label}`, learning.rules,
        { allowScrollable: true, targets: false });
      checkSurface(check, `mode-library-${label}`, learning.modes,
        { allowScrollable: true, targets: false });
      checkSurface(check, `rune-library-${label}`, learning.runes,
        { allowScrollable: true, targets: false });
      await openSettings(page);
      const settings = await inspect(page, '#ovSettings .pbody', [
        '#languagePrevious', '#languageValue', '#languageNext',
        '#languagePicker', '#sndSeg',
      ]);
      checkSurface(check, `settings-${label}`, settings,
        { overlap: false, allowScrollable: true, targets: false });
      await checkReachableTargets(page, check, `settings-${label}`,
        ['#languagePrevious', '#languageNext', '#sndSeg button[data-s="1"]',
          '#sndSeg button[data-s="0"]']);
      await page.locator('#cbSeg button[data-b="1"]').scrollIntoViewIfNeeded();
      await page.click('#cbSeg button[data-b="1"]');
      await page.waitForSelector('#p1Pick .hues-lock:not([hidden])');
      await page.locator('#p1Pick .hues-lock').scrollIntoViewIfNeeded();
      await frame(page);
      const colourLocks = await inspect(page, '#ovSettings', ['.hues-lock:not([hidden])']);
      checkSurface(check, `colour-locks-${label}`, colourLocks, { overlap: false });
      check(colourLocks.items.length === 2
        && colourLocks.items.every((item) => item.text.length > 0),
      `colour-locks-${label} did not render both localized explanations`, colourLocks);
      await page.locator('#cbSeg button[data-b="0"]').scrollIntoViewIfNeeded();
      await page.click('#cbSeg button[data-b="0"]');

      const setup = await inspectSetup(page);
      checkSurface(check, `mode-picker-${label}`, setup.mode, { targets: false });
      await checkReachableTargets(page, check, `mode-picker-${label}`,
        Array.from({ length: setup.mode.items.length }, (_value, index) =>
          `#modePick button:nth-child(${index + 1})`));
      setup.modeInfo.forEach((surface, index) =>
        checkSurface(check, `mode-copy-${index}-${label}`, surface));
      checkSurface(check, `rune-picker-${label}`, setup.rune, { targets: false });
      await checkReachableTargets(page, check, `rune-picker-${label}`,
        Array.from({ length: setup.rune.items.length }, (_value, index) =>
          `#spellPick button:nth-child(${index + 1})`));
      setup.runeInfo.forEach((surface, index) =>
        checkSurface(check, `rune-copy-${index}-${label}`, surface));

      const tutorial = await showTutorial(page);
      checkSurface(check, `tutorial-prompt-${label}`, tutorial);
      const passPhone = await showPassPhone(page);
      checkSurface(check, `pass-phone-${label}`, passPhone);

      const result = await showResult(page);
      checkSurface(check, `result-${label}`, result, { allowScrollable: true, targets: false });
      await checkReachableTargets(page, check, `result-${label}`,
        ['#btnAgain:not([hidden])', '#btnEndQuiet:not([hidden])']);
      out.localeSurfaces[`${locale}-result-${size.name}`] = result.items.map((item) => ({
        selector: item.selector, text: item.text, box: item.box,
      }));
      await page.click('#btnEndQuiet');
      await frame(page);

      const reveal = await inspectReveal(page);
      checkSurface(check, `mode-reveal-${label}`, reveal.wheel);
      checkSurface(check, `rune-deal-${label}`, reveal.deal);
      checkSurface(check, `reveal-hold-${label}`, reveal.held);
      const textFor = (surface, selector) => surface.items
        .find((item) => item.selector === selector)?.text ?? '';
      check(textFor(reveal.deal, '#wheelTitle .wtitlecopy') === revealOwners[locale].prompt
        && textFor(reveal.deal, '#wheelOwner') === revealOwners[locale].first
        && textFor(reveal.held, '#wheelTitle .wtitlecopy') === revealOwners[locale].prompt
        && textFor(reveal.held, '#wheelOwner') === revealOwners[locale].second,
      `RANDOM ×2 did not keep its universal prompt and localized active owner in ${locale}`,
      { deal: reveal.deal.items, held: reveal.held.items });
      out.localeSurfaces[locale][size.name] = {
        settings: settings.items.length,
        learnRows: learning.hub.items.filter((item) => item.selector === '.learnrow').length,
        modePicker: setup.mode.items.length,
        modeCopies: setup.modeInfo.length,
        runePicker: setup.rune.items.length,
        runeCopies: setup.runeInfo.length,
        tutorial: tutorial.items.map((item) => item.text),
        passPhone: passPhone.items.map((item) => item.text),
        reveal: reveal.held.items.map((item) => item.text),
      };
    }
  }
  await context.close();
}
