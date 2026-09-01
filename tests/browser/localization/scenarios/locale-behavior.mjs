import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { LOCALE_REGISTRY } from '../../../../src/i18n/locale.ts';
import { frame } from '../harness/layout-inspection.mjs';
import { readWidgetLocaleOwnership } from '../harness/widget-locale-ownership.mjs';
import { readRemoteLocaleSync } from '../harness/remote-locale-sync.mjs';

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
  detectionCase('pl-PL', ['pl-PL'], 'pl'),
  detectionCase('tr-TR', ['tr-TR'], 'tr'),
  detectionCase('id-ID', ['id-ID'], 'id'),
  detectionCase('ja-JP', ['ja-JP'], 'ja'),
  detectionCase('ko-KR', ['ko-KR'], 'ko'),
  detectionCase('unsupported', ['nl-NL'], 'en'),
  detectionCase('mixed-order', ['nl-NL', 'fr-CA', 'de-DE'], 'fr'),
];
const GERMAN_INDEX = LOCALE_REGISTRY.findIndex(({ id }) => id === 'de');
const PREVIOUS_FROM_GERMAN = LOCALE_REGISTRY[
  (GERMAN_INDEX + LOCALE_REGISTRY.length - 1) % LOCALE_REGISTRY.length
];

export async function runLocaleBehaviorScenarios(suite) {
  const { standaloneUrl, out, check, attachErrors, localeContext } = suite;
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
  await frame(page);
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

  const widget = await readWidgetLocaleOwnership(suite);
  out.widgetLanguageOwnership = widget.ownership;
  out.widgetLanguageChange = widget.change;
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

  check(out.widgetLanguageChange.htmlLang === 'es-MX'
    && out.widgetLanguageChange.rootLang === 'fr'
    && out.widgetLanguageChange.rootLocale === 'fr'
    && out.widgetLanguageChange.settings === 'Paramètres'
    && out.widgetLanguageChange.widgetTitle === RESOURCES.fr.game.widget.title,
  'widget languagechange leaked to the host or failed to repaint its root',
  out.widgetLanguageChange);

  out.remoteLocaleOverride = await readRemoteLocaleSync(suite);
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
}
