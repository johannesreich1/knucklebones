import { readFileSync } from 'node:fs';
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
import { escapeHtml, renderLegalDocumentBody } from '../src/legal/render.ts';
import {
  generateLegalPageFiles,
  generatedLegalPaths,
} from '../src/legal/static-pages.ts';
import {
  LEGAL_PAGE_IDS,
  type LegalReleaseChecks,
  type LocalizedLegalFact,
} from '../src/legal/types.ts';
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
const navigationPages = (markup: string): string[] =>
  [...markup.matchAll(/data-legal-open="([^"]+)"/gu)].map((match) => match[1]);

// Legal duration facts are one named copy of the reviewed database behavior.
// Receipt age alone is insufficient: the associated match must also have
// finished before the same cutoff. The scheduled batch makes deletion eligible,
// rather than guaranteeing removal at an exact instant.
const receiptRetentionSources = [
  {
    file: '20260824212535_match_command_retention.sql',
    purge: 'purge_expired_match_commands',
    job: 'purge-expired-match-commands',
    tables: [{ table: 'private.match_commands', command: 'c', match: 'm' }],
  },
  {
    file: '20260825205241_rune_trial_ranked_v2.sql',
    purge: 'purge_expired_rune_trial_commands',
    job: 'purge-expired-rune-trial-commands',
    tables: [
      { table: 'private.rune_trial_selection_commands', command: 'command', match: 'match' },
      { table: 'private.match_action_commands', command: 'command', match: 'match' },
    ],
  },
] as const;
for (const owner of receiptRetentionSources) {
  const sql = readFileSync(new URL(`../supabase/migrations/${owner.file}`, import.meta.url), 'utf8')
    .replace(/--[^\n]*/gu, '').replace(/\s+/gu, ' ');
  const cutoffDays = sql.match(new RegExp(
    `select private\\.${owner.purge}\\(\\s*clock_timestamp\\(\\) - interval '(\\d+) days'`,
    'u',
  ))?.[1];
  check(cutoffDays === LEGAL_RELEASE.facts.commandReceiptRetentionDays,
    `${owner.file} cutoff differs from the legal receipt-retention fact`);
  const schedule = sql.match(new RegExp(
    `cron\\.schedule\\(\\s*'${owner.job}',\\s*'([^']+)'`, 'u',
  ))?.[1] ?? '';
  check(/^[0-5]?\d \* \* \* \*$/u.test(schedule),
    `${owner.file} no longer schedules the disclosed hourly receipt cleanup`);
  for (const { table, command, match } of owner.tables) {
    const predicates = sql.match(new RegExp(
      `from ${table.replaceAll('.', '\\.')} ${command} where ([\\s\\S]*?) order by`, 'u',
    ))?.[1] ?? '';
    check(predicates.includes(`${command}.created_at < p_cutoff`)
      && predicates.includes(`${match}.status <> 'active'`)
      && predicates.includes(`${match}.finished_at < p_cutoff`)
      && predicates.includes('), false)'),
    `${table} retention must require an old receipt and a match finished before the same cutoff`);
  }
}
const appleCredentialsSql = readFileSync(new URL(
  '../supabase/migrations/20260826153102_apple_identity_credentials.sql', import.meta.url,
), 'utf8');
const appleStage = appleCredentialsSql
  .match(/create function public\.stage_apple_revocation\b[\s\S]*?\$\$;/u)?.[0] ?? '';
check(appleStage.match(/expires_at = now\(\) \+ interval '(\d+) days'/u)?.[1]
  === LEGAL_RELEASE.facts.appleRevocationRetryDays,
'Apple credential expiry differs from the legal revocation retry-window fact');
const legalEvidence = readFileSync(new URL('../docs/LEGAL.md', import.meta.url), 'utf8');
check(legalEvidence.match(/`apple-revocation-retry`[^\n]*(?:\n[^\n]*){0,3}?`\*\/(\d+) \* \* \* \*`/u)?.[1]
  === LEGAL_RELEASE.facts.appleRevocationScheduleMinutes,
'Apple scheduler fact differs from the recorded live cron evidence in docs/LEGAL.md');

check(LEGAL_RELEASE.status === 'draft', 'checked-in legal publication status is not draft');
check(generateLegalPageFiles(LEGAL_RELEASE).size === 0,
  'draft publication emitted public legal files');
check(generatedLegalPaths(LEGAL_RELEASE).length === 0,
  'draft publication exposed service-worker legal routes');
check(legalPublicationProblems(LEGAL_RELEASE).length > 0,
  'draft production facts accidentally satisfy the release gate');
check(!LEGAL_HOME_NAV_MARKUP,
  'draft publication exposed a Home legal door');
check(navigationPages(LEGAL_SETTINGS_NAV_MARKUP).join() === 'imprint,privacy'
  && navigationPages(LEGAL_AUTH_NAV_MARKUP).join() === 'privacy',
  'draft placeholder doors are not exactly Settings Imprint/Privacy plus auth Privacy');
