import { LOCALE_REGISTRY } from '../../../src/i18n/locale.ts';
import { legalDocument } from '../../../src/legal/documents.ts';
import { renderLegalDocumentBody } from '../../../src/legal/render.ts';
import { LEGAL_PAGE_IDS } from '../../../src/legal/types.ts';

export function expectedLegalBody(locale, page, facts) {
  return renderLegalDocumentBody(legalDocument(locale, page, facts));
}

export async function inspectStaticLegalMatrix({
  context,
  viewport,
  check,
  errs,
  serverUrl,
  fixture,
  longUrl,
}) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errs.push(`${viewport}/static: ${error.message}`));
  const observations = [];
  for (const locale of LOCALE_REGISTRY) {
    for (const legalPage of LEGAL_PAGE_IDS) {
      await page.goto(`${serverUrl}legal/${locale.id}/${legalPage}/`);
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
        bodyHtml: expectedLegalBody(locale.id, legalPage, fixture.facts),
        longUrl,
        canonicalOrigin: fixture.canonicalOrigin,
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
      check(observation.homeHref === `${fixture.canonicalOrigin}/`,
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
