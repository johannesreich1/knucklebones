import pkg from 'playwright';
import { serveTree } from '../../serve.mjs';
import { runLocaleBehaviorScenarios } from './scenarios/locale-behavior.mjs';
import { runLocaleGeometryScenarios } from './scenarios/locale-geometry.mjs';
import { runConstrainedSurfaceScenarios } from './scenarios/locale-surfaces.mjs';
import { runRuneRitualLockScenarios } from './scenarios/rune-ritual-lock.mjs';

const { chromium } = pkg;
const { url, stop } = await serveTree('.');
const browser = await chromium.launch();
const problems = [];
const errs = [];
const out = {};
const check = (condition, message, detail) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const attachErrors = (page, label = '') => {
  const prefix = label ? `${label} ` : '';
  page.on('pageerror', (error) => errs.push(`${prefix}PAGEERROR: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errs.push(`${prefix}CONSOLE: ${message.text()}`);
  });
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

try {
  for (const scenario of [
    ['behavior', runLocaleBehaviorScenarios],
    ['geometry', runLocaleGeometryScenarios],
    ['constrained-surfaces', runConstrainedSurfaceScenarios],
    ['rune-ritual-lock', runRuneRitualLockScenarios],
  ]) {
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
