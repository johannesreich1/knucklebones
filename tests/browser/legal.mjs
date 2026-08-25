// Draft hides production legal links, so this suite supplies one synthetic
// opener and drives the real in-app controller/document renderer underneath.
// A complete test-only release fixture supplies the 24 static pages; production
// remains draft. Both paths run at every locale/page/mobile viewport.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pkg from 'playwright';
import { LOCALE_REGISTRY } from '../../src/i18n/locale.ts';
import { LEGAL_RELEASE } from '../../src/legal/config.ts';
import { legalDocument } from '../../src/legal/documents.ts';
import { renderLegalDocumentBody } from '../../src/legal/render.ts';
import { generateLegalPageFiles } from '../../src/legal/static-pages.ts';
import { LEGAL_PAGE_IDS } from '../../src/legal/types.ts';
import { serveTree } from '../serve.mjs';
import { completeLegalFixture } from '../support/legal-fixture.ts';
const { chromium } = pkg;

const FILE = 'file://' + process.cwd() + '/knucklebones-neon.html';
const VIEWPORTS = [
  [320, 568, '320x568'],
  [390, 844, '390x844'],
  [568, 320, '568x320'],
  [667, 375, '667x375'],
];
const problems = [];
const errs = [];
const out = {};
const check = (condition, message, detail) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const LONG_URL = 'https://privacy.example.test/account-deletion/'
  + 'ownership-verification-with-a-deliberately-unbroken-mobile-path-'
  + 'abcdefghijklmnopqrstuvwxyz-0123456789-abcdefghijklmnopqrstuvwxyz';
const readyFixture = completeLegalFixture();
const longScope = Object.fromEntries(LOCALE_REGISTRY.map(({ id }) => [
  id,
  `fixture delivery scope (${id}) ${LONG_URL}`,
]));
const browserFixture = {
  ...readyFixture,
  facts: { ...readyFixture.facts, cloudflareProcessingScope: longScope },
};
const staticFiles = generateLegalPageFiles(browserFixture);
const staticRoot = await mkdtemp(path.join(tmpdir(), 'kb-legal-browser-'));
await Promise.all([...staticFiles].map(async ([relative, html]) => {
  const output = path.join(staticRoot, relative);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html, 'utf8');
}));
const staticServer = await serveTree(staticRoot);

function expectedBody(locale, page, facts) {
  return renderLegalDocumentBody(legalDocument(locale, page, facts));
}

