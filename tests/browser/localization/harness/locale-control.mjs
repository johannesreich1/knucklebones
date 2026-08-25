import { LOCALE_REGISTRY } from '../../../../src/i18n/locale.ts';
import { frame } from './layout-inspection.mjs';

export const LOCALE_IDS = LOCALE_REGISTRY.map(({ id }) => id);

/** Cycle through the real Settings binding while reading its explicit locale owner. */
export async function chooseLocale(page, locale, ownerSelector = 'html') {
  const observed = [];
  for (let attempt = 0; attempt < LOCALE_IDS.length + 1; attempt++) {
    const current = await page.$eval(ownerSelector, (owner) => owner.dataset.locale);
    observed.push(current ?? '');
    if (current === locale) return;
    await page.evaluate(() => document.getElementById('languageNext')?.click());
    await frame(page);
  }
  throw new Error(
    `Could not cycle language to ${locale} through ${ownerSelector}; observed ${observed.join(' -> ')}`,
  );
}
