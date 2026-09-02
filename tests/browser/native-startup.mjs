import pkg from 'playwright';
import { emitReport } from '../support/emit-report.mjs';
import { runNativeAppIconScenarios } from './native-startup-app-icon.mjs';

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

const appIconObservations = await runNativeAppIconScenarios({ browser, devices, check, errs });

const orientationScenarios = [
  {
    name: 'native fine-pointer landscape window',
    platform: 'android', standalone: false,
    browserLocale: 'en-US', expectedTitle: 'PORTRAIT ONLY',
    context: { viewport: { width: 844, height: 390 }, hasTouch: false, isMobile: false },
    expectGate: true,
  },
  {
    name: 'installed mobile PWA landscape',
    platform: 'web', standalone: true,
    browserLocale: 'de-DE', expectedTitle: 'NUR HOCHFORMAT',
    context: { ...devices['iPhone 13 landscape'], hasTouch: true, isMobile: true },
    expectGate: true,
  },
  {
    name: 'ordinary mobile browser landscape',
    platform: 'web', standalone: false,
    browserLocale: 'en-US', expectedTitle: 'PORTRAIT ONLY',
    context: { ...devices['iPhone 13 landscape'], hasTouch: true, isMobile: true },
    expectGate: true,
  },
  {
    name: 'mobile landscape while a sheet is open',
    platform: 'web', standalone: false, openSheetBeforeLandscape: true,
    landscapeViewport: { width: 844, height: 390 },
    browserLocale: 'en-US', expectedTitle: 'PORTRAIT ONLY',
    context: { ...devices['iPhone 13'], hasTouch: true, isMobile: true },
    expectGate: true,
  },
  {
    name: 'touch tablet with a fine primary pointer',
    platform: 'web', standalone: true, anyCoarse: true, primaryCoarse: false,
    browserLocale: 'en-US', expectedTitle: 'PORTRAIT ONLY',
    context: { ...devices['iPad Pro 11 landscape'], hasTouch: true, isMobile: true },
    expectGate: true,
  },
  {
    name: 'touch-enabled desktop PWA landscape',
    platform: 'web', standalone: true, anyCoarse: true, primaryCoarse: false,
    browserLocale: 'en-US', expectedTitle: 'PORTRAIT ONLY',
    context: { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false },
    expectGate: false,
  },
  {
    name: 'installed desktop PWA landscape',
    platform: 'web', standalone: true,
    browserLocale: 'en-US', expectedTitle: 'PORTRAIT ONLY',
    context: { viewport: { width: 844, height: 390 }, hasTouch: false, isMobile: false },
    expectGate: false,
  },
  {
    name: 'ordinary desktop browser landscape',
    platform: 'web', standalone: false,
    browserLocale: 'en-US', expectedTitle: 'PORTRAIT ONLY',
    context: { viewport: { width: 844, height: 390 }, hasTouch: false, isMobile: false },
    expectGate: false,
  },
  {
    name: 'native portrait window',
    platform: 'ios', standalone: false,
    browserLocale: 'en-US', expectedTitle: 'PORTRAIT ONLY',
    context: { ...devices['iPhone 13'], hasTouch: true, isMobile: true },
    expectGate: false,
  },
];

