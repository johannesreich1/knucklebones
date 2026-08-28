import { checkCompactChipVariants } from '../harness/compact-chips.mjs';
import { prepareLiveDuel } from '../harness/live-duel.mjs';
import { LOCALE_IDS as LOCALES, chooseLocale } from '../harness/locale-control.mjs';
import { checkStatusLaneBox, checkStatusLaneCopies } from '../harness/status-lane.mjs';

const STANDALONE_SIZES = [
  { name: 'portrait-320x568', width: 320, height: 568, landscape: false },
  { name: 'portrait-390x844', width: 390, height: 844, landscape: false },
  { name: 'landscape-568x320', width: 568, height: 320, landscape: true },
  { name: 'landscape-667x375', width: 667, height: 375, landscape: true },
];
const WIDGET_WIDTHS = [320, 390, 520];

const GEOMETRY_SELECTORS = [
  '#topBoard', '#botBoard', '#dieStage',
  '#topBoard .slot', '#botBoard .slot',
  '#topBoard .die', '#botBoard .die', '#dieStage .die',
];

async function snapshot(page, rootSelector, localeOwnerSelector) {
  return page.evaluate(({ rootSelector, localeOwnerSelector, geometrySelectors }) => {
    const root = document.querySelector(rootSelector);
    const localeOwner = document.querySelector(localeOwnerSelector);
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const rootRect = rect(root);
    const geometry = {};
    for (const selector of geometrySelectors) {
      geometry[selector] = [...root.querySelectorAll(selector)].map(rect);
    }

    const status = root.querySelector('#status');
    const statusRange = document.createRange();
    statusRange.selectNodeContents(status);
    const lineTops = new Set([...statusRange.getClientRects()].map((line) => line.top.toFixed(2)));
    const statusRect = rect(status);
    const constrained = [...root.querySelectorAll('#status, #rec .rchip, .plate .nm, .plate .tag:not([hidden])')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
      })
      .map((element) => {
        const box = rect(element);
        return {
          target: element.id ? `#${element.id}` : `${element.className}:${element.textContent?.trim()}`,
          text: element.textContent?.trim(),
          box,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          insideRoot: box.x >= rootRect.x - 0.5 && box.y >= rootRect.y - 0.5
            && box.x + box.width <= rootRect.x + rootRect.width + 0.5
            && box.y + box.height <= rootRect.y + rootRect.height + 0.5,
        };
      });
    return {
      locale: localeOwner?.dataset.locale ?? '',
      languageTag: root.lang || document.documentElement.lang,
      landscape: root.classList.contains('land'),
      root: rootRect,
      status: {
        text: status.textContent?.trim(),
        box: statusRect,
        lines: lineTops.size,
        scrollWidth: status.scrollWidth,
        clientWidth: status.clientWidth,
        scrollHeight: status.scrollHeight,
        clientHeight: status.clientHeight,
      },
      constrained,
      geometry,
      sentinels: {
        top: root.querySelector('#topBoard .die')?.getAttribute('data-locale-sentinel'),
        bottom: root.querySelector('#botBoard .die')?.getAttribute('data-locale-sentinel'),
      },
    };
  }, { rootSelector, localeOwnerSelector, geometrySelectors: GEOMETRY_SELECTORS });
}

function maxGeometryDelta(left, right) {
  let maximum = 0;
  let culprit = null;
  let shapeMatches = true;
  for (const selector of GEOMETRY_SELECTORS) {
    const a = left.geometry[selector] ?? [];
    const b = right.geometry[selector] ?? [];
    if (a.length !== b.length) shapeMatches = false;
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      for (const key of ['x', 'y', 'width', 'height']) {
        const delta = Math.abs(a[index][key] - b[index][key]);
        if (delta > maximum) {
          maximum = delta;
          culprit = { selector, index, key, before: a[index][key], after: b[index][key] };
        }
      }
    }
  }
  return { maximum, shapeMatches, culprit };
}

function checkSnapshot(check, label, expectedLandscape, view) {
  const clipped = view.constrained.filter((item) => !item.insideRoot
    || item.scrollWidth > item.clientWidth + 0.5
    || item.scrollHeight > item.clientHeight + 0.5);
  check(view.landscape === expectedLandscape,
    `${label} chose the wrong game orientation`, { expectedLandscape, view });
  check(clipped.length === 0,
    `${label} clips or pushes constrained game copy outside its root`, clipped);
  checkStatusLaneBox(check, label, expectedLandscape, view.status);
}

