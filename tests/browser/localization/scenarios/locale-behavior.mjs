const DETECTION_CASES = [
  { name: 'de-DE', tags: ['de-DE'], locale: 'de', settings: 'Einstellungen' },
  { name: 'fr-FR', tags: ['fr-FR'], locale: 'fr', settings: 'Paramètres' },
  { name: 'en-GB', tags: ['en-GB'], locale: 'en', settings: 'Settings' },
  { name: 'en-US', tags: ['en-US'], locale: 'en', settings: 'Settings' },
  { name: 'unsupported', tags: ['es-MX', 'it-IT'], locale: 'en', settings: 'Settings' },
  { name: 'mixed-order', tags: ['es-MX', 'fr-CA', 'de-DE'], locale: 'fr', settings: 'Paramètres' },
];
const SUPABASE_AUTH_STORAGE_KEY = 'sb-euzjcejbkxvqfrttgaxu-auth-token';

const nextFrame = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

export async function runLocaleBehaviorScenarios(suite) {
  const { standaloneUrl, widgetUrl, out, check, attachErrors, localeContext } = suite;
  out.localeDetection = {};

  for (const scenario of DETECTION_CASES) {
    const context = await localeContext(scenario.tags);
    const page = attachErrors(await context.newPage(), scenario.name);
    await page.goto(standaloneUrl);
    await page.waitForFunction(() => window.__kb && window.__kbFirstHomeFrame);
    const result = await page.evaluate(() => ({
      first: window.__kbFirstHomeFrame,
      override: window.__kb.S.localeOverride,
      lang: document.documentElement.lang,
      rootLang: document.getElementById('kbroot')?.lang ?? '',
      settings: document.getElementById('btnSettingsHome')?.textContent?.trim() ?? '',
    }));
    out.localeDetection[scenario.name] = result;
    check(result.override === null && result.lang === scenario.locale
      && result.settings === scenario.settings,
    `${scenario.name} did not resolve to the expected base language`, { scenario, result });
    check(result.first.visible && result.first.htmlLang === scenario.locale
      && result.first.settings === scenario.settings,
    `${scenario.name} exposed an untranslated or incorrectly tagged first Home frame`, result.first);
    await context.close();
  }

  /* Automatic follows `languagechange`; the first arrow creates an explicit
     setting, after which platform changes and reloads may not dislodge it. */
  const context = await localeContext(['fr-FR']);
  const page = attachErrors(await context.newPage(), 'locale-precedence');
  await page.goto(standaloneUrl);
  await page.waitForFunction(() => window.__kb && document.documentElement.lang === 'fr');
  await page.evaluate(() => {
    window.__kbTestLanguageTags = ['de-DE'];
    window.dispatchEvent(new Event('languagechange'));
  });
  await page.waitForFunction(() => document.documentElement.lang === 'de');
  out.automaticLanguageChange = await page.evaluate(() => ({
    override: window.__kb.S.localeOverride,
    lang: document.documentElement.lang,
    settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
  }));
  check(out.automaticLanguageChange.override === null
    && out.automaticLanguageChange.lang === 'de'
    && out.automaticLanguageChange.settings === 'Einstellungen',
  'automatic locale did not repaint after languagechange', out.automaticLanguageChange);

  await page.click('#btnSettingsHome');
  await page.waitForSelector('#ovSettings.on');
  await page.locator('#languagePicker').scrollIntoViewIfNeeded();
  const selector = await page.evaluate(() => {
    const picker = document.getElementById('languagePicker');
    const previous = document.getElementById('languagePrevious');
    const next = document.getElementById('languageNext');
    const value = document.getElementById('languageValue');
    const languageCard = picker?.closest('.card');
    const soundCard = document.getElementById('sndSeg')?.closest('.card');
    const rect = (element) => element?.getBoundingClientRect();
    const p = rect(picker), v = rect(value), left = rect(previous), right = rect(next);
    const hit = (element, box) => !!element && !!box
      && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
    return {
      value: value?.textContent?.trim(),
      directBeforeSound: languageCard?.nextElementSibling === soundCard,
      visibleAutomaticChoice: /system|automatic|automatisch|système|automatique/iu
        .test(picker?.textContent ?? ''),
      live: value?.getAttribute('aria-live'),
      atomic: value?.getAttribute('aria-atomic'),
      centred: p && v ? Math.abs((p.x + p.width / 2) - (v.x + v.width / 2)) : null,
      previous: {
        tag: previous?.tagName,
        label: previous?.getAttribute('aria-label'),
        width: left?.width,
        height: left?.height,
        hit: hit(previous, left),
      },
      next: {
        tag: next?.tagName,
        label: next?.getAttribute('aria-label'),
        width: right?.width,
        height: right?.height,
        hit: hit(next, right),
      },
    };
  });
  out.languageSelector = selector;
  check(selector.value === 'Deutsch' && selector.directBeforeSound
    && !selector.visibleAutomaticChoice && selector.live === 'polite' && selector.atomic === 'true',
  'language selector position, value, or live-region contract is wrong', selector);
  check(selector.previous.tag === 'BUTTON' && selector.next.tag === 'BUTTON'
    && selector.previous.label === 'Vorherige Sprache'
    && selector.next.label === 'Nächste Sprache'
    && selector.previous.width >= 44 && selector.previous.height >= 44
    && selector.next.width >= 44 && selector.next.height >= 44
    && selector.previous.hit && selector.next.hit
    && selector.centred !== null && selector.centred <= 0.5,
  'language arrows are not localized, centred, accessible 44px controls', selector);

  await page.locator('#languagePrevious').focus();
  await page.keyboard.press('Tab');
  out.languageKeyboardFocus = await page.evaluate(() => {
    const active = document.activeElement;
    const style = active ? getComputedStyle(active) : null;
    return {
      id: active?.id,
      focusVisible: active?.matches(':focus-visible') ?? false,
      outlineStyle: style?.outlineStyle,
      outlineWidth: style?.outlineWidth,
    };
  });
  check(out.languageKeyboardFocus.id === 'languageNext'
    && out.languageKeyboardFocus.focusVisible
    && out.languageKeyboardFocus.outlineStyle !== 'none'
    && parseFloat(out.languageKeyboardFocus.outlineWidth) >= 2,
  'language arrows do not retain visible keyboard focus', out.languageKeyboardFocus);

  /* From automatic German, Previous selects explicit English. */
  await page.click('#languagePrevious');
  await page.waitForFunction(() => window.__kb.S.localeOverride === 'en'
    && document.documentElement.lang === 'en');
  await page.evaluate(() => {
    window.__kbTestLanguageTags = ['fr-FR'];
    window.dispatchEvent(new Event('languagechange'));
  });
  await nextFrame(page);
  out.explicitPrecedence = await page.evaluate(() => ({
    override: window.__kb.S.localeOverride,
    lang: document.documentElement.lang,
    value: document.getElementById('languageValue')?.textContent?.trim(),
    stored: JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}').localeOverride,
  }));
  check(out.explicitPrecedence.override === 'en' && out.explicitPrecedence.lang === 'en'
    && out.explicitPrecedence.value === 'English' && out.explicitPrecedence.stored === 'en',
  'explicit language did not override a later system languagechange or save immediately',
  out.explicitPrecedence);

  await page.reload();
  await page.waitForFunction(() => window.__kb?.S?.localeOverride === 'en');
  out.persistedOverride = await page.evaluate(() => ({
    override: window.__kb.S.localeOverride,
    lang: document.documentElement.lang,
    settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
  }));
  check(out.persistedOverride.override === 'en' && out.persistedOverride.lang === 'en'
    && out.persistedOverride.settings === 'Settings',
  'persisted explicit English did not win over the reloaded French system locale',
  out.persistedOverride);
  await context.close();

  const widgetContext = await localeContext(['de-DE'], {
    viewport: { width: 406, height: 680 },
    hostLanguage: 'es-MX',
  });
  const widget = attachErrors(await widgetContext.newPage(), 'widget-locale');
  await widget.goto(widgetUrl);
  await widget.waitForFunction(() => window.__kb);
  await nextFrame(widget);
  out.widgetLanguageOwnership = await widget.evaluate(() => ({
    override: window.__kb.S.localeOverride,
    htmlLang: document.documentElement.lang,
    rootLang: document.getElementById('kbroot')?.lang,
    settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
    first: window.__kbFirstHomeFrame ?? {
      htmlLang: document.documentElement.lang,
      rootLang: document.getElementById('kbroot')?.lang,
      settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
      visible: !!document.getElementById('ovStart')?.getBoundingClientRect().width,
      capturedLate: true,
    },
  }));
  check(out.widgetLanguageOwnership.override === null
    && out.widgetLanguageOwnership.htmlLang === 'es-MX'
    && out.widgetLanguageOwnership.rootLang === 'de'
    && out.widgetLanguageOwnership.settings === 'Einstellungen'
    && out.widgetLanguageOwnership.first.htmlLang === 'es-MX'
    && out.widgetLanguageOwnership.first.rootLang === 'de',
  'widget changed its host language or failed to own its localized root',
  out.widgetLanguageOwnership);

  await widget.evaluate(() => {
    window.__kbTestLanguageTags = ['fr-FR'];
    window.dispatchEvent(new Event('languagechange'));
  });
  await widget.waitForFunction(() => document.getElementById('kbroot')?.lang === 'fr');
  out.widgetLanguageChange = await widget.evaluate(() => ({
    htmlLang: document.documentElement.lang,
    rootLang: document.getElementById('kbroot')?.lang,
    settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
  }));
  check(out.widgetLanguageChange.htmlLang === 'es-MX'
    && out.widgetLanguageChange.rootLang === 'fr'
    && out.widgetLanguageChange.settings === 'Paramètres',
  'widget languagechange leaked to the host or failed to repaint its root',
  out.widgetLanguageChange);
  await widgetContext.close();

  /* Browser integration for the account path: first paint follows the German
     device, then a delayed existing player_settings row applies French in
     place. Unit tests own the race matrix; this proves the real lazy Supabase
     client, persistence and DOM-root subscription are wired together. */
  const remoteContext = await localeContext(['de-DE']);
  const remoteUser = '00000000-0000-4000-8000-00000000f123';
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const remoteSession = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: remoteUser,
      aud: 'authenticated',
      role: 'authenticated',
      is_anonymous: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.stub`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'stub',
    user: {
      id: remoteUser,
      aud: 'authenticated',
      role: 'authenticated',
      email: null,
      is_anonymous: true,
      created_at: '2026-08-24T00:00:00Z',
      app_metadata: {},
      user_metadata: {},
      identities: [],
    },
  };
  await remoteContext.addInitScript(([storageKey, session]) => {
    localStorage.setItem(storageKey, JSON.stringify(session));
  }, [SUPABASE_AUTH_STORAGE_KEY, remoteSession]);
  const remote = attachErrors(await remoteContext.newPage(), 'remote-locale');
  let releaseRemote;
  let markRemoteRead;
  const remoteGate = new Promise((resolve) => { releaseRemote = resolve; });
  const remoteRead = new Promise((resolve) => { markRemoteRead = resolve; });
  await remote.route('**/auth/v1/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(route.request().url().includes('/user')
      ? remoteSession.user : remoteSession),
  }));
  await remote.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    if (request.url().includes('/player_settings')) {
      if (request.method() !== 'GET') {
        return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
      }
      markRemoteRead();
      await remoteGate;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
        user_id: remoteUser,
        locale: 'fr',
        sound: true,
        numerals: false,
        p1_hue: 'cy',
        p2_hue: 'mg',
        colorblind: false,
        reduced_motion: false,
      }]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await remote.goto(standaloneUrl);
  await remote.waitForFunction(() => window.__kb && document.documentElement.lang === 'de');
  await Promise.race([
    remoteRead,
    new Promise((_, reject) => setTimeout(() => reject(new Error('remote locale read did not start')), 8000)),
  ]);
  await remote.evaluate(() => {
    const column = document.querySelector('#topBoard .col');
    window.__remoteLocaleColumn = column;
    column?.setAttribute('data-remote-locale-sentinel', 'kept');
    document.getElementById('btnSettingsHome')?.focus();
  });
  releaseRemote();
  await remote.waitForFunction(() => window.__kb.S.localeOverride === 'fr'
    && document.documentElement.lang === 'fr');
  out.remoteLocaleOverride = await remote.evaluate(() => {
    const column = document.querySelector('#topBoard .col');
    return {
      first: window.__kbFirstHomeFrame,
      override: window.__kb.S.localeOverride,
      lang: document.documentElement.lang,
      settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
      sameColumn: column === window.__remoteLocaleColumn,
      sentinel: column?.getAttribute('data-remote-locale-sentinel'),
      focused: document.activeElement?.id,
      stored: JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}').localeOverride,
    };
  });
  check(out.remoteLocaleOverride.first?.htmlLang === 'de'
    && out.remoteLocaleOverride.override === 'fr'
    && out.remoteLocaleOverride.lang === 'fr'
    && out.remoteLocaleOverride.settings === 'Paramètres'
    && out.remoteLocaleOverride.sameColumn
    && out.remoteLocaleOverride.sentinel === 'kept'
    && out.remoteLocaleOverride.focused === 'btnSettingsHome'
    && out.remoteLocaleOverride.stored === 'fr',
  'synced French override did not win over German device language in place',
  out.remoteLocaleOverride);
  await remoteContext.close();
}