const orientationObservations = [];
for (const scenario of orientationScenarios) {
  const context = await browser.newContext({ ...scenario.context, locale: scenario.browserLocale });
  await context.addInitScript(({ platform, standalone, anyCoarse, primaryCoarse }) => {
    const browserMatchMedia = window.matchMedia.bind(window);
    const fixedMedia = (query, matches) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    });
    window.matchMedia = (query) => {
      if (query === '(display-mode: standalone)') return fixedMedia(query, standalone);
      if (query === '(any-pointer:coarse)' && typeof anyCoarse === 'boolean') {
        return fixedMedia(query, anyCoarse);
      }
      if (query === '(pointer:coarse)' && typeof primaryCoarse === 'boolean') {
        return fixedMedia(query, primaryCoarse);
      }
      return browserMatchMedia(query);
    };
    window.Capacitor = {
      getPlatform: () => platform,
      Plugins: { SplashScreen: { hide: async () => undefined } },
    };
  }, {
    platform: scenario.platform,
    standalone: scenario.standalone,
    anyCoarse: scenario.anyCoarse,
    primaryCoarse: scenario.primaryCoarse,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errs.push(`${scenario.name} PAGEERROR: ${error.message}`));
  await page.goto(`file://${process.cwd()}/knucklebones-neon.html`);
  await page.waitForFunction(() => !!window.__kb);
  if (scenario.openSheetBeforeLandscape) {
    await page.evaluate(() => window.__kb.newGame());
    await page.click('#btnLeave');
    await page.waitForSelector('.faceoff .focard');
    await page.setViewportSize(scenario.landscapeViewport);
  }
  const state = await page.evaluate(() => {
    const root = document.getElementById('kbroot');
    const gate = root?.querySelector('.portrait-gate');
    const home = document.getElementById('ovStart');
    const gateStyle = gate ? getComputedStyle(gate) : null;
    const rect = gate?.getBoundingClientRect();
    /* A room can be inside its ordinary .28s exit when rotation lands, so its
       raw `visibility` is not the release boundary. Prove the opaque gate owns
       the pixels and input across the whole viewport — the fact the player
       can actually observe. */
    const samplePoints = [
      [2, 2], [innerWidth - 2, 2],
      [innerWidth / 2, innerHeight / 2],
      [2, innerHeight - 2], [innerWidth - 2, innerHeight - 2],
    ];
    const viewportHits = samplePoints.map(([x, y]) => document.elementFromPoint(x, y));
    const centerHit = viewportHits[2];
    const gateOwns = (hit) => !!gate && !!hit && (hit === gate || gate.contains(hit));
    const homeOwns = (hit) => !!home && !!hit && (hit === home || home.contains(hit));
    const background = gateStyle?.backgroundColor ?? '';
    return {
      rootClasses: root?.className ?? null,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      coarse: matchMedia('(pointer:coarse)').matches,
      anyCoarse: matchMedia('(any-pointer:coarse)').matches,
      gateVisible: gateStyle?.display !== 'none' && gateStyle?.visibility !== 'hidden'
        && !!rect && rect.width > 0 && rect.height > 0,
      gateInert: gate instanceof HTMLElement ? gate.inert : null,
      gateCoversViewport: !!rect && rect.left <= 0 && rect.top <= 0
        && rect.right >= innerWidth && rect.bottom >= innerHeight,
      gateOwnsViewportHits: viewportHits.every(gateOwns),
      /* Chromium serializes a fully opaque sRGB background as rgb(...).
         rgba(...) or the modern slash form would mean the blocked app could
         still show through even though the gate owns every hit point. */
      gateBackgroundOpaque: background.startsWith('rgb(') && !background.includes('/'),
      centerHit: centerHit instanceof HTMLElement
        ? { tag: centerHit.tagName, id: centerHit.id, classes: centerHit.className }
        : null,
      homeOwnsCenterHit: homeOwns(centerHit),
      sheetOpen: !!document.querySelector('.faceoff .focard'),
      role: gate?.getAttribute('role') ?? null,
      live: gate?.getAttribute('aria-live') ?? null,
      title: gate?.querySelector('b')?.textContent?.trim() ?? null,
    };
  });
  orientationObservations.push({ scenario: scenario.name, state });
  check(state.gateVisible === scenario.expectGate,
    `${scenario.name}: portrait gate visibility did not match the release boundary`, state);
  check(scenario.expectGate
    ? state.gateCoversViewport && state.gateOwnsViewportHits && state.gateBackgroundOpaque
    : state.homeOwnsCenterHit,
  `${scenario.name}: the player-visible surface did not match the portrait gate`, state);
  check(!scenario.expectGate || state.gateInert === false,
    `${scenario.name}: visible portrait status was left inert by a modal background`, state);
  check(!scenario.openSheetBeforeLandscape || state.sheetOpen,
    `${scenario.name}: modal coverage did not keep a real sheet open during rotation`, state);
  check(state.role === 'status' && state.live === 'polite'
    && state.title === scenario.expectedTitle,
    `${scenario.name}: portrait gate lost its localized accessible status`, state);
  await context.close();
}

await browser.close();
emitReport({ observations, appIconObservations, orientationObservations, problems, errs },
  problems.length || errs.length);