async function inspectOpenLocaleRepaint(page, viewport) {
  const from = LOCALE_REGISTRY.at(-1);
  const to = LOCALE_REGISTRY[0];
  const legalPage = 'privacy';
  await page.evaluate((pageId) => {
    const opener = document.getElementById('legalMatrixOpener');
    opener.dataset.legalOpen = pageId;
    opener.focus();
    opener.click();
  }, legalPage);
  await page.waitForFunction((pageId) => {
    const overlay = document.querySelector(`[data-legal-page="${pageId}"]`);
    return overlay?.classList.contains('on') && document.activeElement === overlay.querySelector('h1');
  }, legalPage);
  const before = await page.evaluate(() => {
    const overlay = document.querySelector('[data-legal-page="privacy"]');
    const body = overlay.querySelector('.pbody');
    body.scrollTop = Math.min(96, body.scrollHeight - body.clientHeight);
    overlay.querySelector('h1').focus({ preventScroll: true });
    return {
      locale: document.documentElement.dataset.locale,
      scrollTop: body.scrollTop,
    };
  });
  await page.evaluate(() => document.getElementById('languageNext').click());
  await page.waitForFunction(({ locale, tag }) =>
    document.documentElement.dataset.locale === locale
      && document.documentElement.lang === tag,
  { locale: to.id, tag: to.languageTag });
  const expected = legalDocument(to.id, legalPage, LEGAL_RELEASE.facts);
  const after = await page.evaluate(({ bodyHtml, longUrl }) => {
    const overlay = document.querySelector('[data-legal-page="privacy"]');
    const body = overlay.querySelector('.pbody');
    const article = overlay.querySelector('.legal-document');
    const heading = overlay.querySelector('h1');
    const normalize = (element) => {
      const clone = element.cloneNode(true);
      clone.querySelector('h1')?.removeAttribute('id');
      return clone.outerHTML;
    };
    const template = document.createElement('template');
    template.innerHTML = bodyHtml.trim();
    const sharedBody = normalize(article) === normalize(template.content.firstElementChild);
    const repaintScrollTop = body.scrollTop;

    const host = article.querySelector('p');
    const anchor = document.createElement('a');
    anchor.href = longUrl;
    anchor.textContent = longUrl;
    host.append(document.createElement('br'), anchor);
    anchor.scrollIntoView({ block: 'center' });
    const bodyRect = body.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(anchor);
    const lines = [...range.getClientRects()];
    const anchorRect = anchor.getBoundingClientRect();
    const result = {
      locale: document.documentElement.dataset.locale,
      title: heading.textContent,
      open: overlay.classList.contains('on'),
      focused: document.activeElement === heading,
      scrollTop: repaintScrollTop,
      sharedBody,
      longLinkWraps: lines.length > 1
        && lines.every((rect) => rect.left >= bodyRect.left - 1 && rect.right <= bodyRect.right + 1),
      longLinkReachable: anchorRect.bottom >= bodyRect.top - 1 && anchorRect.top <= bodyRect.bottom + 1,
      horizontal: body.scrollWidth - body.clientWidth,
    };
    anchor.previousSibling?.remove();
    anchor.remove();
    overlay.querySelector('[data-legal-close]').click();
    return new Promise((resolve) => requestAnimationFrame(() => {
      result.closed = !overlay.classList.contains('on')
        && !document.getElementById('ovStart').inert
        && document.activeElement?.id === 'legalMatrixOpener';
      resolve(result);
    }));
  }, { bodyHtml: expectedBody(to.id, legalPage, LEGAL_RELEASE.facts),
    longUrl: LONG_URL });
  check(before.locale === from.id && after.locale === to.id,
    `${viewport}: an open legal page did not follow registry locale cycling`, { before, after });
  check(after.open && after.focused && after.title === expected.title,
    `${viewport}: locale repaint replaced, closed, or unfocused the active legal page`, after);
  check(Math.abs(after.scrollTop - before.scrollTop) <= 1,
    `${viewport}: locale repaint lost the legal scroll position`, { before, after });
  check(after.sharedBody,
    `${viewport}: repainted in-app legal HTML drifted from the shared renderer`, after);
  check(after.longLinkWraps && after.longLinkReachable && after.horizontal <= 1,
    `${viewport}: a long in-app legal URL clipped or became unreachable`, after);
  check(after.closed, `${viewport}: repainted legal close did not restore its opener`, after);
  return { from: before.locale, to: after.locale, longLinkWraps: after.longLinkWraps };
}

