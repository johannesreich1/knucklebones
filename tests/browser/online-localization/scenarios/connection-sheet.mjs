import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { checkReachableTargets, checkSurface, frame,
  inspectSurface } from '../../localization/harness/layout-inspection.mjs';

export async function inspectOfflineSheet(suite, page, label, locale) {
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: false,
  }));
  await page.click('#btnAgain');
  await page.waitForSelector('#ovAsk.on .focard', { timeout: 15000 });
  await frame(page);
  /* The ask card deliberately expands through the generic sheet card's
     horizontal padding. Inspect its own real bounds so that intentional
     negative margin is not misread as clipped sheet overflow. */
  const surface = await inspectSurface(page, '#ovAsk .askcard', [
    '#askHead', '#askBody', '#btnAskYes', '#btnAskNo',
  ]);
  checkSurface(suite.check, `offline-${label}`, surface,
    { allowScrollable: true, targets: false });
  await checkReachableTargets(page, suite.check, `offline-${label}`, [
    '.fograb', '#btnAskYes', '#btnAskNo',
  ]);
  const copy = await page.evaluate(() => ({
    title: document.getElementById('askHead')?.textContent?.trim() ?? '',
    body: document.getElementById('askBody')?.textContent?.trim() ?? '',
    retry: document.getElementById('btnAskYes')?.textContent?.trim() ?? '',
    close: document.getElementById('btnAskNo')?.textContent?.trim() ?? '',
  }));
  suite.check(copy.title === RESOURCES[locale].online.connection.offline.title
      && copy.body === RESOURCES[locale].online.connection.offline.body
      && copy.retry === RESOURCES[locale].common.actions.retry
      && copy.close === RESOURCES[locale].common.actions.close,
    `offline-${label} did not paint the complete locale`, copy);

  /* The transport-failure variant uses the same stable sheet. Paint its real
     locale strings into that geometry as the auth matrix does for worst-case
     error copy; catalog parity separately guarantees the runtime key path. */
  const unavailableCopy = RESOURCES[locale].online.connection.unavailable;
  await page.evaluate(({ title, body }) => {
    document.getElementById('askHead').textContent = title;
    document.getElementById('askBody').textContent = body;
  }, unavailableCopy);
  await frame(page);
  const unavailable = await inspectSurface(page, '#ovAsk .askcard', [
    '#askHead', '#askBody', '#btnAskYes', '#btnAskNo',
  ]);
  checkSurface(suite.check, `connection-unavailable-${label}`, unavailable,
    { allowScrollable: true, targets: false });
  await checkReachableTargets(page, suite.check, `connection-unavailable-${label}`, [
    '.fograb', '#btnAskYes', '#btnAskNo',
  ]);
  return { offline: surface, unavailable };
}
