/* The result screen's share button across a locale repaint.
 *
 * Copy feedback is a state with a lifetime, not a one-off text write, so this
 * is a claim about text over time rather than about geometry — it asserts no
 * boxes and depends on no viewport. Both paths are here because they are the
 * same rule twice: the clipboard succeeding and the clipboard refusing must
 * each survive the repaint, translate, and expire back to Share.
 *
 * Stubbing navigator.share/clipboard/execCommand is permanent for the page it
 * runs on.
 */
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { LOCALE_REGISTRY } from '../../../../src/i18n/locale.ts';
import { chooseLocale } from './locale-control.mjs';

const FIRST_REPAINT_LOCALE = LOCALE_REGISTRY[1];
const SECOND_REPAINT_LOCALE = LOCALE_REGISTRY[2];

/** Runs on a booted page and hands it back with the result screen dismissed
    and the locale returned to English. */
export async function verifyShareFeedbackRepaint(page, out, check) {
  /* Copy feedback owns a full 1.5s state, not a one-off English text write.
     A locale repaint during that window must translate the active state and
     let the original timer restore Share in the new locale. */
  await chooseLocale(page, 'en');
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
    /* Deny the legacy fallback too. Chromium may report execCommand('copy') as
       successful after a real button gesture even when the Clipboard API was
       stubbed to refuse; this branch is specifically the all-copy-paths-failed
       contract. */
    document.execCommand = () => false;
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
}