async function measureLocaleMatrix(
  page,
  rootSelector,
  localeOwnerSelector,
  label,
  expectedLandscape,
  check,
) {
  const views = {};
  for (const locale of LOCALES) {
    await chooseLocale(page, locale, localeOwnerSelector);
    views[locale] = await snapshot(page, rootSelector, localeOwnerSelector);
    checkSnapshot(check, `${label}/${locale}`, expectedLandscape, views[locale]);
    /* The sweep writes each candidate into the live #status and leaves the
       last one there, so take this locale's frame before running it. */
    await checkStatusLaneCopies(page, rootSelector, locale, label, expectedLandscape, check);
  }
  const deltas = Object.fromEntries(LOCALES.filter((locale) => locale !== 'en').map((locale) =>
    [locale, maxGeometryDelta(views.en, views[locale])]));
  for (const [locale, delta] of Object.entries(deltas)) {
    check(delta.shapeMatches && delta.maximum <= 0.5,
      `${label} moved or rebuilt game geometry when switching English to ${locale}`, delta);
  }
  check(LOCALES.every((locale) => views[locale].locale === locale
      && views[locale].status.text.length > 0)
    && LOCALES.filter((locale) => locale !== 'en')
      .every((locale) => views[locale].status.text !== views.en.status.text),
  `${label} did not repaint the live gameplay status in every registered locale`,
  Object.fromEntries(LOCALES.map((locale) => [locale, views[locale].status.text])));
  check(LOCALES.every((locale) => views[locale].sentinels.top === 'top'
      && views[locale].sentinels.bottom === 'bottom'),
  `${label} rebuilt live board dice during locale switching`,
  Object.fromEntries(LOCALES.map((locale) => [locale, views[locale].sentinels])));
  return {
    status: Object.fromEntries(LOCALES.map((locale) => [locale, views[locale].status])),
    constrainedCounts: Object.fromEntries(LOCALES.map((locale) =>
      [locale, views[locale].constrained.length])),
    deltas: Object.fromEntries(Object.entries(deltas).map(([locale, delta]) =>
      [locale, delta.maximum])),
  };
}

export async function runLocaleGeometryScenarios(suite) {
  const { standaloneUrl, widgetUrl, out, check, attachErrors, localeContext } = suite;
  out.localeGeometry = { standalone: {}, widget: {} };

  const context = await localeContext(['en-US'], { viewport: { width: 390, height: 844 } });
  const page = attachErrors(await context.newPage(), 'locale-geometry');
  await page.goto(standaloneUrl);
  await page.waitForFunction(() => window.__kb);
  for (const size of STANDALONE_SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await prepareLiveDuel(page);
    out.localeGeometry.standalone[size.name] = await measureLocaleMatrix(
      page, '#kbroot', 'html', size.name, size.landscape, check,
    );
    if (size.width === 320 || (size.width === 568 && size.height === 320)) {
      await checkCompactChipVariants(page, '#kbroot', 'html', size.name, check);
    }
  }
  await context.close();

  const widgetContext = await localeContext(['en-US'], {
    viewport: { width: 336, height: 680 },
    hostLanguage: 'es-MX',
  });
  const widget = attachErrors(await widgetContext.newPage(), 'widget-geometry');
  await widget.goto(widgetUrl);
  await widget.waitForFunction(() => window.__kb);
  for (const width of WIDGET_WIDTHS) {
    await widget.setViewportSize({ width: width + 16, height: 680 });
    await prepareLiveDuel(widget);
    const rootWidth = await widget.$eval('#kbroot', (root) => root.getBoundingClientRect().width);
    check(Math.abs(rootWidth - width) <= 0.5,
      `widget-${width} did not expose the requested supported content width`, { rootWidth, width });
    out.localeGeometry.widget[String(width)] = await measureLocaleMatrix(
      widget, '#kbroot', '#kbroot', `widget-${width}`, false, check,
    );
    await checkCompactChipVariants(widget, '#kbroot', '#kbroot', `widget-${width}`, check);
    const ownership = await widget.evaluate(() => ({
      htmlLang: document.documentElement.lang,
      rootLang: document.getElementById('kbroot')?.lang,
    }));
    check(ownership.htmlLang === 'es-MX',
      `widget-${width} changed the host language during locale geometry switches`, ownership);
  }
  await widgetContext.close();
}
