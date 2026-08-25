import { LOCALE_REGISTRY } from '../src/i18n/locale.ts';
import { LEGAL_RELEASE } from '../src/legal/config.ts';
import { LEGAL_CONTENT, legalLocaleContent } from '../src/legal/content.ts';
import {
  assertLegalPublicationReady,
  legalDocument,
  legalPublicationProblems,
  type LegalContentRegistry,
} from '../src/legal/documents.ts';
import { legalPageUrl } from '../src/legal/paths.ts';
import { renderLegalDocumentBody } from '../src/legal/render.ts';
import {
  generateLegalPageFiles,
  generatedLegalPaths,
} from '../src/legal/static-pages.ts';
import { LEGAL_PAGE_IDS } from '../src/legal/types.ts';
import {
  LEGAL_AUTH_NAV_MARKUP,
  LEGAL_HOME_NAV_MARKUP,
  LEGAL_SETTINGS_NAV_MARKUP,
  legalNavigationMarkup,
} from '../src/markup/legal.ts';
import { completeLegalFixture } from './support/legal-fixture.ts';

const problems: string[] = [];
const check = (condition: unknown, message: string): void => {
  if (!condition) problems.push(message);
};

check(LEGAL_RELEASE.status === 'draft', 'checked-in legal publication status is not draft');
check(generateLegalPageFiles(LEGAL_RELEASE).size === 0,
  'draft publication emitted public legal files');
check(generatedLegalPaths(LEGAL_RELEASE).length === 0,
  'draft publication exposed service-worker legal routes');
check(legalPublicationProblems(LEGAL_RELEASE).length > 0,
  'draft production facts accidentally satisfy the release gate');
check(!LEGAL_HOME_NAV_MARKUP && !LEGAL_SETTINGS_NAV_MARKUP && !LEGAL_AUTH_NAV_MARKUP,
  'draft publication exposed an in-app legal door');
const expectedGermanyNames = {
  en: 'Germany', pt: 'Alemanha', es: 'Alemania',
  de: 'Deutschland', fr: 'Allemagne', it: 'Germania',
} as const;
for (const { id } of LOCALE_REGISTRY) {
  const imprint = renderLegalDocumentBody(legalDocument(id, 'imprint', LEGAL_RELEASE.facts));
  const privacy = renderLegalDocumentBody(legalDocument(id, 'privacy', LEGAL_RELEASE.facts));
  check(imprint.includes(expectedGermanyNames[id]),
    `${id} imprint did not localize the controller country`);
  check(privacy.includes(expectedGermanyNames[id]),
    `${id} privacy page did not localize the authority country`);
}

let draftRejected = false;
try { assertLegalPublicationReady(LEGAL_RELEASE); } catch { draftRejected = true; }
check(draftRejected, 'ready assertion accepted the draft configuration');

const fixture = completeLegalFixture();
assertLegalPublicationReady(fixture);
const homeNavigation = legalNavigationMarkup(fixture, {
  pages: LEGAL_PAGE_IDS,
  className: 'viewfoot legal-home-nav',
  idPrefix: 'btn',
});
const settingsNavigation = legalNavigationMarkup(fixture, {
  pages: ['imprint', 'privacy'],
  className: 'legal-settings-nav',
  idPrefix: 'btnSettings',
});
const authNavigation = legalNavigationMarkup(fixture, {
  pages: ['privacy'],
  className: 'authlegal',
  idPrefix: 'btnAuth',
});
const navigationPages = (markup: string): string[] =>
  [...markup.matchAll(/data-legal-open="([^"]+)"/gu)].map((match) => match[1]);
check(navigationPages(homeNavigation).join() === LEGAL_PAGE_IDS.join(),
  'ready Home navigation does not expose the complete public resource set');
check(navigationPages(settingsNavigation).join() === 'imprint,privacy',
  'ready Settings navigation is not exactly Imprint plus Privacy');
check(navigationPages(authNavigation).join() === 'privacy',
  'ready auth navigation is not exactly Privacy');
const navigationIds = [...(homeNavigation + settingsNavigation + authNavigation)
  .matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]);
check(new Set(navigationIds).size === navigationIds.length,
  'ready in-app legal navigation emitted duplicate ids');
const blankProviderFixture = {
  ...fixture,
  facts: { ...fixture.facts, controllerName: ' ' },
};
check(legalPublicationProblems(blankProviderFixture).includes('controllerName is missing'),
  'ready gate accepted a blank provider fact');
