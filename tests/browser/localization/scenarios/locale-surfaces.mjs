const LOCALES = ['en', 'de', 'fr'];

const frame = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function chooseLocale(page, locale) {
  for (let attempt = 0; attempt < LOCALES.length + 1; attempt++) {
    if (await page.$eval('#kbroot', (root) => root.lang || document.documentElement.lang) === locale) return;
    await page.evaluate(() => document.getElementById('languageNext')?.click());
    await frame(page);
  }
  throw new Error(`Could not cycle language to ${locale}`);
}

async function inspect(page, containerSelector, selectors) {
  return page.evaluate(({ containerSelector, selectors }) => {
    const container = document.querySelector(containerSelector);
    const bounds = container.getBoundingClientRect();
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height,
        right: box.right, bottom: box.bottom };
    };
    const records = selectors.flatMap((selector) => (selector === ':scope'
      ? [container] : [...container.querySelectorAll(selector)])
      .map((element) => ({ selector, element })))
      .filter(({ element }) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden'
          && style.display !== 'none' && Number(style.opacity) !== 0;
      })
      .map(({ selector, element }) => {
        const box = rect(element);
        const style = getComputedStyle(element);
        const range = document.createRange();
        range.selectNodeContents(element);
        const rangeBox = rect(range);
        const collisionBox = element instanceof HTMLButtonElement
          || rangeBox.width <= 0 || rangeBox.height <= 0 ? box : rangeBox;
        return { element, item: {
          selector,
          text: element.textContent?.trim() ?? '',
          box,
          collisionBox,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          textOverflow: style.textOverflow,
          inside: box.x >= bounds.x - 0.5 && box.y >= bounds.y - 0.5
            && box.right <= bounds.right + 0.5 && box.bottom <= bounds.bottom + 0.5,
        } };
      });
    const items = records.map(({ item }) => item);
    const overlaps = [];
    for (let left = 0; left < items.length; left++) for (let right = left + 1; right < items.length; right++) {
      const a = items[left].collisionBox, b = items[right].collisionBox;
      const width = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      /* Parent/child boxes intentionally overlap. Only sibling surfaces are a
         collision; nested text naturally occupies its button/card. */
      const aNode = records[left].element;
      const bNode = records[right].element;
      if (width > 0.5 && height > 0.5
          && !aNode.contains(bNode) && !bNode.contains(aNode)) {
        overlaps.push({ left: items[left], right: items[right], width, height });
      }
    }
    const style = getComputedStyle(container);
    return {
      bounds: rect(container),
      items,
      overlaps,
      scrollable: container.scrollHeight > container.clientHeight + 0.5
        && ['auto', 'scroll'].includes(style.overflowY),
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    };
  }, { containerSelector, selectors });
}

function checkSurface(check, label, surface, { overlap = true, allowScrollable = false } = {}) {
  const clipped = surface.items.filter((item) => (!item.inside && !(allowScrollable && surface.scrollable))
    || (item.scrollWidth > item.clientWidth + 0.5 && item.overflowX !== 'visible')
    || (item.scrollHeight > item.clientHeight + 0.5 && item.overflowY !== 'visible')
    || (item.textOverflow === 'ellipsis' && item.text));
  check(surface.items.length > 0 && clipped.length === 0,
    `${label} clips, truncates, or pushes localized copy outside its surface`, { clipped, surface });
  if (overlap) check(surface.overlaps.length === 0,
    `${label} overlaps sibling localized controls or copy`, surface.overlaps);
}

async function openSettings(page) {
  await page.evaluate(() => window.__kb.goHome());
  await page.click('#btnSettingsHome');
  await page.waitForSelector('#ovSettings.on');
  await page.locator('#languagePicker').scrollIntoViewIfNeeded();
  await frame(page);
}

