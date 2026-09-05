import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startCaptureServer } from './capture-server.mjs';
import { LOCALE_REGISTRY } from '../../../src/i18n/locale.ts';

/* WHICH LOCALES THE RUNTIME ACTUALLY SHIPS — read from the app's own registry,
   not restated here. This was a hard-coded list of eight, and it silently went
   stale when the app grew to eleven: pt-BR, es-ES and it were added to
   app-store-connect.json but the campaign could not capture them, so three
   store languages have never had screenshots. A list that has to be edited in
   step with another file eventually is not. */
const SHIPPED_RUNTIME_LOCALES = new Set(LOCALE_REGISTRY.map((locale) => locale.id));

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../..');
const manifest = JSON.parse(await readFile(path.join(here, 'manifest.json'), 'utf8'));
const appStoreConfig = JSON.parse(await readFile(path.join(here, 'app-store-connect.json'), 'utf8'));
const playwrightPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'node_modules/playwright/package.json'), 'utf8'));

const requireFact = (condition, message) => {
  if (!condition) throw new Error(message);
};

requireFact(manifest.schemaVersion === 2, 'Automated App Store capture requires manifest schemaVersion 2');
requireFact(Array.isArray(manifest.targets) && manifest.targets.length > 0,
  'Screenshot manifest has no targets');
requireFact(manifest.localizations && typeof manifest.localizations === 'object',
  'Screenshot manifest has no localizations');
requireFact(Array.isArray(manifest.slides) && manifest.slides.length > 0,
  'Screenshot manifest has no slides');

const configuredLocales = appStoreConfig.locales?.map((locale) => locale.appStoreLocale) ?? [];
requireFact(JSON.stringify(Object.keys(manifest.localizations)) === JSON.stringify(configuredLocales),
  'Screenshot manifest locales must exactly match app-store-connect.json in campaign order');

for (const target of manifest.targets) {
  requireFact(Number.isInteger(target.width) && Number.isInteger(target.height),
    `${target.id} has invalid canvas dimensions`);
  requireFact(Number.isInteger(target.runtimeViewport?.width)
      && Number.isInteger(target.runtimeViewport?.height),
    `${target.id} has invalid production runtime viewport dimensions`);
}

for (const [appStoreLocale, localization] of Object.entries(manifest.localizations)) {
  const configured = appStoreConfig.locales.find((locale) => locale.appStoreLocale === appStoreLocale);
  requireFact(configured?.runtimeLocale === localization.runtimeLocale,
    `${appStoreLocale} runtime locale differs from app-store-connect.json`);
  requireFact(SHIPPED_RUNTIME_LOCALES.has(localization.runtimeLocale),
    `${appStoreLocale} has unsupported runtime locale ${JSON.stringify(localization.runtimeLocale)}`);
  const copySlugs = Object.keys(localization.slides ?? {}).sort();
  const slideSlugs = manifest.slides.map((slide) => slide.slug).sort();
  requireFact(JSON.stringify(copySlugs) === JSON.stringify(slideSlugs),
    `${appStoreLocale} localized slide keys differ from the campaign slides`);
}

const running = await startCaptureServer();
const browser = await chromium.launch();
const chromiumVersion = browser.version();
const captured = [];
const buildTags = new Set();

try {
  for (const [appStoreLocale] of Object.entries(manifest.localizations)) {
    const context = await browser.newContext({ locale: appStoreLocale, deviceScaleFactor: 1 });
    try {
      for (const target of manifest.targets) {
        for (const slide of manifest.slides) {
          const variants = slide.composite
            ? [...new Set(['hero', slide.composite.baseVariant, slide.composite.overlayVariant])]
            : ['hero'];
          for (const variant of variants) {
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
            page.on('console', (message) => {
              if (message.type() !== 'error') return;
              const source = message.location().url;
              errors.push(`console${source ? ` (${source})` : ''}: ${message.text()}`);
            });
            try {
              await page.setViewportSize({ width: target.width, height: target.height });
              const query = new URLSearchParams({
                slide: String(slide.index),
                locale: appStoreLocale,
                target: target.id,
                variant,
              });
              await page.goto(`${running.url}/marketing/app-store/ios/source.html?${query}`, {
                waitUntil: 'domcontentloaded',
                timeout: 30_000,
              });
              await page.waitForFunction(() => ['1', 'error'].includes(document.body.dataset.ready ?? ''),
                undefined, { timeout: 30_000 });
              const state = await page.evaluate(() => {
                const frame = document.getElementById('runtime');
                return {
                  ready: document.body.dataset.ready,
                  error: document.getElementById('error')?.textContent ?? '',
                  locale: document.body.dataset.locale,
                  runtimeLocale: document.body.dataset.runtimeLocale,
                  target: document.body.dataset.target,
                  slide: document.body.dataset.slide,
                  slug: document.body.dataset.slug,
                  variant: document.body.dataset.variant,
                  viewport: `${innerWidth}x${innerHeight}`,
                  runtimeViewport: frame?.contentWindow
                    ? `${frame.contentWindow.innerWidth}x${frame.contentWindow.innerHeight}` : '',
                  runtimeBuild: frame?.contentDocument?.documentElement.dataset.build ?? '',
                };
              });
              requireFact(state.ready === '1', state.error || `Capture source failed for ${query}`);
              requireFact(errors.length === 0,
                `${appStoreLocale}/${target.id}/${slide.slug}/${variant} emitted ${errors.join(' | ')}`);
              requireFact(state.locale === appStoreLocale && state.target === target.id
                  && state.slide === String(slide.index) && state.slug === slide.slug
                  && state.variant === variant,
                `Capture source resolved a different selection: ${JSON.stringify(state)}`);
              requireFact(state.viewport === `${target.width}x${target.height}`,
                `${target.id} canvas is ${state.viewport}, expected ${target.width}x${target.height}`);
              const runtime = target.runtimeViewport;
              requireFact(state.runtimeViewport === `${runtime.width}x${runtime.height}`,
                `${target.id} runtime is ${state.runtimeViewport}, expected ${runtime.width}x${runtime.height}`);
              requireFact(state.runtimeBuild.length === 8,
                `${slide.slug} did not expose the production build tag`);
              buildTags.add(state.runtimeBuild);

              const stem = `${String(slide.index).padStart(2, '0')}-${slide.slug}`;
              const outputDirectory = path.join(here, 'raw', appStoreLocale, target.id);
              const outputPath = path.join(outputDirectory, `${stem}-${variant}.png`);
              await mkdir(outputDirectory, { recursive: true });
              await page.screenshot({ path: outputPath, type: 'png', fullPage: false });
              captured.push(path.relative(repositoryRoot, outputPath));
            } finally {
              await page.close();
            }
          }
        }
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await running.close();
}

requireFact(buildTags.size === 1,
  `Raw captures used more than one production build: ${[...buildTags].join(', ')}`);
const provenance = {
  schemaVersion: 1,
  generator: 'marketing/app-store/ios/capture.mjs',
  runtimeBuild: [...buildTags][0],
  playwrightVersion: playwrightPackage.version,
  chromiumVersion,
  locales: Object.keys(manifest.localizations),
  targets: manifest.targets.map((target) => ({
    id: target.id,
    width: target.width,
    height: target.height,
    runtimeViewport: target.runtimeViewport,
  })),
  captures: captured.length,
  files: captured,
};
await writeFile(path.join(here, 'capture-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify({
  captures: captured.length,
  runtimeBuild: [...buildTags][0],
  files: captured,
}, null, 2));