const blankLocalizedProviderFixture = {
  ...fixture,
  facts: {
    ...fixture.facts,
    controllerCountry: { ...fixture.facts.controllerCountry, it: ' ' },
  },
};
check(legalPublicationProblems(blankLocalizedProviderFixture).includes('controllerCountry.it is missing'),
  'ready gate accepted a blank localized provider fact');
const decoratedOriginFixture = { ...fixture, canonicalOrigin: `${fixture.canonicalOrigin}/?preview=1` };
check(legalPublicationProblems(decoratedOriginFixture)
  .includes('canonicalOrigin must be an HTTPS origin without a path'),
  'ready gate accepted a canonical origin with query state');

const expectContentRejection = (
  content: LegalContentRegistry,
  expectedProblem: string,
  message: string,
): void => {
  check(legalPublicationProblems(fixture, content).includes(expectedProblem), message);
  let rejected = false;
  try { assertLegalPublicationReady(fixture, content); } catch { rejected = true; }
  check(rejected, `${message} (ready assertion)`);
};

expectContentRejection({
  ...LEGAL_CONTENT,
  fr: { ...LEGAL_CONTENT.fr, backLabel: ' ' },
}, 'legalContent.fr.backLabel is missing',
'ready gate accepted blank localized legal chrome');

expectContentRejection({
  ...LEGAL_CONTENT,
  es: {
    ...LEGAL_CONTENT.es,
    pages: {
      ...LEGAL_CONTENT.es.pages,
      support: { ...LEGAL_CONTENT.es.pages.support, intro: '\n' },
    },
  },
}, 'legalContent.es.support.intro is missing',
'ready gate accepted a blank localized legal introduction');

expectContentRejection({
  ...LEGAL_CONTENT,
  pt: {
    ...LEGAL_CONTENT.pt,
    pages: {
      ...LEGAL_CONTENT.pt.pages,
      'delete-account': { ...LEGAL_CONTENT.pt.pages['delete-account'], sections: [] },
    },
  },
}, 'legalContent.pt.delete-account.sections is empty',
'ready gate accepted a localized legal page without sections');

const { privacy: _missingPrivacy, ...incompleteItalianPages } = LEGAL_CONTENT.it.pages;
expectContentRejection({
  ...LEGAL_CONTENT,
  it: {
    ...LEGAL_CONTENT.it,
    pages: incompleteItalianPages as typeof LEGAL_CONTENT.it.pages,
  },
}, 'legalContent.it.privacy is missing',
'ready gate accepted a missing localized legal page');

const files = generateLegalPageFiles(fixture);
const expectedCount = LOCALE_REGISTRY.length * LEGAL_PAGE_IDS.length;
check(expectedCount === 24, `supported locale/page matrix is ${expectedCount}, expected 24`);
check(files.size === expectedCount, `synthetic ready build emitted ${files.size} pages`);
check(generatedLegalPaths(fixture).length === expectedCount,
  'service-worker route matrix differs from generated page matrix');

for (const locale of LOCALE_REGISTRY) {
  const content = legalLocaleContent(locale.id);
  for (const page of LEGAL_PAGE_IDS) {
    const name = `legal/${locale.id}/${page}/index.html`;
    const html = files.get(name) ?? '';
    const document = legalDocument(locale.id, page, fixture.facts);
    const sharedBody = renderLegalDocumentBody(document);
    const canonical = legalPageUrl(fixture.canonicalOrigin, locale.id, page);
    check(html.startsWith('<!doctype html>'), `${name} is not standalone HTML`);
    check(html.includes(`<html lang="${locale.languageTag}">`), `${name} has the wrong html lang`);
    check(html.includes(`<link rel="canonical" href="${canonical}">`), `${name} lacks its canonical URL`);
    check(html.includes(sharedBody), `${name} does not use the shared legal document renderer`);
    check(!/<script\b/iu.test(html), `${name} unexpectedly requires JavaScript`);
    check(!/\{\{|pending verification|aguardando verificação|pendiente de verificación|noch zu prüfen|vérification requise|in attesa di verifica/iu.test(html),
      `${name} contains an unresolved draft marker`);
    check((html.match(/rel="alternate" hreflang=/gu) ?? []).length === LOCALE_REGISTRY.length + 1,
      `${name} has an incomplete hreflang set`);
    check(html.includes('hreflang="pt-BR"'), `${name} does not advertise Brazilian Portuguese`);
    check(html.includes('/legal/pt/'), `${name} uses a region tag instead of pt in URLs`);
    check(document.title === content.pages[page].title, `${name} title drifted from its locale source`);
  }
}

console.log(JSON.stringify({ files: files.size, problems, errs: [] }, null, 2));
process.exitCode = problems.length ? 1 : 0;