async function inspectStaticMatrix(context, viewport) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errs.push(`${viewport}/static: ${error.message}`));
  const observations = [];
  for (const locale of LOCALE_REGISTRY) {
    for (const legalPage of LEGAL_PAGE_IDS) {
      await page.goto(`${staticServer.url}legal/${locale.id}/${legalPage}/`);
      const observation = await page.evaluate(async ({ localeId, languageTag, legalPage,
        bodyHtml, longUrl, canonicalOrigin, localeCount }) => {
        const article = document.querySelector('.legal-document');
        const main = document.querySelector('main');
        const mainRect = main.getBoundingClientRect();
        const normalize = (element) => element.outerHTML;
        const template = document.createElement('template');
        template.innerHTML = bodyHtml.trim();
        const textOverflow = [];
        for (const element of main.querySelectorAll('h1,h2,p,li,a')) {
          const range = document.createRange();
          range.selectNodeContents(element);
          for (const rect of range.getClientRects()) {
            if (rect.width > .5 && (rect.left < mainRect.left - 1 || rect.right > mainRect.right + 1)) {
              textOverflow.push({ tag: element.tagName, text: element.textContent.slice(0, 45),
                left: Math.round(rect.left), right: Math.round(rect.right) });
            }
          }
        }
        const targets = [...document.querySelectorAll('header a')].map((anchor) => {
          const rect = anchor.getBoundingClientRect();
          return { text: anchor.textContent.trim(), width: rect.width, height: rect.height };
        });
        const longLink = document.querySelector(`a[href="${longUrl}"]`);
        let longLinkWraps = null;
        let longLinkReachable = null;
        if (longLink) {
          longLink.scrollIntoView({ block: 'center' });
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const range = document.createRange();
          range.selectNodeContents(longLink);
          const lines = [...range.getClientRects()];
          const rect = longLink.getBoundingClientRect();
          longLinkWraps = lines.length > 1
            && lines.every((line) => line.left >= mainRect.left - 1 && line.right <= mainRect.right + 1);
          longLinkReachable = rect.bottom >= -1 && rect.top <= innerHeight + 1;
        }
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const footerRect = document.querySelector('footer').getBoundingClientRect();
        return {
          locale: localeId,
          legalPage,
          languageTag: document.documentElement.lang,
          sharedBody: normalize(article) === normalize(template.content.firstElementChild),
          horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          textOverflow,
          targets,
          pageLinks: document.querySelectorAll('.page-nav a').length,
          languageLinks: document.querySelectorAll('.language-nav a').length,
          currentPageLinks: document.querySelectorAll('.page-nav [aria-current="page"]').length,
          currentLanguageLinks: document.querySelectorAll('.language-nav [aria-current="page"]').length,
          homeHref: document.querySelector('.home').href,
          canonicalOrigin,
          localeCount,
          footerReachable: footerRect.top < innerHeight + 1 && footerRect.bottom <= innerHeight + 1,
          nestedScroller: [...document.querySelectorAll('main,article')].some((element) =>
            /auto|scroll/u.test(getComputedStyle(element).overflowY)),
          longLinkWraps,
          longLinkReachable,
        };
      }, {
        localeId: locale.id,
        languageTag: locale.languageTag,
        legalPage,
        bodyHtml: expectedBody(locale.id, legalPage, browserFixture.facts),
        longUrl: LONG_URL,
        canonicalOrigin: browserFixture.canonicalOrigin,
        localeCount: LOCALE_REGISTRY.length,
      });
      observations.push(observation);
      const label = `${viewport}/static/${locale.id}/${legalPage}`;
      check(observation.languageTag === locale.languageTag,
        `${label}: static html lang drifted from the registry`, observation);
      check(observation.sharedBody,
        `${label}: static HTML drifted from the shared legal document renderer`, observation);
      check(observation.horizontal <= 1 && observation.textOverflow.length === 0,
        `${label}: static legal copy overflowed horizontally`, observation);
      check(observation.targets.every((target) => target.width >= 44 && target.height >= 44),
        `${label}: a static navigation target is below 44px`, observation.targets);
      check(observation.pageLinks === LEGAL_PAGE_IDS.length
        && observation.languageLinks === LOCALE_REGISTRY.length
        && observation.currentPageLinks === 1 && observation.currentLanguageLinks === 1,
      `${label}: static page/language navigation is incomplete`, observation);
      check(observation.homeHref === `${browserFixture.canonicalOrigin}/`,
        `${label}: static Home does not lead to the real canonical root`, observation);
      check(observation.footerReachable && !observation.nestedScroller,
        `${label}: static legal content is not completely scroll-reachable`, observation);
      if (legalPage === 'privacy') {
        check(observation.longLinkWraps && observation.longLinkReachable,
          `${label}: synthetic long URL did not wrap or remain reachable`, observation);
      }
    }
  }
  await page.close();
  return { cases: observations.length, longUrlCases: observations.filter((item) =>
    item.longLinkWraps !== null).length };
}