const expectedGermanyNames = {
  en: 'Germany', pt: 'Alemanha', es: 'Alemania',
  de: 'Deutschland', fr: 'Allemagne', it: 'Germania',
  pl: 'Niemcy', tr: 'Almanya', id: 'Jerman', ja: 'ドイツ', ko: '독일',
} as const;
for (const { id } of LOCALE_REGISTRY) {
  const imprint = renderLegalDocumentBody(legalDocument(id, 'imprint', LEGAL_RELEASE.facts, LEGAL_RELEASE.status));
  const privacy = renderLegalDocumentBody(legalDocument(id, 'privacy', LEGAL_RELEASE.facts, LEGAL_RELEASE.status));
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
for (const { id } of LOCALE_REGISTRY) {
  for (const page of LEGAL_PAGE_IDS) {
    const published = legalDocument(id, page, fixture.facts);
    const draft = legalDocument(id, page, fixture.facts, 'draft');
    const warning = LEGAL_CONTENT[id].pendingFact;
    check(draft.intro === `${warning}\n\n${published.intro}`,
      `${id}/${page} draft document did not lead with its localized publication warning`);
    check(renderLegalDocumentBody(draft)
      .includes(`<p class="legal-intro">${escapeHtml(warning)}<br><br>`),
    `${id}/${page} draft warning was not visibly separated from the introduction`);
    check(!published.intro.includes(warning),
      `${id}/${page} ready document displayed a draft warning`);
  }
}
const unicodeEmailFixture = {
  ...fixture,
  facts: { ...fixture.facts, publicEmail: 'müller@example.test' },
};
check(legalPublicationProblems(unicodeEmailFixture).includes('publicEmail is missing or invalid'),
  'ready gate accepted an email address the renderer cannot link exactly');
const fixtureEmail = fixture.facts.publicEmail;
check(typeof fixtureEmail === 'string', 'complete legal fixture has no public email');
for (const { id } of LOCALE_REGISTRY) {
  const mailtoTargets = LEGAL_PAGE_IDS.flatMap((page) =>
    [...renderLegalDocumentBody(legalDocument(id, page, fixture.facts))
      .matchAll(/href="mailto:([^"]+)"/gu)].map((match) => match[1]));
  check(mailtoTargets.length > 0,
    `${id} legal documents did not render the fixture email`);
  check(mailtoTargets.every((target) => target === fixtureEmail),
    `${id} legal documents absorbed localized prose into a mailto target`);
}
const fixtureUrl = 'https://privacy.example.test/account-deletion/ownership-verification';
const localizedUrl = Object.fromEntries(LOCALE_REGISTRY.map(({ id }) => [id, fixtureUrl])) as LocalizedLegalFact;
for (const { id } of LOCALE_REGISTRY) {
  const privacy = renderLegalDocumentBody(legalDocument(id, 'privacy', {
    ...fixture.facts,
    cloudflareProcessingScope: localizedUrl,
  }));
  check(privacy.includes(`<a href="${fixtureUrl}">${fixtureUrl}</a>`),
    `${id} privacy document absorbed localized prose into an HTTPS target`);
}
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
const incompleteRetentionFixture = {
  ...fixture,
  facts: {
    ...fixture.facts,
    backupRetention: { ...fixture.facts.backupRetention!, ja: ' ' },
  },
};
check(legalPublicationProblems(incompleteRetentionFixture).includes('backupRetention.ja is missing'),
  'ready gate accepted backup retention without its Japanese translation');
const scalarFunctionsFixture = {
  ...fixture,
  facts: {
    ...fixture.facts,
    supabaseFunctionsRegion: 'English function-region explanation' as unknown as LocalizedLegalFact,
  },
};
for (const { id } of LOCALE_REGISTRY) {
  check(legalPublicationProblems(scalarFunctionsFixture).includes(`supabaseFunctionsRegion.${id} is missing`),
    `ready gate accepted scalar function-region prose for ${id}`);
}
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

const missingGermanRights = {
  ...LEGAL_CONTENT,
  de: {
    ...LEGAL_CONTENT.de,
    pages: {
      ...LEGAL_CONTENT.de.pages,
      privacy: {
        ...LEGAL_CONTENT.de.pages.privacy,
        sections: LEGAL_CONTENT.de.pages.privacy.sections
          .filter((section) => section.id !== 'rights'),
      },
    },
  },
};
expectContentRejection(missingGermanRights,
  'legalContent.de.privacy.sections.rights is missing',
  'ready gate accepted a German privacy notice without the complete rights section');

expectContentRejection({
  ...LEGAL_CONTENT,
  de: {
    ...LEGAL_CONTENT.de,
    pages: {
      ...LEGAL_CONTENT.de.pages,
      privacy: {
        ...LEGAL_CONTENT.de.pages.privacy,
        sections: LEGAL_CONTENT.de.pages.privacy.sections.map((section) => section.id === 'rights'
          ? { ...section, blocks: section.blocks.slice(1) }
          : section),
      },
    },
  },
}, 'legalContent.de.privacy.sections.rights has different block structure from en',
'ready gate accepted the rights section after removing the paragraph explaining those rights');

expectContentRejection({
  ...LEGAL_CONTENT,
  de: {
    ...LEGAL_CONTENT.de,
    pages: {
      ...LEGAL_CONTENT.de.pages,
      support: {
        ...LEGAL_CONTENT.de.pages.support,
        sections: LEGAL_CONTENT.de.pages.support.sections.map((section) => section.id === 'help'
          ? { ...section, blocks: section.blocks.map((block) => block.kind === 'list'
              ? { ...block, items: block.items?.slice(1) }
              : block) }
          : section),
      },
    },
  },
}, 'legalContent.de.support.sections.help has different block structure from en',
'ready gate accepted a translated support list with an omitted item');

const { childPrivacyReviewed: _missingChildReview, ...incompleteReviewChecks } = fixture.checks;
check(legalPublicationProblems({
  ...fixture,
  checks: incompleteReviewChecks as LegalReleaseChecks,
}).includes('childPrivacyReviewed is not complete'),
'ready gate accepted omitted child-privacy review approval');

expectContentRejection({
  ...LEGAL_CONTENT,
  de: {
    ...LEGAL_CONTENT.de,
    pages: {
      ...LEGAL_CONTENT.de.pages,
      imprint: {
        ...LEGAL_CONTENT.de.pages.imprint,
        sections: [
          ...LEGAL_CONTENT.de.pages.imprint.sections,
          LEGAL_CONTENT.de.pages.imprint.sections[0],
        ],
      },
    },
  },
}, `legalContent.de.imprint.sections[${LEGAL_CONTENT.de.pages.imprint.sections.length}].id duplicates provider`,
'ready gate accepted a duplicated provider section');

expectContentRejection({
  ...LEGAL_CONTENT,
  de: {
    ...LEGAL_CONTENT.de,
    pages: {
      ...LEGAL_CONTENT.de.pages,
      imprint: {
        ...LEGAL_CONTENT.de.pages.imprint,
        sections: LEGAL_CONTENT.de.pages.imprint.sections.map((section, index) => index === 0
          ? { ...section, id: 'rights' as const }
          : section),
      },
    },
  },
}, 'legalContent.de.imprint.sections[0].id is invalid',
'ready gate accepted a section belonging to another legal page');

expectContentRejection({
  ...LEGAL_CONTENT,
  de: {
    ...LEGAL_CONTENT.de,
    pages: {
      ...LEGAL_CONTENT.de.pages,
      privacy: {
        ...LEGAL_CONTENT.de.pages.privacy,
        sections: LEGAL_CONTENT.de.pages.privacy.sections.map((section) => section.id === 'controller'
          ? { ...section, blocks: section.blocks.map((block) => ({
              ...block,
              text: block.text?.replaceAll('{{publicEmail}}', 'privacy@example.test'),
            })) }
          : section),
      },
    },
  },
}, 'legalContent.de.privacy.sections.controller has different fact tokens from en',
'ready gate accepted a translated section that replaced the public contact fact with a literal');

for (const { id } of LOCALE_REGISTRY) {
  const marker = LEGAL_CONTENT[id].pendingFact;
  const pendingFactFixture = { ...fixture, facts: { ...fixture.facts, smtpProvider: marker } };
  check(legalPublicationProblems(pendingFactFixture)
    .includes('smtpProvider contains a pending publication marker'),
  `ready gate accepted the ${id} placeholder as a verified scalar fact`);
  const pendingLocalizedFactFixture = {
    ...fixture,
    facts: { ...fixture.facts, supportRetention: { ...fixture.facts.supportRetention!, [id]: marker } },
  };
  check(legalPublicationProblems(pendingLocalizedFactFixture)
    .includes(`supportRetention.${id} contains a pending publication marker`),
  `ready gate accepted the ${id} placeholder as verified localized retention`);
  expectContentRejection({
    ...LEGAL_CONTENT,
    [id]: {
      ...LEGAL_CONTENT[id],
      pages: {
        ...LEGAL_CONTENT[id].pages,
        support: { ...LEGAL_CONTENT[id].pages.support, intro: marker },
      },
    },
  }, `legalContent.${id}.support contains a pending publication marker`,
  `ready gate accepted a literal ${id} placeholder in publication copy`);
}

const files = generateLegalPageFiles(fixture);
const expectedCount = LOCALE_REGISTRY.length * LEGAL_PAGE_IDS.length;
check(expectedCount === 44, `supported locale/page matrix is ${expectedCount}, expected 44`);
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
    check(!html.includes('{{')
      && LOCALE_REGISTRY.every(({ id }) => !html.includes(LEGAL_CONTENT[id].pendingFact)),
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
