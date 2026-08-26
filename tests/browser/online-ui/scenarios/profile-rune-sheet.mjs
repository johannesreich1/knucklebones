// The profile rune collection and its shared detail sheet: every rune the
// account owns (or is missing) renders as a real button in registry order, and
// tapping one opens the SAME library sheet the roster uses — an unlocked rune
// shows its unlock timestamp, a locked one hides its mechanics and points at
// RUNE RITUAL instead. Split from rune-trial-ui.mjs, which keeps the reward
// delivery/recovery races; this file owns the collection grid presentation.
import { SPELLS } from '../../../../src/core/spells.ts';

async function profileRuneProbe(page) {
  const collection = await page.evaluate(() => {
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const slots = [...document.querySelectorAll('#accRuneGrid .accrune')].map((slot) => {
      const box = slot.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        rune: slot.dataset.rune,
        tag: slot.tagName,
        label: slot.getAttribute('aria-label'),
        disabled: slot.getAttribute('aria-disabled'),
        nativeDisabled: slot.disabled,
        tabIndex: slot.tabIndex,
        collected: slot.classList.contains('collected'),
        locked: slot.classList.contains('locked'),
        visible: visible(slot),
        centreHit: slot === hit || slot.contains(hit),
        height: box.height,
        opacity: getComputedStyle(slot).opacity,
      };
    });
    const title = document.getElementById('accRunesTitle');
    const count = document.getElementById('accRuneCount');
    const root = document.getElementById('kbroot');
    return {
      count: count?.textContent?.trim(),
      titleFontSize: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
      countFontSize: count ? parseFloat(getComputedStyle(count).fontSize) : 0,
      labelMinimum: root
        ? parseFloat(getComputedStyle(root).getPropertyValue('--font-label-min'))
        : 0,
      gridLabel: document.getElementById('accRuneGrid')?.getAttribute('aria-label'),
      slots,
    };
  });

  const readSheet = () => page.evaluate(() => {
    const overlay = document.querySelector('.faceoff.libsheet');
    const card = overlay?.querySelector('.focard');
    const detail = overlay?.querySelector('.mcdetail');
    const meta = overlay?.querySelector('.mcmeta');
    const detailBox = detail?.getBoundingClientRect();
    const metaBox = meta?.getBoundingClientRect();
    return {
      open: !!overlay && !!card,
      rosterOpen: !!document.querySelector('#ovSpells.on'),
      classes: overlay?.className ?? '',
      role: card?.getAttribute('role'),
      modal: card?.getAttribute('aria-modal'),
      label: card?.getAttribute('aria-label'),
      name: overlay?.querySelector('.mcname')?.textContent?.trim() ?? '',
      blurb: overlay?.querySelector('.mcblurb')?.textContent?.trim() ?? '',
      detail: detail?.textContent?.trim() ?? '',
      meta: meta?.textContent?.trim() ?? '',
      metaHidden: meta?.hidden ?? null,
      metaSeparate: !!detailBox && !!metaBox && metaBox.top > detailBox.bottom,
      metaBorder: meta ? getComputedStyle(meta).borderTopWidth : '',
      icon: !!overlay?.querySelector('.mchead svg'),
      hued: card?.classList.contains('hued') ?? false,
    };
  });

  await page.click('#accRuneGrid .accrune[data-rune="fate"]');
  await page.waitForSelector('.faceoff.libsheet .focard', { timeout: 5000 });
  await page.waitForTimeout(380);
  const unlocked = await readSheet();
  unlocked.expectedMeta = await page.evaluate(() => `Unlocked at ${new Intl.DateTimeFormat(
    document.documentElement.lang,
    { dateStyle: 'medium', timeStyle: 'short' },
  ).format(new Date('2026-08-01T00:00:00Z'))}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.faceoff.libsheet', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(50);
  unlocked.focusRestored = await page.evaluate(() =>
    document.activeElement?.matches('#accRuneGrid .accrune[data-rune="fate"]'));

  await page.focus('#accRuneGrid .accrune[data-rune="nudge"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.faceoff.libsheet .focard', { timeout: 5000 });
  await page.waitForTimeout(380);
  const locked = await readSheet();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['de-DE'] });
    window.dispatchEvent(new Event('languagechange'));
  });
  await page.waitForFunction(() => document.documentElement.dataset.locale === 'de');
  locked.localized = await readSheet();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.faceoff.libsheet', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(50);
  locked.focusRestored = await page.evaluate(() =>
    document.activeElement?.matches('#accRuneGrid .accrune[data-rune="nudge"]'));
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] });
    window.dispatchEvent(new Event('languagechange'));
  });
  await page.waitForFunction(() => document.documentElement.dataset.locale === 'en');

  return { ...collection, unlocked, locked };
}

export async function runProfileRuneSheetScenarios({ visit, out, check }) {
  const profile = await visit({
    named: true,
    runes: ['fate', 'ward'],
    skipStandardProbes: true,
    probe: profileRuneProbe,
  });
  out.runeCollectionProfile = profile.probeResult;
  const slots = profile.probeResult?.slots ?? [];
  check(slots.length === 6
      && JSON.stringify(slots.map(({ rune }) => rune))
        === JSON.stringify(SPELLS.map(({ id }) => id))
      && slots.every(({ visible, label }) => visible && !!label)
      && slots.filter(({ collected, disabled }) => collected && disabled === null).length === 2
      && slots.filter(({ locked, disabled }) => locked && disabled === null).length === 4
      && slots.every(({ tag, nativeDisabled, tabIndex, centreHit, height }) =>
        tag === 'BUTTON' && !nativeDisabled && tabIndex >= 0 && centreHit && height >= 44)
      && profile.probeResult?.count === '2 / 6'
      && profile.probeResult?.gridLabel?.includes('2'),
    'profile did not render canonical-order visible 44px rune buttons with owned/locked state',
    profile.probeResult);
  check(profile.probeResult?.labelMinimum >= 10
      && profile.probeResult.titleFontSize >= 10
      && profile.probeResult.countFontSize >= 10
      && profile.probeResult.titleFontSize >= profile.probeResult.labelMinimum
      && profile.probeResult.countFontSize >= profile.probeResult.labelMinimum,
    'profile rune heading and count fell below the shared compact-label minimum',
    profile.probeResult);
  const unlocked = profile.probeResult?.unlocked;
  check(unlocked?.open && unlocked.classes.includes('libsheet') && !unlocked.rosterOpen
      && unlocked.role === 'dialog' && unlocked.modal === 'true'
      && unlocked.label === 'FATE' && unlocked.name === 'FATE'
      && unlocked.blurb === 'Throw your die back and draw another.'
      && unlocked.detail.startsWith('Discard the die in hand')
      && unlocked.meta === unlocked.expectedMeta && !unlocked.metaHidden
      && unlocked.metaSeparate && unlocked.metaBorder !== '0px'
      && unlocked.icon && unlocked.hued && unlocked.focusRestored,
    'a collected profile rune did not open the shared rune sheet with its unlock timestamp',
    unlocked);
  const locked = profile.probeResult?.locked;
  check(locked?.open && locked.classes.includes('libsheet') && !locked.rosterOpen
      && locked.role === 'dialog' && locked.modal === 'true'
      && locked.label === 'NUDGE' && locked.name === 'NUDGE'
      && locked.blurb === 'LOCKED'
      && locked.detail === 'Win this rune in RUNE RITUAL to unlock it.'
      && !locked.detail.includes('one pip') && locked.meta === '' && locked.metaHidden
      && locked.icon && locked.hued && locked.focusRestored
      && locked.localized?.name === 'SCHUBS' && locked.localized.blurb === 'GESPERRT'
      && locked.localized.detail === 'Gewinne diese Rune im RUNENRITUAL, um sie freizuschalten.',
    'a locked profile rune exposed its mechanics or did not explain how to unlock it',
    locked);
  check(profile.errs.length === 0, 'page errors while rendering the rune collection profile', profile.errs);
}
