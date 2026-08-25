import { MODES } from '../../../../src/core/modes.ts';
import { SPELLS } from '../../../../src/core/spells.ts';
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { LOCALE_IDS as LOCALES, chooseLocale } from '../harness/locale-control.mjs';

const STANDALONE_SIZES = [
  { name: 'portrait-320x568', width: 320, height: 568, landscape: false },
  { name: 'portrait-390x844', width: 390, height: 844, landscape: false },
  { name: 'landscape-568x320', width: 568, height: 320, landscape: true },
  { name: 'landscape-667x375', width: 667, height: 375, landscape: true },
];
const WIDGET_WIDTHS = [320, 390, 520];
const MODE_VARIANTS = MODES.map(({ mode, id }) => ({ mode, id }));
const RUNE_VARIANTS = SPELLS.map(({ id }) => id);
const interpolateSample = (copy, player) => copy.replace(/\{\{([^}]+)\}\}/gu, (_match, name) => ({
  column: '3',
  player,
  spell: 'COLUMN SHIELD',
  opponent: 'NovaComet992',
  count: '12',
  formatted: '12',
}[name] ?? '12'));
const statusCopies = (locale) => {
  const game = RESOURCES[locale].game;
  const online = RESOURCES[locale].online;
  return [
    ...Object.entries(game.status).flatMap(([key, copy]) =>
      typeof copy === 'string' && key !== 'playerChoose'
        ? [[`game.status.${key}`, copy]] : []),
    ...SPELLS.map(({ id }) => {
      const copy = game.runes[id];
      return [`game.runes.${id}.aim`, 'aimCompact' in copy ? copy.aimCompact : copy.aim];
    }),
    ...['reconnecting', 'opponentThinking', 'yourMove', 'awayAutoPlay_one',
      'awayAutoPlay_other', 'autoPlay'].flatMap((key) =>
      key.startsWith('awayAutoPlay') ? [] :
      typeof online.play[key] === 'string' ? [[`online.play.${key}`, online.play[key]]] : []),
    ...['awayAutoPlayCompact_one', 'awayAutoPlayCompact_other'].map((key) =>
      [`online.play.${key}`, online.play[key]]),
  ].map(([key, copy]) => ({ key, copy: interpolateSample(copy, game.player.player2) }));
};
const GEOMETRY_SELECTORS = [
  '#topBoard', '#botBoard', '#dieStage',
  '#topBoard .slot', '#botBoard .slot',
  '#topBoard .die', '#botBoard .die', '#dieStage .die',
];

const frame = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

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

async function measureStatusCopies(page, rootSelector, locale, label, expectedLandscape, check) {
  const failures = [];
  for (const candidate of statusCopies(locale)) {
    const view = await page.evaluate(({ selector, copy }) => {
      const root = document.querySelector(selector);
      const status = root.querySelector('#status');
      status.textContent = copy;
      const box = status.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(status);
      const text = range.getBoundingClientRect();
      const lines = new Set([...range.getClientRects()].map((line) => line.top.toFixed(2))).size;
      return {
        box: { x: box.x, y: box.y, width: box.width, height: box.height,
          right: box.right, bottom: box.bottom },
        text: { x: text.x, y: text.y, width: text.width, height: text.height,
          right: text.right, bottom: text.bottom },
        lines,
        scrollWidth: status.scrollWidth,
        clientWidth: status.clientWidth,
        scrollHeight: status.scrollHeight,
        clientHeight: status.clientHeight,
      };
    }, { selector: rootSelector, copy: candidate.copy });
    const contained = view.text.x >= view.box.x - 0.5 && view.text.right <= view.box.right + 0.5
      && view.text.y >= view.box.y - 0.5 && view.text.bottom <= view.box.bottom + 0.5
      && view.scrollWidth <= view.clientWidth + 0.5
      && view.scrollHeight <= view.clientHeight + 0.5;
    if (!contained || (expectedLandscape ? view.lines > 2 : view.lines > 1)) {
      failures.push({ ...candidate, view });
    }
  }
  check(failures.length === 0,
    `${label}/${locale} exceeds the reserved status lane`, failures);
}

