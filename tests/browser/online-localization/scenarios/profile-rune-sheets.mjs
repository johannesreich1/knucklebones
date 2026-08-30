// The profile rune detail sheets, per locale: a collected rune's sheet keeps
// the shared registry copy plus a localized unlock timestamp; a locked rune's
// sheet hides the mechanics and points at RUNE RITUAL in the same locale.
// Owned separately from online-surfaces.mjs (which drives the panel tour and
// calls this per viewport) so each file stays inside the test size budget.
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { checkSurface, frame,
  inspectSurface } from '../../localization/harness/layout-inspection.mjs';

export async function inspectRuneSheets(suite, page, label, locale) {
  const catalog = RESOURCES[locale.id];
  const readCopy = () => page.evaluate(() => {
    const overlay = document.querySelector('.faceoff.libsheet');
    const card = overlay?.querySelector('.focard');
    const meta = overlay?.querySelector('.mcmeta');
    return {
      dialog: card?.getAttribute('role') === 'dialog'
        && card?.getAttribute('aria-modal') === 'true',
      name: overlay?.querySelector('.mcname')?.textContent?.trim() ?? '',
      blurb: overlay?.querySelector('.mcblurb')?.textContent?.trim() ?? '',
      detail: overlay?.querySelector('.mcdetail')?.textContent?.trim() ?? '',
      meta: meta?.textContent?.trim() ?? '',
      metaHidden: meta?.hidden ?? null,
      rosterOpen: !!document.querySelector('#ovSpells.on'),
    };
  });
  const inspectOpenSheet = async (kind) => {
    await page.waitForSelector('.faceoff.libsheet .focard', { timeout: 5000 });
    await frame(page);
    const surface = await inspectSurface(page, '.faceoff.libsheet .focard', [
      '.fograb', '.mchead', '.mcblurb', '.mcdetail', ...(kind === 'unlocked' ? ['.mcmeta'] : []),
    ]);
    checkSurface(suite.check, `profile-rune-${kind}-${label}`, surface, { targets: false });
    const copy = await readCopy();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.faceoff.libsheet', { state: 'detached', timeout: 5000 });
    return { surface, copy };
  };

  await page.click('#accRuneGrid .accrune[data-rune="fate"]');
  const unlocked = await inspectOpenSheet('unlocked');
  const localizedDate = await page.evaluate((languageTag) => new Intl.DateTimeFormat(
    languageTag,
    { dateStyle: 'medium', timeStyle: 'short' },
  ).format(new Date('2026-08-01T00:00:00Z')), locale.languageTag);
  const expectedMeta = catalog.online.profile.runeUnlockedAt.replace('{{date}}', localizedDate);
  suite.check(unlocked.copy.dialog && !unlocked.copy.rosterOpen
      && unlocked.copy.name === catalog.game.runes.fate.name
      && unlocked.copy.blurb === catalog.game.runes.fate.blurb
      && unlocked.copy.detail === catalog.game.runes.fate.detail
      && unlocked.copy.meta === expectedMeta && !unlocked.copy.metaHidden,
    `profile-rune-unlocked-${label} did not keep shared localized copy and unlock time`,
    { actual: unlocked.copy, expectedMeta });

  await page.click('#accRuneGrid .accrune[data-rune="nudge"]');
  const locked = await inspectOpenSheet('locked');
  const expectedLockedDetail = catalog.online.profile.runeLockedDetail
    .replace('{{mode}}', catalog.game.modes.runeTrial.name);
  suite.check(locked.copy.dialog && !locked.copy.rosterOpen
      && locked.copy.name === catalog.game.runes.nudge.name
      && locked.copy.blurb === catalog.online.profile.runeLocked
      && locked.copy.detail === expectedLockedDetail
      && locked.copy.detail !== catalog.game.runes.nudge.detail
      && locked.copy.meta === '' && locked.copy.metaHidden,
    `profile-rune-locked-${label} exposed mechanics or lost localized unlock guidance`,
    { actual: locked.copy, expectedLockedDetail });

  const seatLabel = await page.locator('#accSeat').getAttribute('aria-label');
  await page.click('#accSeat');
  await page.waitForSelector('.faceoff.libsheet .focard', { timeout: 5000 });
  await frame(page);
  const seatSurface = await inspectSurface(page, '.faceoff.libsheet .focard', [
    '.fograb', '.mcname', '.mcdetail', '.seatpick .accrune', '#accSeatClear',
  ]);
  checkSurface(suite.check, `profile-rune-seat-${label}`, seatSurface,
    { allowScrollable: true, targets: false });
  const seatCopy = await page.evaluate(() => ({
    title: document.querySelector('.faceoff.libsheet .mcname')?.textContent?.trim() ?? '',
    detail: document.querySelector('.faceoff.libsheet .mcdetail')?.textContent?.trim() ?? '',
    clear: document.querySelector('#accSeatClear')?.textContent?.trim() ?? '',
  }));
  const expectedSeatLabel = `${catalog.game.runes.fate.name} — ${catalog.online.profile.equippedMeta}`;
  suite.check(seatLabel === expectedSeatLabel
      && seatCopy.title === catalog.online.profile.seatPick
      && seatCopy.detail === catalog.online.profile.seatPickDetail
      && seatCopy.clear === catalog.online.profile.unequipThis,
    `profile-rune-seat-${label} did not render the localized SILVER/Trial contract`,
    { seatLabel, expectedSeatLabel, seatCopy });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.faceoff.libsheet', { state: 'detached', timeout: 5000 });
  return { unlocked, locked, seat: { surface: seatSurface, copy: seatCopy } };
}
