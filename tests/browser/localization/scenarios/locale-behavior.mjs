import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { LOCALE_REGISTRY } from '../../../../src/i18n/locale.ts';

const LOCALE_BY_ID = Object.fromEntries(LOCALE_REGISTRY.map((entry) => [entry.id, entry]));
const detectionCase = (name, tags, locale) => ({
  name,
  tags,
  locale,
  languageTag: LOCALE_BY_ID[locale].languageTag,
  settings: RESOURCES[locale].game.home.settings,
});
const DETECTION_CASES = [
  detectionCase('en-GB', ['en-GB'], 'en'),
  detectionCase('pt-BR', ['pt-BR'], 'pt'),
  detectionCase('pt-PT', ['pt-PT'], 'pt'),
  detectionCase('es-MX', ['es-MX'], 'es'),
  detectionCase('de-DE', ['de-DE'], 'de'),
  detectionCase('fr-FR', ['fr-FR'], 'fr'),
  detectionCase('it-CH', ['it-CH'], 'it'),
  detectionCase('unsupported', ['nl-NL'], 'en'),
  detectionCase('mixed-order', ['nl-NL', 'fr-CA', 'de-DE'], 'fr'),
];
const GERMAN_INDEX = LOCALE_REGISTRY.findIndex(({ id }) => id === 'de');
const PREVIOUS_FROM_GERMAN = LOCALE_REGISTRY[
  (GERMAN_INDEX + LOCALE_REGISTRY.length - 1) % LOCALE_REGISTRY.length
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
      locale: document.documentElement.dataset.locale,
      rootLang: document.getElementById('kbroot')?.lang ?? '',
      settings: document.getElementById('btnSettingsHome')?.textContent?.trim() ?? '',
    }));
    out.localeDetection[scenario.name] = result;
    check(result.override === null && result.locale === scenario.locale
      && result.lang === scenario.languageTag
      && result.settings === scenario.settings,
    `${scenario.name} did not resolve to the expected base language`, { scenario, result });
    check(result.first.visible && result.first.htmlLang === scenario.languageTag
      && result.first.locale === scenario.locale
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
      firstInSettings: languageCard?.parentElement?.firstElementChild === languageCard,
      beforeSound: !!languageCard && !!soundCard
        && !!(languageCard.compareDocumentPosition(soundCard) & Node.DOCUMENT_POSITION_FOLLOWING),
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
  check(selector.value === 'Deutsch' && selector.firstInSettings && selector.beforeSound
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

  /* From automatic German, Previous selects the preceding registered locale. */
  await page.click('#languagePrevious');
  await page.waitForFunction(({ id, languageTag }) => window.__kb.S.localeOverride === id
    && document.documentElement.lang === languageTag,
  PREVIOUS_FROM_GERMAN);
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
  check(out.explicitPrecedence.override === PREVIOUS_FROM_GERMAN.id
    && out.explicitPrecedence.lang === PREVIOUS_FROM_GERMAN.languageTag
    && out.explicitPrecedence.value === PREVIOUS_FROM_GERMAN.selfName
    && out.explicitPrecedence.stored === PREVIOUS_FROM_GERMAN.id,
  'explicit language did not override a later system languagechange or save immediately',
  out.explicitPrecedence);

  await page.reload();
  await page.waitForFunction((id) => window.__kb?.S?.localeOverride === id,
    PREVIOUS_FROM_GERMAN.id);
  out.persistedOverride = await page.evaluate(() => ({
    override: window.__kb.S.localeOverride,
    lang: document.documentElement.lang,
    settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
  }));
  check(out.persistedOverride.override === PREVIOUS_FROM_GERMAN.id
    && out.persistedOverride.lang === PREVIOUS_FROM_GERMAN.languageTag
    && out.persistedOverride.settings === RESOURCES[PREVIOUS_FROM_GERMAN.id].game.home.settings,
  'persisted explicit locale did not win over the reloaded French system locale',
  out.persistedOverride);
  out.compactStatus = await page.evaluate(() => {
    const game = window.__kb;
    game.S.mode = 'duo';
    game.S.turn = 1;
    game.sayChoose();
    const status = document.getElementById('status');
    const compact = { text: status?.textContent?.trim(), label: status?.getAttribute('aria-label') };
    game.setStatus('Ordinary status', null);
    return {
      compact,
      ordinary: { text: status?.textContent?.trim(), label: status?.getAttribute('aria-label') },
    };
  });
  const compactPlayer = RESOURCES[PREVIOUS_FROM_GERMAN.id].game.player.player1;
  check(out.compactStatus.compact.text
      === RESOURCES[PREVIOUS_FROM_GERMAN.id].game.status.playerChooseCompact
        .replace('{{player}}', compactPlayer)
    && out.compactStatus.compact.label
      === RESOURCES[PREVIOUS_FROM_GERMAN.id].game.status.playerChoose
        .replace('{{player}}', compactPlayer)
    && out.compactStatus.ordinary.text === 'Ordinary status'
    && out.compactStatus.ordinary.label === null,
  'compact status did not preserve the full accessible sentence or clear it later',
  out.compactStatus);
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
    rootLocale: document.getElementById('kbroot')?.dataset.locale,
    settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
    widgetTitle: document.querySelector('#kbroot > h2.sr-only')?.textContent?.trim(),
    first: window.__kbFirstHomeFrame ?? {
      htmlLang: document.documentElement.lang,
      rootLang: document.getElementById('kbroot')?.lang,
      locale: document.getElementById('kbroot')?.dataset.locale,
      settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
      visible: !!document.getElementById('ovStart')?.getBoundingClientRect().width,
      capturedLate: true,
    },
  }));
  check(out.widgetLanguageOwnership.override === null
    && out.widgetLanguageOwnership.htmlLang === 'es-MX'
    && out.widgetLanguageOwnership.rootLang === 'de'
    && out.widgetLanguageOwnership.rootLocale === 'de'
    && out.widgetLanguageOwnership.settings === 'Einstellungen'
    && out.widgetLanguageOwnership.widgetTitle === RESOURCES.de.game.widget.title
    && out.widgetLanguageOwnership.first.htmlLang === 'es-MX'
    && out.widgetLanguageOwnership.first.rootLang === 'de'
    && out.widgetLanguageOwnership.first.locale === 'de',
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
    rootLocale: document.getElementById('kbroot')?.dataset.locale,
    settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
    widgetTitle: document.querySelector('#kbroot > h2.sr-only')?.textContent?.trim(),
  }));
  check(out.widgetLanguageChange.htmlLang === 'es-MX'
    && out.widgetLanguageChange.rootLang === 'fr'
    && out.widgetLanguageChange.rootLocale === 'fr'
    && out.widgetLanguageChange.settings === 'Paramètres'
    && out.widgetLanguageChange.widgetTitle === RESOURCES.fr.game.widget.title,
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
      locale: document.documentElement.dataset.locale,
      settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
      sameColumn: column === window.__remoteLocaleColumn,
      sentinel: column?.getAttribute('data-remote-locale-sentinel'),
      focused: document.activeElement?.id,
      stored: JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}').localeOverride,
    };
  });
  check(out.remoteLocaleOverride.first?.htmlLang === 'de'
    && out.remoteLocaleOverride.first?.locale === 'de'
    && out.remoteLocaleOverride.override === 'fr'
    && out.remoteLocaleOverride.lang === 'fr'
    && out.remoteLocaleOverride.locale === 'fr'
    && out.remoteLocaleOverride.settings === 'Paramètres'
    && out.remoteLocaleOverride.sameColumn
    && out.remoteLocaleOverride.sentinel === 'kept'
    && out.remoteLocaleOverride.focused === 'btnSettingsHome'
    && out.remoteLocaleOverride.stored === 'fr',
  'synced French override did not win over German device language in place',
  out.remoteLocaleOverride);
  await remoteContext.close();
}