const browser = await chromium.launch();
try {
  for (const [width, height, viewport] of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
    const page = await context.newPage();
    page.on('pageerror', (error) => errs.push(`${viewport}: ${error.message}`));
    await page.goto(FILE);
    await page.waitForTimeout(180);
    await page.evaluate(() => {
      const opener = document.createElement('button');
      opener.id = 'legalMatrixOpener';
      opener.textContent = 'legal test opener';
      opener.style.cssText = 'position:fixed;left:-10000px;top:0';
      document.getElementById('ovStart').append(opener);
    });
    const observations = [];

    for (let localeIndex = 0; localeIndex < LOCALE_REGISTRY.length; localeIndex++) {
      if (localeIndex > 0) {
        await page.evaluate(() => document.getElementById('languageNext').click());
        await page.waitForTimeout(20);
      }
      const identity = await page.evaluate(() => ({
        locale: document.documentElement.dataset.locale,
        lang: document.documentElement.lang,
      }));
      const locale = LOCALE_REGISTRY[localeIndex];
      check(identity.locale === locale.id, `${viewport}/${locale.id}: runtime locale order drifted`, identity);
      check(identity.lang === locale.languageTag,
        `${viewport}/${locale.id}: document language tag is wrong`, identity);

      for (const legalPage of LEGAL_PAGE_IDS) {
        await page.evaluate((pageId) => {
          const opener = document.getElementById('legalMatrixOpener');
          opener.dataset.legalOpen = pageId;
          opener.focus();
          opener.click();
        }, legalPage);
        await page.waitForFunction((pageId) => {
          const overlay = document.querySelector(`[data-legal-page="${pageId}"]`);
          return overlay?.classList.contains('on')
            && document.activeElement === overlay.querySelector('h1');
        }, legalPage);
        const observation = await page.evaluate(async ({ locale, legalPage, sharedBody }) => {
          const overlay = document.querySelector(`[data-legal-page="${legalPage}"]`);
          const body = overlay.querySelector('.pbody');
          const heading = overlay.querySelector('h1');
          const article = overlay.querySelector('.legal-document');
          const title = overlay.querySelector('[data-legal-title]');
          const titleStyle = getComputedStyle(title);
          const titleLineHeight = titleStyle.lineHeight === 'normal'
            ? parseFloat(titleStyle.fontSize) * 1.2
            : parseFloat(titleStyle.lineHeight);
          const bodyRect = body.getBoundingClientRect();
          const textOverflow = [];
          for (const element of body.querySelectorAll('h1,h2,p,li,a,button')) {
            if (!element.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(element);
            for (const rect of range.getClientRects()) {
              if (rect.width > .5 && (rect.left < bodyRect.left - 1 || rect.right > bodyRect.right + 1)) {
                textOverflow.push({ tag: element.tagName, text: element.textContent.slice(0, 45),
                  left: Math.round(rect.left), right: Math.round(rect.right) });
              }
            }
          }
          const targets = [...body.querySelectorAll('button'), overlay.querySelector('[data-legal-close]')]
            .map((button) => {
              const rect = button.getBoundingClientRect();
              return { text: button.textContent.trim(), width: rect.width, height: rect.height };
            });
          body.scrollTop = body.scrollHeight;
          const last = body.querySelector('.legal-related button:last-child');
          const lastRect = last.getBoundingClientRect();
          const scrolledBody = body.getBoundingClientRect();
          const result = {
            locale,
            legalPage,
            title: title.textContent,
            titleLines: title.getBoundingClientRect().height / titleLineHeight,
            titleFits: title.scrollWidth <= title.clientWidth + 1,
            horizontal: body.scrollWidth - body.clientWidth,
            textOverflow,
            focused: document.activeElement === heading,
            backgroundInert: document.getElementById('ovStart').inert,
            targets,
            lastReachable: lastRect.top >= scrolledBody.top - 1 && lastRect.bottom <= scrolledBody.bottom + 1,
            nestedScroller: getComputedStyle(overlay.querySelector('.legal-document')).overflowY,
            sharedBody: (() => {
              const normalize = (element) => {
                const clone = element.cloneNode(true);
                clone.querySelector('h1')?.removeAttribute('id');
                return clone.outerHTML;
              };
              const template = document.createElement('template');
              template.innerHTML = sharedBody.trim();
              return normalize(article) === normalize(template.content.firstElementChild);
            })(),
          };
          overlay.querySelector('[data-legal-close]').click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          result.closed = !overlay.classList.contains('on')
            && !document.getElementById('ovStart').inert
            && document.activeElement?.id === 'legalMatrixOpener';
          return result;
        }, {
          locale: locale.id,
          legalPage,
          sharedBody: expectedBody(locale.id, legalPage, LEGAL_RELEASE.facts),
        });
        observations.push(observation);
        const label = `${viewport}/${locale.id}/${legalPage}`;
        check(observation.titleLines <= 1.1 && observation.titleFits,
          `${label}: compact header wrapped or clipped`, observation);
        check(observation.horizontal <= 1 && observation.textOverflow.length === 0,
          `${label}: legal copy overflows horizontally`, observation);
        check(observation.focused && observation.backgroundInert,
          `${label}: open focus/inert contract failed`, observation);
        check(observation.targets.every((target) => target.width >= 44 && target.height >= 44),
          `${label}: an interactive target is below 44px`, observation.targets);
        check(observation.lastReachable, `${label}: final related link is unreachable`, observation);
        check(observation.nestedScroller === 'visible',
          `${label}: legal document created a nested scroller`, observation);
        check(observation.sharedBody,
          `${label}: in-app HTML drifted from the shared legal document renderer`, observation);
        check(observation.closed, `${label}: close did not restore opener and background`, observation);
      }
    }
    const localeRepaint = await inspectOpenLocaleRepaint(page, viewport);
    const staticPages = await inspectStaticMatrix(context, viewport);
    out[viewport] = { inAppCases: observations.length, staticPages, localeRepaint };
    await context.close();
  }
} finally {
  await browser.close();
  staticServer.stop();
  await rm(staticRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ out, problems, errs }, null, 2));
process.exitCode = problems.length || errs.length ? 1 : 0;
