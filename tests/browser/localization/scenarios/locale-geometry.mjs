const STANDALONE_SIZES = [
  { name: 'portrait-320x568', width: 320, height: 568, landscape: false },
  { name: 'portrait-390x844', width: 390, height: 844, landscape: false },
  { name: 'landscape-568x320', width: 568, height: 320, landscape: true },
  { name: 'landscape-667x375', width: 667, height: 375, landscape: true },
];
const WIDGET_WIDTHS = [320, 390, 520];
const LOCALES = ['en', 'de', 'fr'];
const GEOMETRY_SELECTORS = [
  '#topBoard', '#botBoard', '#dieStage',
  '#topBoard .slot', '#botBoard .slot',
  '#topBoard .die', '#botBoard .die', '#dieStage .die',
];

const frame = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function chooseLocale(page, locale, rootSelector) {
  for (let attempt = 0; attempt < LOCALES.length + 1; attempt++) {
    const current = await page.$eval(rootSelector, (root) => root.lang || document.documentElement.lang);
    if (current === locale) return;
    await page.evaluate(() => document.getElementById('languageNext')?.click());
    await frame(page);
  }
  throw new Error(`Could not cycle language to ${locale}`);
}

async function prepareGame(page) {
  await page.evaluate(() => {
    const game = window.__kb;
    const state = game.S;
    state.mode = 'duo';
    state.seat = 'pass';
    state.starter = 0;
    state.localMode = 0;
    state.spell = 'ward';
    state.timer = 0;
    game.newGame({ spell: 'ward' });
    state.gen++; // keep the localized opening status stable and cancel the roll
    state.boards[0][0] = [4];
    state.boards[1][1] = [5];
    game.renderAll(false);
    game.setStageDie(6);
    document.querySelector('#topBoard .die')?.setAttribute('data-locale-sentinel', 'top');
    document.querySelector('#botBoard .die')?.setAttribute('data-locale-sentinel', 'bottom');
    game.fit();
  });
  /* ResizeObserver and the 120ms orientation fallback both converge through
     fit(). Compare settled geometry, not a viewport's transitional old cell. */
  await page.waitForTimeout(160);
  await page.evaluate(() => window.__kb.fit());
  await frame(page);
}

async function snapshot(page, rootSelector) {
  return page.evaluate(({ rootSelector, geometrySelectors }) => {
    const root = document.querySelector(rootSelector);
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
      locale: root.lang || document.documentElement.lang,
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
  }, { rootSelector, geometrySelectors: GEOMETRY_SELECTORS });
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
  if (expectedLandscape) {
    check(Math.abs(view.status.box.width - 104) <= 0.5
      && Math.abs(view.status.box.height - 26) <= 0.5
      && view.status.lines <= 2,
    `${label} exceeded the 104px/two-line landscape status lane`, view.status);
  } else {
    check(view.status.lines <= 1,
      `${label} wrapped the reserved portrait status line`, view.status);
  }
}

async function measureLocaleMatrix(page, rootSelector, label, expectedLandscape, check) {
  const views = {};
  for (const locale of LOCALES) {
    await chooseLocale(page, locale, rootSelector);
    views[locale] = await snapshot(page, rootSelector);
    checkSnapshot(check, `${label}/${locale}`, expectedLandscape, views[locale]);
  }
  const deDelta = maxGeometryDelta(views.en, views.de);
  const frDelta = maxGeometryDelta(views.en, views.fr);
  check(deDelta.shapeMatches && deDelta.maximum <= 0.5,
    `${label} moved or rebuilt game geometry when switching English to German`, deDelta);
  check(frDelta.shapeMatches && frDelta.maximum <= 0.5,
    `${label} moved or rebuilt game geometry when switching English to French`, frDelta);
  check(views.de.status.text !== views.en.status.text && views.fr.status.text !== views.en.status.text
    && views.fr.status.text !== views.de.status.text,
  `${label} did not repaint the live gameplay status in all locales`, {
    en: views.en.status.text, de: views.de.status.text, fr: views.fr.status.text,
  });
  check(views.de.sentinels.top === 'top' && views.de.sentinels.bottom === 'bottom'
    && views.fr.sentinels.top === 'top' && views.fr.sentinels.bottom === 'bottom',
  `${label} rebuilt live board dice during locale switching`, {
    de: views.de.sentinels, fr: views.fr.sentinels,
  });
  return {
    status: Object.fromEntries(LOCALES.map((locale) => [locale, views[locale].status])),
    constrainedCounts: Object.fromEntries(LOCALES.map((locale) =>
      [locale, views[locale].constrained.length])),
    deltas: { de: deDelta.maximum, fr: frDelta.maximum },
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
    await prepareGame(page);
    out.localeGeometry.standalone[size.name] = await measureLocaleMatrix(
      page, '#kbroot', size.name, size.landscape, check,
    );
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
    await prepareGame(widget);
    const rootWidth = await widget.$eval('#kbroot', (root) => root.getBoundingClientRect().width);
    check(Math.abs(rootWidth - width) <= 0.5,
      `widget-${width} did not expose the requested supported content width`, { rootWidth, width });
    out.localeGeometry.widget[String(width)] = await measureLocaleMatrix(
      widget, '#kbroot', `widget-${width}`, false, check,
    );
    const ownership = await widget.evaluate(() => ({
      htmlLang: document.documentElement.lang,
      rootLang: document.getElementById('kbroot')?.lang,
    }));
    check(ownership.htmlLang === 'es-MX',
      `widget-${width} changed the host language during locale geometry switches`, ownership);
  }
  await widgetContext.close();
}
