import {
  LOCALE_REGISTRY,
  localeLanguageTag,
  type SupportedLocale,
} from '../i18n/locale.ts';
import { legalLocaleContent } from './content.ts';
import { assertLegalPublicationReady, legalDocument } from './documents.ts';
import { legalPagePath, legalPageUrl } from './paths.ts';
import { escapeHtml, renderLegalDocumentBody } from './render.ts';
import {
  LEGAL_PAGE_IDS,
  type LegalPageId,
  type LegalPublicationConfig,
} from './types.ts';

const STATIC_CSS = `:root{color-scheme:dark;font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#04050c;color:#e9efff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 18% 0,#102451 0,transparent 38rem),#04050c}a{color:#8ee9ff;overflow-wrap:anywhere}a:focus-visible{outline:3px solid #8ee9ff;outline-offset:3px;border-radius:.2rem}.skip{position:absolute;left:.75rem;top:-5rem;background:#fff;color:#111;padding:.7rem;z-index:2}.skip:focus{top:.75rem}header,main,footer{width:min(100% - 2rem,46rem);margin-inline:auto}header{padding:1.25rem 0 0}.home{display:inline-flex;align-items:center;min-height:44px}.legal-nav{display:flex;flex-wrap:wrap;gap:.35rem .9rem;margin:1rem 0}.legal-nav a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px}.legal-nav [aria-current=page]{color:#fff;text-decoration-thickness:3px}.language-nav{border-top:1px solid #ffffff24;padding-top:.5rem}.legal-document{background:#ffffff0a;border:1px solid #ffffff18;border-radius:1rem;padding:clamp(1rem,4vw,2rem);overflow-wrap:anywhere}.legal-document h1{font-size:clamp(1.8rem,8vw,2.8rem);line-height:1.12;margin:.1rem 0 1rem}.legal-document h1:focus{outline:none}.legal-document h2{font-size:1.05rem;line-height:1.3;margin:1.7rem 0 .45rem;color:#8ee9ff}.legal-document p,.legal-document ul{margin:.45rem 0}.legal-document ul{padding-left:1.35rem}.legal-intro{font-size:1.08rem;color:#c9d4ee}main{padding:1rem 0 2rem}footer{padding:0 0 2rem;color:#aebbd7;font-size:.9rem}@media(max-width:360px){header,main,footer{width:min(100% - 1rem,46rem)}.legal-document{padding:1rem}.legal-nav{gap:.2rem .65rem}}`;

function pageNavigation(locale: SupportedLocale, current: LegalPageId, config: LegalPublicationConfig): string {
  const content = legalLocaleContent(locale);
  return `<nav class="legal-nav page-nav" aria-label="${escapeHtml(content.pageNavigationLabel)}">${LEGAL_PAGE_IDS.map((page) => {
    const currentAttribute = page === current ? ' aria-current="page"' : '';
    return `<a href="${escapeHtml(legalPageUrl(config.canonicalOrigin, locale, page))}"${currentAttribute}>${escapeHtml(content.pages[page].shortTitle)}</a>`;
  }).join('')}</nav>`;
}

function languageNavigation(locale: SupportedLocale, current: LegalPageId, config: LegalPublicationConfig): string {
  const content = legalLocaleContent(locale);
  return `<nav class="legal-nav language-nav" aria-label="${escapeHtml(content.languageNavigationLabel)}">${LOCALE_REGISTRY.map((entry) => {
    const currentAttribute = entry.id === locale ? ' aria-current="page"' : '';
    return `<a lang="${escapeHtml(entry.languageTag)}" hreflang="${escapeHtml(entry.languageTag)}" href="${escapeHtml(legalPageUrl(config.canonicalOrigin, entry.id, current))}"${currentAttribute}>${escapeHtml(entry.selfName)}</a>`;
  }).join('')}</nav>`;
}

export function renderStaticLegalPage(
  config: LegalPublicationConfig,
  locale: SupportedLocale,
  page: LegalPageId,
): string {
  assertLegalPublicationReady(config);
  const content = legalLocaleContent(locale);
  const document = legalDocument(locale, page, config.facts);
  const canonical = legalPageUrl(config.canonicalOrigin, locale, page);
  const alternateLinks = LOCALE_REGISTRY.map((entry) =>
    `<link rel="alternate" hreflang="${escapeHtml(entry.languageTag)}" href="${escapeHtml(legalPageUrl(config.canonicalOrigin, entry.id, page))}">`).join('');
  const xDefault = legalPageUrl(config.canonicalOrigin, 'en', page);
  return `<!doctype html>
<html lang="${escapeHtml(localeLanguageTag(locale))}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(document.title)} · ${escapeHtml(content.siteTitle)}</title>
  <meta name="description" content="${escapeHtml(document.description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  ${alternateLinks}
  <link rel="alternate" hreflang="x-default" href="${escapeHtml(xDefault)}">
  <style>${STATIC_CSS}</style>
</head>
<body>
  <a class="skip" href="#content">${escapeHtml(document.title)}</a>
  <header>
    <a class="home" href="${escapeHtml(new URL('/', config.canonicalOrigin).href)}">‹ ${escapeHtml(content.homeLabel)}</a>
    ${pageNavigation(locale, page, config)}
    ${languageNavigation(locale, page, config)}
  </header>
  <main id="content">${renderLegalDocumentBody(document)}</main>
  <footer>${escapeHtml(content.siteTitle)}</footer>
</body>
</html>`;
}

export function generateLegalPageFiles(config: LegalPublicationConfig): ReadonlyMap<string, string> {
  if (config.status === 'draft') return new Map();
  assertLegalPublicationReady(config);
  const files = new Map<string, string>();
  for (const { id } of LOCALE_REGISTRY) {
    for (const page of LEGAL_PAGE_IDS) {
      files.set(`legal/${id}/${page}/index.html`, renderStaticLegalPage(config, id, page));
    }
  }
  return files;
}

export function generatedLegalPaths(config: LegalPublicationConfig): readonly string[] {
  if (config.status === 'draft') return [];
  assertLegalPublicationReady(config);
  return LOCALE_REGISTRY.flatMap(({ id }) =>
    LEGAL_PAGE_IDS.map((page) => legalPagePath(id, page)));
}