async function inspectSetup(page) {
  await page.click('#btnSettingsBack');
  await page.evaluate(() => window.__kb.openPractice());
  await page.locator('#modePick').scrollIntoViewIfNeeded();
  await frame(page);
  const mode = await inspect(page, '#modePick', ['button']);
  const modeInfo = await inspect(page, '#modePickInfo', [':scope']);
  await page.locator('#spellPick').scrollIntoViewIfNeeded();
  await frame(page);
  const rune = await inspect(page, '#spellPick', ['button']);
  const runeInfo = await inspect(page, '#spellPickInfo', [':scope']);
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
  /* The prior result action is a real pointer tap; let the global ghost-click
     guard expire before exercising Play through its click fallback. */
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    const game = window.__kb;
    game.S.gen++;
    game.goHome();
    game.openPractice();
    game.S.mode = 'cpu';
    game.S.localMode = -1;
    game.S.spell = 'random2';
    window.__kbTestOriginalRandom = Math.random;
    Math.random = () => 0.25;
  });
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
    '#wheelTitle', '.rfelt', '.rdealt', '.rface .rlbl', '#wheelName', '#wheelBlurb',
  ]);
  await page.waitForSelector('#ovWheel.holding', { timeout: 15000 });
  await page.waitForTimeout(80);
  await frame(page);
  const held = await inspect(page, '#ovWheel', [
    '#wheelSettled .wowner', '#wheelSettled .wpill', '#wheelSettled .wblurb',
    '#wheelName', '#wheelBlurb',
    '#wheelHold b', '#wheelHold span',
  ]);
  await page.locator('#ovWheel').dispatchEvent('pointerdown');
  await page.waitForFunction(() => !document.getElementById('ovWheel')?.classList.contains('on'));
  await page.evaluate(() => { window.__kb.S.gen++; });
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
  await page.waitForFunction(() => document.getElementById('btnShare')?.textContent?.trim() === 'Copied!');
  await page.waitForTimeout(700); // clear tap()'s native-click guard while feedback is still active
  await page.evaluate(() => document.getElementById('languageNext')?.click());
  await page.waitForFunction(() => document.documentElement.lang === 'de'
    && document.getElementById('btnShare')?.textContent?.trim() === 'Kopiert!');
  out.localeShareFeedback = await page.evaluate(() => {
    const share = document.getElementById('btnShare');
    return {
      active: share?.textContent?.trim(),
      sameButton: share === window.__localeShareButton,
      sentinel: share?.getAttribute('data-locale-sentinel'),
    };
  });
  await page.waitForFunction(() => document.getElementById('btnShare')?.textContent?.trim()
    === 'Ergebnis teilen', null, { timeout: 3000 });
  out.localeShareFeedback.restored = await page.$eval('#btnShare', (button) => button.textContent?.trim());
  check(out.localeShareFeedback.active === 'Kopiert!'
    && out.localeShareFeedback.restored === 'Ergebnis teilen'
    && out.localeShareFeedback.sameButton && out.localeShareFeedback.sentinel === 'kept',
  'result copy feedback did not survive, translate, and expire across a locale repaint',
  out.localeShareFeedback);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  });
  await page.click('#btnShare');
  await page.waitForFunction(() => document.getElementById('btnShare')?.textContent?.trim()
    === 'Kopieren fehlgeschlagen');
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById('languageNext')?.click());
  await page.waitForFunction(() => document.documentElement.lang === 'fr'
    && document.getElementById('btnShare')?.textContent?.trim() === 'Échec de la copie');
  out.localeShareFeedback.failure = await page.$eval('#btnShare', (button) => button.textContent?.trim());
  await page.waitForFunction(() => document.getElementById('btnShare')?.textContent?.trim()
    === 'Partager le résultat', null, { timeout: 3000 });
  out.localeShareFeedback.failureRestored = await page.$eval(
    '#btnShare', (button) => button.textContent?.trim());
  check(out.localeShareFeedback.failure === 'Échec de la copie'
    && out.localeShareFeedback.failureRestored === 'Partager le résultat',
  'result copy-failure feedback did not survive, translate, and expire across a locale repaint',
  out.localeShareFeedback);
  await page.click('#btnEndQuiet');
  await page.waitForTimeout(700); // clear tap()'s guard before cycling through hidden Settings controls
  await chooseLocale(page, 'en');

  for (const locale of LOCALES) {
    await page.setViewportSize({ width: 320, height: 568 });
    await chooseLocale(page, locale);
    await openSettings(page);
    const settings = await inspect(page, '#ovSettings', [
      '#languagePrevious', '#languageValue', '#languageNext',
      '#languagePicker', '#sndSeg',
    ]);
    /* The picker contains its three children, so sibling overlap is checked by
       the focused behavior scenario; this pass is about translated bounds. */
    checkSurface(check, `settings-320/${locale}`, settings, { overlap: false });
    await page.locator('#cbSeg button[data-b="1"]').scrollIntoViewIfNeeded();
    await page.click('#cbSeg button[data-b="1"]');
    await page.waitForSelector('#p1Pick .hues-lock:not([hidden])');
    await page.locator('#p1Pick .hues-lock').scrollIntoViewIfNeeded();
    await frame(page);
    const colourLocks = await inspect(page, '#ovSettings', ['.hues-lock:not([hidden])']);
    checkSurface(check, `colour-locks-320/${locale}`, colourLocks, { overlap: false });
    check(colourLocks.items.length === 2 && colourLocks.items.every((item) => item.text.length > 0),
      `colour-locks-320/${locale} did not render both localized explanations`, colourLocks);
    await page.locator('#cbSeg button[data-b="0"]').scrollIntoViewIfNeeded();
    await page.click('#cbSeg button[data-b="0"]');

    const setup = await inspectSetup(page);
    checkSurface(check, `mode-picker-320/${locale}`, setup.mode);
    checkSurface(check, `mode-copy-320/${locale}`, setup.modeInfo);
    checkSurface(check, `rune-picker-320/${locale}`, setup.rune);
    checkSurface(check, `rune-copy-320/${locale}`, setup.runeInfo);

    const tutorial = await showTutorial(page);
    checkSurface(check, `tutorial-prompt-320/${locale}`, tutorial);

    for (const size of [{ name: 'portrait', width: 320, height: 568 },
      { name: 'landscape', width: 568, height: 320 }]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      const result = await showResult(page);
      checkSurface(check, `result-${size.name}/${locale}`, result, { allowScrollable: true });
      out.localeSurfaces[`${locale}-result-${size.name}`] = result.items.map((item) => ({
        selector: item.selector, text: item.text, box: item.box,
      }));
      await page.click('#btnEndQuiet');
      await frame(page);
    }

    await page.setViewportSize({ width: 568, height: 320 });
    const reveal = await inspectReveal(page);
    checkSurface(check, `mode-reveal-568x320/${locale}`, reveal.wheel);
    checkSurface(check, `rune-deal-568x320/${locale}`, reveal.deal);
    checkSurface(check, `reveal-hold-568x320/${locale}`, reveal.held);
    out.localeSurfaces[locale] = {
      settings: settings.items.length,
      modePicker: setup.mode.items.length,
      runePicker: setup.rune.items.length,
      tutorial: tutorial.items.map((item) => item.text),
      reveal: reveal.held.items.map((item) => item.text),
    };
  }
  await context.close();
}
