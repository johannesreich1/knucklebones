import pkg from 'playwright';
import { serveTree } from '../../serve.mjs';
import { createBrowserReport, capturePageErrors } from '../../support/browser-report.mjs';
import { checkRenderingFont } from '../../support/rendering-font.mjs';
import { LOCALE_IDS } from './harness/locale-control.mjs';
import { requiredHomeTargets } from './harness/surface-readiness.mjs';
import { LOCALE_REGISTRY } from '../../../src/i18n/locale.ts';
import { RESOURCES } from '../../../src/i18n/catalogs.ts';
import { runLocaleBehaviorScenarios } from './scenarios/locale-behavior.mjs';
import { runLocaleGeometryScenarios } from './scenarios/locale-geometry.mjs';
import { runConstrainedSurfaceScenarios } from './scenarios/locale-surfaces.mjs';
import { runRuneRitualLockScenarios } from './scenarios/rune-ritual-lock.mjs';

/* Two run shapes. The no-argument run is the exhaustive geometry matrix,
   deliberately manual-only (see gate-manifest.mjs). `--smoke` is the cheap
   rot guard the gate keeps: one locale, one viewport, proving the server,
   the harness modules, and the i18n exports this tree stands on still fit
   together — so a refactor cannot silently strand the manual matrix. */
const argv = process.argv.slice(2);
const smoke = argv.length === 1 && argv[0] === '--smoke';
if (argv.length && !smoke) {
  console.error('Usage: run.mjs [--smoke]');
  process.exit(2);
}

const { chromium } = pkg;
const { url, stop } = await serveTree('.');
const browser = await chromium.launch();
const { problems, errs, out, check } = createBrowserReport();

const attachErrors = (page, label = '') => {
  capturePageErrors(page, errs, label, { console: true });
  return page;
};

/**
 * Create one isolated browser/device-language world. The mutable getter is a
 * test substitute for the platform changing its ordered language list before
 * dispatching `languagechange`; production still reads Navigator directly.
 */
async function localeContext(tags, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(({ initialTags, hostLanguage }) => {
    window.__kbTestLanguageTags = [...initialTags];
    Object.defineProperty(Navigator.prototype, 'languages', {
      configurable: true,
      get: () => [...window.__kbTestLanguageTags],
    });
    Object.defineProperty(Navigator.prototype, 'language', {
      configurable: true,
      get: () => window.__kbTestLanguageTags[0] ?? '',
    });
    try { delete Navigator.prototype.serviceWorker; } catch { /* strict hosts keep it */ }

    try {
      const key = 'knucklebones.v1';
      const current = JSON.parse(localStorage.getItem(key) || '{}');
      current.played = true;
      localStorage.setItem(key, JSON.stringify(current));
    } catch { /* the page-origin storage check will name any real failure */ }

    if (hostLanguage) {
      const applyHostLanguage = () => {
        if (!document.documentElement) return false;
        document.documentElement.lang = hostLanguage;
        return true;
      };
      if (!applyHostLanguage()) {
        const observer = new MutationObserver(() => {
          if (applyHostLanguage()) observer.disconnect();
        });
        observer.observe(document, { childList: true });
      }
    }

    window.__kbFirstHomeFrame = null;
    let frameQueued = false;
    const queueFirstHomeFrame = () => {
      if (frameQueued || window.__kbFirstHomeFrame || !document.getElementById('ovStart')) return;
      frameQueued = true;
      requestAnimationFrame(() => {
        frameQueued = false;
        if (window.__kbFirstHomeFrame) return;
        const home = document.getElementById('ovStart');
        const root = document.getElementById('kbroot');
        const style = home ? getComputedStyle(home) : null;
        const rect = home?.getBoundingClientRect();
        window.__kbFirstHomeFrame = {
          htmlLang: document.documentElement.lang,
          locale: document.documentElement.dataset.locale ?? root?.dataset.locale ?? '',
          rootLang: root?.lang ?? '',
          settings: document.getElementById('btnSettingsHome')?.textContent?.trim() ?? '',
          visible: !!home && style?.display !== 'none' && style?.visibility === 'visible'
            && Number(style?.opacity ?? 0) > 0 && !!rect && rect.width > 0 && rect.height > 0,
        };
      });
    };
    new MutationObserver(queueFirstHomeFrame).observe(document, { childList: true, subtree: true });
    queueFirstHomeFrame();
  }, { initialTags: [...tags], hostLanguage: options.hostLanguage ?? '' });
  return context;
}

const suite = {
  browser,
  standaloneUrl: `${url}knucklebones-neon.html`,
  widgetUrl: `${url}harness.html`,
  problems,
  errs,
  out,
  check,
  attachErrors,
  localeContext,
};

/* German is the registry's long-copy stress locale; one boot on the default
   phone viewport is enough to prove the plumbing without re-measuring the
   matrix the manual pass owns. */
async function runLocaleSmokeScenario({ standaloneUrl }) {
  const registered = LOCALE_REGISTRY.find(({ id }) => id === 'de');
  check(LOCALE_IDS.includes('de') && !!registered,
    'the smoke locale left the registry — point the smoke at a registered locale', LOCALE_IDS);
  if (!registered) return;
  const context = await localeContext(['de-DE']);
  const page = attachErrors(await context.newPage(), 'smoke');
  await page.goto(standaloneUrl);
  await page.waitForFunction(() => window.__kb && window.__kbFirstHomeFrame);
  const result = await page.evaluate(() => ({
    first: window.__kbFirstHomeFrame,
    locale: document.documentElement.dataset.locale,
    lang: document.documentElement.lang,
    settings: document.getElementById('btnSettingsHome')?.textContent?.trim() ?? '',
  }));
  const home = await requiredHomeTargets(page);
  out.smoke = { ...result, targets: home.targets };
  check(result.locale === 'de' && result.lang === registered.languageTag
    && result.settings === RESOURCES.de.game.home.settings,
  'the German device language did not localize the served standalone build', result);
  check(result.first.visible && result.first.locale === 'de',
    'the first Home frame was not visible and localized', result.first);
  check(home.complete,
    'the localized Home did not render its required targets', home.targets);
  await context.close();
}

const scenarios = smoke ? [['smoke', runLocaleSmokeScenario]] : [
  ['behavior', runLocaleBehaviorScenarios],
  ['geometry', runLocaleGeometryScenarios],
  ['constrained-surfaces', runConstrainedSurfaceScenarios],
  ['rune-ritual-lock', runRuneRitualLockScenarios],
];

/* This tree measures wrapped titles, clipped surfaces and 44px hit targets —
   all of them font metrics. On a host rendering a face the app never names
   those numbers describe nobody's phone, so say so instead of reporting a
   translation as too long. See tests/support/rendering-font.mjs. */
{
  const page = await browser.newPage();
  const font = await checkRenderingFont(page);
  out.font = font;
  check(!font.problem,
    'not rendering in a font the app names, so every geometry number below is '
    + 'measured against a face no player has', font);
  await page.close();
}

try {
  for (const scenario of scenarios) {
    try {
      await scenario[1](suite);
    } catch (error) {
      problems.push(`${scenario[0]} THREW :: ${error?.stack ?? error}`);
    }
  }
} finally {
  await browser.close();
  stop();
}

console.log(JSON.stringify({ out, problems, errs }, null, 2));
process.exitCode = problems.length || errs.length ? 1 : 0;
