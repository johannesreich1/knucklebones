import pkg from 'playwright';
import { emitReport } from '../support/emit-report.mjs';

const { chromium, devices } = pkg;
const browser = await chromium.launch();
const problems = [];
const errs = [];
const check = (condition, message, detail) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const scenarios = [
  {
    name: 'German device language',
    platform: 'android',
    browserLocale: 'de-DE',
    persistedOverride: null,
    expectedLocale: 'de',
    expected: {
      online: 'Ranglistenspiel',
      settings: 'Einstellungen',
      practice: 'Offline üben',
      howToPlay: 'Spielregeln',
      account: 'NICHT ANGEMELDET',
    },
  },
  {
    name: 'French device language',
    platform: 'ios',
    browserLocale: 'fr-FR',
    persistedOverride: null,
    expectedLocale: 'fr',
    expected: {
      online: 'Partie classée',
      settings: 'Paramètres',
      practice: 'Jouer hors ligne',
      howToPlay: 'Comment jouer',
      account: 'NON CONNECTÉ',
    },
  },
  {
    name: 'persisted French override on a German device',
    platform: 'android',
    browserLocale: 'de-DE',
    persistedOverride: 'fr',
    expectedLocale: 'fr',
    expected: {
      online: 'Partie classée',
      settings: 'Paramètres',
      practice: 'Jouer hors ligne',
      howToPlay: 'Comment jouer',
      account: 'NON CONNECTÉ',
    },
  },
];

const observations = [];
for (const scenario of scenarios) {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    hasTouch: true,
    isMobile: true,
    locale: scenario.browserLocale,
  });
  await context.addInitScript(({ persistedOverride, platform }) => {
    try {
      if (persistedOverride === null) {
        localStorage.removeItem('knucklebones.v1');
      } else {
        localStorage.setItem('knucklebones.v1', JSON.stringify({
          localeOverride: persistedOverride,
        }));
      }
    } catch { /* a file host may be forgetful; the assertion below catches it */ }

    window.__nativeSplashHides = [];
    window.Capacitor = {
      getPlatform: () => platform,
      Plugins: {
        SplashScreen: {
          hide: async (options) => {
            const home = document.getElementById('ovStart');
            const root = document.getElementById('kbroot');
            const duel = document.getElementById('homeDuel');
            const style = home ? getComputedStyle(home) : null;
            const rect = home?.getBoundingClientRect();
            window.__nativeSplashHides.push({
              options,
              rootPresent: !!root,
              hooksPresent: !!window.__kb,
              homeClasses: home?.className ?? null,
              homeDisplay: style?.display ?? null,
              homeVisibility: style?.visibility ?? null,
              homeOpacity: style?.opacity ?? null,
              homeWidth: rect?.width ?? 0,
              homeHeight: rect?.height ?? 0,
              duelDice: duel?.querySelectorAll('.die').length ?? 0,
              documentLang: document.documentElement.lang,
              rootOwnsLang: root?.hasAttribute('lang') ?? false,
              navigatorLanguages: [...navigator.languages],
              platform: window.Capacitor.getPlatform(),
              homeCopy: {
                online: document.getElementById('btnOnline')?.textContent?.trim() ?? null,
                settings: document.getElementById('btnSettingsHome')?.textContent?.trim() ?? null,
                practice: home?.querySelector('.quiet .cap')?.textContent?.trim() ?? null,
                howToPlay: document.getElementById('btnLearn')?.textContent?.trim() ?? null,
                account: document.getElementById('homeChip')?.textContent?.trim() ?? null,
              },
            });
          },
        },
      },
    };
  }, { persistedOverride: scenario.persistedOverride, platform: scenario.platform });

  const page = await context.newPage();
  page.on('pageerror', (error) => errs.push(`${scenario.name} PAGEERROR: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errs.push(`${scenario.name} CONSOLE: ${message.text()}`);
  });
  await page.goto(`file://${process.cwd()}/knucklebones-neon.html`);
  await page.waitForFunction(() => window.__nativeSplashHides?.length > 0);
  await page.waitForTimeout(100);

  const hides = await page.evaluate(() => window.__nativeSplashHides);
  observations.push({ scenario: scenario.name, hides });
  check(hides.length === 1, `${scenario.name}: native splash did not hide exactly once`, hides);
  const atHide = hides[0] ?? {};
  check(atHide.options?.fadeOutDuration === 200,
    `${scenario.name}: native splash did not use the configured 200 ms fade`, atHide);
  check(atHide.rootPresent && atHide.hooksPresent && /\bon\b/.test(atHide.homeClasses ?? '')
    && atHide.homeDisplay !== 'none' && atHide.homeVisibility === 'visible'
    && Number(atHide.homeOpacity) > 0 && atHide.homeWidth > 0 && atHide.homeHeight > 0
    && atHide.duelDice === 2,
  `${scenario.name}: native splash hid before the boot-composed Home was visibly ready`, atHide);
  check(atHide.documentLang === scenario.expectedLocale && !atHide.rootOwnsLang,
    `${scenario.name}: native document language ownership was not ready before splash hide`, atHide);
  check(JSON.stringify(atHide.homeCopy) === JSON.stringify(scenario.expected),
    `${scenario.name}: localized Home copy was not ready before splash hide`, atHide);
  check(atHide.navigatorLanguages?.[0] === scenario.browserLocale,
    `${scenario.name}: browser locale setup did not reach the WebView`, atHide);
  check(atHide.platform === scenario.platform,
    `${scenario.name}: scenario did not exercise the intended native platform`, atHide);
  await context.close();
}

await browser.close();
emitReport({ observations, problems, errs }, problems.length || errs.length);
