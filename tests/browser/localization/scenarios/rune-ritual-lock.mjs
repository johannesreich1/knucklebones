import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { LOCALE_REGISTRY } from '../../../../src/i18n/locale.ts';

const VIEWPORTS = [
  { name: 'portrait-320x568', width: 320, height: 568 },
  { name: 'portrait-390x844', width: 390, height: 844 },
  { name: 'landscape-568x320', width: 568, height: 320 },
  { name: 'landscape-667x375', width: 667, height: 375 },
];

const frame = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

const measureLock = (page) => page.evaluate(() => {
  const card = document.getElementById('spellCard');
  const picker = document.getElementById('spellPick');
  const lock = document.getElementById('spellPickLock');
  const copy = document.getElementById('spellPickLockCopy');
  const info = document.getElementById('spellPickInfo');
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: rect.width, height: rect.height,
    };
  };
  const cardBox = box(card), pickerBox = box(picker), lockBox = box(lock), copyBox = box(copy);
  const style = getComputedStyle(lock);
  const authored = {
    paddingTop: parseFloat(style.paddingTop),
    paddingBottom: parseFloat(style.paddingBottom),
    borderTop: parseFloat(style.borderTopWidth),
    borderBottom: parseFloat(style.borderBottomWidth),
  };
  return {
    locale: document.documentElement.dataset.locale,
    text: copy.textContent.trim(),
    card: cardBox,
    picker: pickerBox,
    lock: lockBox,
    copy: copyBox,
    authored,
    expectedHeight: copyBox.height + authored.paddingTop + authored.paddingBottom
      + authored.borderTop + authored.borderBottom,
    cardDisabled: card.getAttribute('aria-disabled'),
    lockHidden: lock.hidden,
    infoVisibility: getComputedStyle(info).visibility,
    selected: window.__kb.S.spell,
    stored: window.__kb.S.localChoices.duo.spell,
  };
});

async function activateDisabledRune(page) {
  await page.evaluate(() => {
    const button = document.querySelector('#spellPick button[data-v="fate"]');
    const rect = button.getBoundingClientRect();
    const init = {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerType: 'touch',
    };
    button.dispatchEvent(new PointerEvent('pointerdown', init));
    button.dispatchEvent(new PointerEvent('pointerup', init));
  });
}

export async function runRuneRitualLockScenarios(suite) {
  const { standaloneUrl, out, check, attachErrors, localeContext } = suite;
  out.runeRitualLock = {};

  for (const locale of LOCALE_REGISTRY) {
    const context = await localeContext([locale.languageTag], { viewport: VIEWPORTS[0] });
    const page = attachErrors(await context.newPage(), `rune-ritual-lock-${locale.id}`);
    const observations = [];
    try {
      await page.goto(standaloneUrl);
      await page.waitForFunction(() => window.__kb && document.documentElement.dataset.locale);
      await page.click('#btnDuoHome');
      await page.click('#spellPick button[data-v="pilfer"]');
      await page.click('#modePick button[data-v="-2"]');
      await page.waitForFunction(() => !document.getElementById('spellPickLock').hidden);
      /* Reduced-motion's blanket 60ms transition applies to every property,
         including this note's visibility. Judge the settled lock after that
         discrete transition rather than its one-frame handoff. */
      await page.waitForFunction(() => getComputedStyle(
        document.getElementById('spellPickInfo'),
      ).visibility === 'hidden');

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.locator('#spellPick').scrollIntoViewIfNeeded();
        await frame(page);
        const before = await measureLock(page);
        await activateDisabledRune(page);
        const after = await measureLock(page);
        const view = { viewport: viewport.name, before, after };
        observations.push(view);

        const tolerance = 0.75;
        check(before.locale === locale.id
          && before.text === RESOURCES[locale.id].game.runeTrial.setupOwnChoice,
        `${locale.id}/${viewport.name} painted the wrong Ritual lock copy`, view);
        check(!before.lockHidden && before.cardDisabled === 'true'
          && before.infoVisibility === 'hidden',
        `${locale.id}/${viewport.name} lost the disabled Ritual presentation`, view);
        check(before.copy.left >= before.lock.left - tolerance
          && before.copy.right <= before.lock.right + tolerance
          && before.copy.top >= before.lock.top - tolerance
          && before.copy.bottom <= before.lock.bottom + tolerance,
        `${locale.id}/${viewport.name} lets Ritual copy escape its banner`, view);
        check(before.lock.left >= before.card.left - tolerance
          && before.lock.right <= before.card.right + tolerance
          && before.lock.top >= before.card.top - tolerance
          && before.lock.bottom <= before.card.bottom + tolerance,
        `${locale.id}/${viewport.name} lets the Ritual banner escape its card`, view);
        check(before.lock.top >= before.picker.top - tolerance
          && before.lock.bottom <= before.picker.bottom + tolerance
          && Math.abs(before.lock.width - before.card.width) <= tolerance
          && Math.abs((before.lock.top + before.lock.bottom)
            - (before.picker.top + before.picker.bottom)) <= tolerance,
        `${locale.id}/${viewport.name} did not centre the Ritual banner across the rune grid`, view);
        check(before.authored.paddingTop === 8 && before.authored.paddingBottom === 8
          && before.authored.borderTop === 1 && before.authored.borderBottom === 1
          && Math.abs(before.lock.height - before.expectedHeight) <= tolerance,
        `${locale.id}/${viewport.name} stretched the Ritual banner beyond its copy padding`, view);
        check(before.selected === 'pilfer' && before.stored === 'pilfer'
          && after.selected === before.selected && after.stored === before.stored,
        `${locale.id}/${viewport.name} let a disabled rune tap change the Ritual setup`, view);
      }
    } finally {
      await context.close();
    }
    out.runeRitualLock[locale.id] = observations;
  }
}
