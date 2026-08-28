import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { checkCompactLabelFloor } from '../../support/label-floor.mjs';
import { checkReachableTargets, checkSurface, frame,
  inspectSurface as inspect } from '../harness/layout-inspection.mjs';
import { LOCALE_IDS as LOCALES, chooseLocale } from '../harness/locale-control.mjs';
import { verifyShareFeedbackRepaint } from '../harness/share-feedback.mjs';
import { requiredHomeTargets, SURFACE_SIZES } from '../harness/surface-readiness.mjs';
import {
  inspectLearningSurfaces,
  inspectReveal,
  inspectSetup,
  openSettings,
  showPassPhone,
  showResult,
  showTutorial,
} from '../harness/surface-visits.mjs';

export async function runConstrainedSurfaceScenarios(suite) {
  const { standaloneUrl, out, check, attachErrors, localeContext } = suite;
  out.localeSurfaces = {};
  const context = await localeContext(['en-US'], { viewport: { width: 320, height: 568 } });
  const page = attachErrors(await context.newPage(), 'locale-surfaces');
  await page.goto(standaloneUrl);
  await page.waitForFunction(() => window.__kb);

  await verifyShareFeedbackRepaint(page, out, check);

  const revealOwners = Object.fromEntries(LOCALES.map((locale) => [locale, {
    prompt: RESOURCES[locale].game.reveal.runeFor,
    first: RESOURCES[locale].game.player.you,
    second: RESOURCES[locale].game.player.ai,
  }]));

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
      await checkCompactLabelFloor(page, check, `settings-${label}`, '#ovSettings .lbl');
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