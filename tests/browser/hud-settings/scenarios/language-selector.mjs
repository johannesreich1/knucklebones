const IDS = ['en', 'de', 'fr'];
const NAMES = ['English', 'Deutsch', 'Français'];

export async function runLanguageSelectorScenarios(suite) {
  const { page, ctx, F, out, check } = suite;

  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => window.__kb.goHome());
  await page.waitForTimeout(250);
  await page.tap('#btnSettingsHome');
  await page.waitForTimeout(250);
  await page.locator('#languagePicker').scrollIntoViewIfNeeded();

  out.languagePicker = await page.evaluate(() => {
    const picker = document.getElementById('languagePicker');
    const value = document.getElementById('languageValue');
    const previous = document.getElementById('languagePrevious');
    const next = document.getElementById('languageNext');
    const opponent = document.getElementById('p2Pick')?.closest('.card');
    const language = picker?.closest('.card');
    const sound = document.getElementById('sndSeg')?.closest('.card');
    const rect = (element) => element?.getBoundingClientRect();
    const pickerRect = rect(picker);
    const valueRect = rect(value);
    const previousRect = rect(previous);
    const nextRect = rect(next);
    const hit = (element, box) => !!element && !!box
      && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === element;
    return {
      override: window.__kb.S.localeOverride,
      value: value?.textContent?.trim(),
      label: document.getElementById('languageLabel')?.textContent?.trim(),
      live: value?.getAttribute('aria-live'),
      atomic: value?.getAttribute('aria-atomic'),
      previous: {
        tag: previous?.tagName,
        type: previous?.getAttribute('type'),
        label: previous?.getAttribute('aria-label'),
        width: previousRect?.width,
        height: previousRect?.height,
        hit: hit(previous, previousRect),
      },
      next: {
        tag: next?.tagName,
        type: next?.getAttribute('type'),
        label: next?.getAttribute('aria-label'),
        width: nextRect?.width,
        height: nextRect?.height,
        hit: hit(next, nextRect),
      },
      centred: pickerRect && valueRect
        ? Math.abs((pickerRect.left + pickerRect.width / 2) - (valueRect.left + valueRect.width / 2))
        : null,
      order: !!opponent && !!language && !!sound
        && !!(opponent.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!(language.compareDocumentPosition(sound) & Node.DOCUMENT_POSITION_FOLLOWING),
      visibleSystemChoice: /system|automatic/i.test(picker?.textContent ?? ''),
    };
  });
  check(out.languagePicker.override === null && NAMES.includes(out.languagePicker.value),
        'language picker did not start from the effective automatic locale', out.languagePicker);
  check(out.languagePicker.order && !out.languagePicker.visibleSystemChoice,
        'language picker is not immediately before Sound or exposes a System choice', out.languagePicker);
  check(out.languagePicker.live === 'polite' && out.languagePicker.atomic === 'true'
    && out.languagePicker.previous.label && out.languagePicker.next.label
    && out.languagePicker.previous.label !== out.languagePicker.next.label,
        'language picker is missing its localized live/accessibility hooks', out.languagePicker);
  check(out.languagePicker.previous.tag === 'BUTTON' && out.languagePicker.previous.type === 'button'
    && out.languagePicker.next.tag === 'BUTTON' && out.languagePicker.next.type === 'button'
    && out.languagePicker.previous.width >= 44 && out.languagePicker.previous.height >= 44
    && out.languagePicker.next.width >= 44 && out.languagePicker.next.height >= 44
    && out.languagePicker.previous.hit && out.languagePicker.next.hit,
        'language arrows are not two real, hittable 44px controls', out.languagePicker);
  check(out.languagePicker.centred !== null && out.languagePicker.centred < 0.5,
        'language name is not fixed on the picker centre', out.languagePicker);

  const initial = NAMES.indexOf(out.languagePicker.value);
  await page.tap('#languageNext');
  await page.waitForTimeout(150);
  out.languageFirstChoice = await page.evaluate(() => ({
    override: window.__kb.S.localeOverride,
    value: document.getElementById('languageValue')?.textContent?.trim(),
    lang: document.documentElement.lang,
  }));
  const first = (initial + 1) % IDS.length;
  check(initial >= 0 && out.languageFirstChoice.override === IDS[first]
    && out.languageFirstChoice.value === NAMES[first]
    && out.languageFirstChoice.lang === IDS[first],
        'first arrow press did not advance from the effective locale into an explicit override',
        { initial: out.languagePicker.value, result: out.languageFirstChoice });

  const forward = [];
  for (let index = 0; index < IDS.length; index++) {
    await page.tap('#languageNext');
    await page.waitForTimeout(100);
    forward.push(await page.$eval('#languageValue', (element) => element.textContent?.trim()));
  }
  out.languageWrap = { from: NAMES[first], forward };
  check(forward.length === IDS.length
    && forward.every((name, offset) => name === NAMES[(first + offset + 1) % IDS.length])
    && forward.at(-1) === NAMES[first],
        'language next arrow does not wrap through en/de/fr', out.languageWrap);

  await page.tap('#languagePrevious');
  await page.waitForTimeout(100);
  const previousName = await page.$eval('#languageValue', (element) => element.textContent?.trim());
  check(previousName === NAMES[(first + IDS.length - 1) % IDS.length],
        'language previous arrow does not wrap backwards', { from: NAMES[first], previousName });

  let currentName = previousName;
  for (let attempts = 0; currentName !== 'Deutsch' && attempts < IDS.length; attempts++) {
    await page.tap('#languageNext');
    await page.waitForTimeout(100);
    currentName = await page.$eval('#languageValue', (element) => element.textContent?.trim());
  }
  await page.waitForFunction(() => {
    try {
      return JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}').localeOverride === 'de';
    } catch { return false; }
  }, null, { timeout: 8000 }).catch(() => { /* the check below names the failure */ });
  out.languageSaved = await page.evaluate(() => ({
    override: window.__kb.S.localeOverride,
    stored: JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}').localeOverride,
    label: document.getElementById('languageLabel')?.textContent?.trim(),
    previousLabel: document.getElementById('languagePrevious')?.getAttribute('aria-label'),
    nextLabel: document.getElementById('languageNext')?.getAttribute('aria-label'),
    modePickLabel: document.querySelector('#modePick button[data-v="0"]')?.getAttribute('aria-label'),
    spellPickLabel: document.querySelector('#spellPick button[data-v=""]')?.getAttribute('aria-label'),
  }));
  check(out.languageSaved.override === 'de' && out.languageSaved.stored === 'de'
    && out.languageSaved.label !== 'Language'
    && out.languageSaved.previousLabel !== 'Previous language'
    && out.languageSaved.nextLabel !== 'Next language'
    && out.languageSaved.modePickLabel !== 'CLASSIC'
    && out.languageSaved.spellPickLabel !== 'NONE',
        'German selector/picker copy or local preference was not applied', out.languageSaved);

  /* Locale repaint is deliberately narrower than applySides(): changing copy
     during a live turn must not rebuild the board or disturb its geometry. */
  await page.evaluate(() => {
    document.getElementById('ovSettings')?.classList.remove('on');
    window.__kb.newGame();
    window.__kb.S.gen++; // cancel the delayed first roll; keep the opening copy live
  });
  await page.waitForTimeout(700); // clear tap()'s native-click guard
  out.liveLocaleBefore = await page.evaluate(() => {
    const board = document.getElementById('botBoard');
    const column = board?.querySelector('.col');
    const badge = document.querySelector('#rec button[data-lib="modes"]');
    window.__liveLocaleColumn = column;
    window.__liveLocaleBadge = badge;
    column?.setAttribute('data-locale-sentinel', 'kept');
    badge?.setAttribute('data-locale-sentinel', 'kept');
    badge?.focus();
    const rect = board?.getBoundingClientRect();
    return {
      status: document.getElementById('status')?.textContent,
      stage: document.getElementById('dieStage')?.getAttribute('aria-label'),
      name: document.getElementById('nameBot')?.textContent,
      badge: badge?.textContent,
      children: board?.childElementCount,
      rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  await page.evaluate(() => document.getElementById('languageNext')?.click());
  await page.waitForTimeout(150);
  out.liveLocaleAfter = await page.evaluate(() => {
    const board = document.getElementById('botBoard');
    const column = board?.querySelector('.col');
    const badge = document.querySelector('#rec button[data-lib="modes"]');
    const rect = board?.getBoundingClientRect();
    return {
      locale: window.__kb.S.localeOverride,
      status: document.getElementById('status')?.textContent,
      stage: document.getElementById('dieStage')?.getAttribute('aria-label'),
      name: document.getElementById('nameBot')?.textContent,
      badge: badge?.textContent,
      sameBadge: badge === window.__liveLocaleBadge,
      focusedBadge: document.activeElement === badge,
      badgeSentinel: badge?.getAttribute('data-locale-sentinel'),
      sameColumn: column === window.__liveLocaleColumn,
      sentinel: column?.getAttribute('data-locale-sentinel'),
      children: board?.childElementCount,
      rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  const geometryDelta = Object.keys(out.liveLocaleBefore.rect ?? {}).reduce((maximum, key) =>
    Math.max(maximum, Math.abs(out.liveLocaleBefore.rect[key] - out.liveLocaleAfter.rect[key])), 0);
  check(out.liveLocaleAfter.locale === 'fr'
    && out.liveLocaleAfter.status !== out.liveLocaleBefore.status
    && out.liveLocaleAfter.stage !== out.liveLocaleBefore.stage
    && out.liveLocaleAfter.name !== out.liveLocaleBefore.name,
  'live status, die aria, or player name stayed in German after switching to French',
  { before: out.liveLocaleBefore, after: out.liveLocaleAfter });
  check(out.liveLocaleAfter.sameColumn && out.liveLocaleAfter.sentinel === 'kept'
    && out.liveLocaleAfter.children === out.liveLocaleBefore.children && geometryDelta <= 0.5,
  'locale repaint rebuilt or moved the live board',
  { before: out.liveLocaleBefore, after: out.liveLocaleAfter, geometryDelta });
  check(out.liveLocaleAfter.badge !== out.liveLocaleBefore.badge
    && out.liveLocaleAfter.sameBadge && out.liveLocaleAfter.focusedBadge
    && out.liveLocaleAfter.badgeSentinel === 'kept',
  'locale repaint replaced the focused mode chip instead of reconciling its copy in place',
  { before: out.liveLocaleBefore.badge, after: out.liveLocaleAfter });
  await page.evaluate(() => document.getElementById('languagePrevious')?.click());
  await page.waitForTimeout(150);

  const keeper = await ctx.newPage();
  await keeper.goto(F);
  await keeper.evaluate(() => localStorage.length);
  await page.reload();
  await page.waitForFunction(() => window.__kb?.S?.localeOverride === 'de'
    && document.getElementById('languageValue')?.textContent?.trim() === 'Deutsch',
    null, { timeout: 8000 }).catch(() => { /* the check below names the failure */ });
  out.languagePersist = await page.evaluate(() => ({
    override: window.__kb.S.localeOverride,
    value: document.getElementById('languageValue')?.textContent?.trim(),
    lang: document.documentElement.lang,
  }));
  await keeper.close();
  check(out.languagePersist.override === 'de' && out.languagePersist.value === 'Deutsch'
    && out.languagePersist.lang === 'de',
        'language override did not survive reload', out.languagePersist);
}