async function badgeSnapshot(page, rootSelector) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const rootBox = root.getBoundingClientRect();
    const row = root.querySelector('#rec');
    const chips = [...root.querySelectorAll('#rec .rchip')].map((chip) => {
      const box = chip.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(chip);
      const text = range.getBoundingClientRect();
      return {
        text: chip.textContent?.trim(),
        width: box.width,
        height: box.height,
        scrollWidth: chip.scrollWidth,
        clientWidth: chip.clientWidth,
        textInside: text.x >= box.x - 0.5 && text.right <= box.right + 0.5
          && text.y >= box.y - 0.5 && text.bottom <= box.bottom + 0.5,
        insideRoot: box.x >= rootBox.x - 0.5 && box.right <= rootBox.right + 0.5,
      };
    });
    return {
      chips,
      row: row ? { scrollWidth: row.scrollWidth, clientWidth: row.clientWidth } : null,
    };
  }, rootSelector);
}

async function measureBadgeVariants(page, rootSelector, localeOwnerSelector, label, check) {
  const failures = [];
  for (const locale of LOCALES) {
    await chooseLocale(page, locale, localeOwnerSelector);
    for (const variant of [
      ...MODE_VARIANTS.map(({ mode, id }) => ({ kind: 'mode', id, scoring: mode, spells: ['', ''] })),
      ...RUNE_VARIANTS.map((id) => ({ kind: 'rune', id, scoring: 0, spells: [id, id] })),
      { kind: 'rune-pair', id: `${RUNE_VARIANTS[0]}+${RUNE_VARIANTS[1]}`,
        scoring: 0, spells: [RUNE_VARIANTS[0], RUNE_VARIANTS[1]] },
    ]) {
      await page.evaluate(({ scoring, spells }) => {
        const game = window.__kb;
        game.S.mode = 'duo';
        game.S.seat = 'pass';
        game.newGame({ scoring, spells });
        game.S.gen++;
        game.renderAll(false);
        game.fit();
      }, variant);
      await frame(page);
      const view = await badgeSnapshot(page, rootSelector);
      if (!view.row || view.row.scrollWidth > view.row.clientWidth + 0.5
          || view.chips.length === 0
          || view.chips.some((chip) => !chip.text || !chip.textInside || !chip.insideRoot
            || chip.scrollWidth > chip.clientWidth + 0.5)) {
        failures.push({ locale, variant, view });
      }
    }
  }
  check(failures.length === 0,
    `${label} clips a registered mode/rune compact chip`, failures);
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
    await measureStatusCopies(page, rootSelector, locale, label, expectedLandscape, check);
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
    await prepareGame(page);
    out.localeGeometry.standalone[size.name] = await measureLocaleMatrix(
      page, '#kbroot', 'html', size.name, size.landscape, check,
    );
    if (size.width === 320 || (size.width === 568 && size.height === 320)) {
      await measureBadgeVariants(page, '#kbroot', 'html', size.name, check);
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
    await prepareGame(widget);
    const rootWidth = await widget.$eval('#kbroot', (root) => root.getBoundingClientRect().width);
    check(Math.abs(rootWidth - width) <= 0.5,
      `widget-${width} did not expose the requested supported content width`, { rootWidth, width });
    out.localeGeometry.widget[String(width)] = await measureLocaleMatrix(
      widget, '#kbroot', '#kbroot', `widget-${width}`, false, check,
    );
    await measureBadgeVariants(widget, '#kbroot', '#kbroot', `widget-${width}`, check);
    const ownership = await widget.evaluate(() => ({
      htmlLang: document.documentElement.lang,
      rootLang: document.getElementById('kbroot')?.lang,
    }));
    check(ownership.htmlLang === 'es-MX',
      `widget-${width} changed the host language during locale geometry switches`, ownership);
  }
  await widgetContext.close();
}
