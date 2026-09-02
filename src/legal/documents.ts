import {
  LOCALE_REGISTRY,
  type SupportedLocale,
} from '../i18n/locale.ts';
import { LEGAL_CONTENT, legalLocaleContent } from './content.ts';
import { isLinkablePublicEmail } from './render.ts';
import {
  LEGAL_FACT_KEYS,
  LEGAL_PAGE_IDS,
  type LegalContentBlock,
  type LegalContentSection,
  type LegalDocument,
  type LegalFactKey,
  type LegalFacts,
  type LegalLocaleContent,
  type LegalPageContent,
  type LegalPageId,
  type LegalPublicationConfig,
} from './types.ts';

const FACT_TOKENS = new Set<string>(LEGAL_FACT_KEYS);
const LOCALIZED_FACTS = new Set<LegalFactKey>([
  'controllerCountry',
  'authorityCountry',
  'cloudflareProcessingScope',
  'transferSafeguards',
  'deletionVerification',
]);
const LEGAL_CHROME_FIELDS = {
  siteTitle: true,
  languageLabel: true,
  pageNavigationLabel: true,
  languageNavigationLabel: true,
  homeLabel: true,
  backLabel: true,
  pendingFact: true,
} as const satisfies Readonly<Record<Exclude<keyof LegalLocaleContent, 'pages'>, true>>;
const LEGAL_PAGE_COPY_FIELDS = {
  title: true,
  shortTitle: true,
  description: true,
  intro: true,
} as const satisfies Readonly<Record<Exclude<keyof LegalPageContent, 'sections'>, true>>;
const LEGAL_CHROME_KEYS = Object.keys(LEGAL_CHROME_FIELDS) as
  (keyof typeof LEGAL_CHROME_FIELDS)[];
const LEGAL_PAGE_COPY_KEYS = Object.keys(LEGAL_PAGE_COPY_FIELDS) as
  (keyof typeof LEGAL_PAGE_COPY_FIELDS)[];

export type LegalContentRegistry = Readonly<
  Partial<Record<SupportedLocale, LegalLocaleContent>>
>;

function scalarFact(facts: LegalFacts, key: LegalFactKey): string | null {
  const value = facts[key];
  return typeof value === 'string' ? value : null;
}

function factValue(
  facts: LegalFacts,
  locale: SupportedLocale,
  key: LegalFactKey,
): string | null {
  if (LOCALIZED_FACTS.has(key)) {
    const localized = facts[key] as Readonly<Record<SupportedLocale, string>> | null;
    return localized?.[locale] ?? null;
  }
  return scalarFact(facts, key);
}

function resolveTemplate(template: string, locale: SupportedLocale, facts: LegalFacts): string {
  const pending = legalLocaleContent(locale).pendingFact;
  return template.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu, (_match, rawKey: string) => {
    if (!FACT_TOKENS.has(rawKey)) throw new TypeError(`Unknown legal fact token: ${rawKey}`);
    return factValue(facts, locale, rawKey as LegalFactKey)?.trim() || pending;
  });
}

export function legalDocument(
  locale: SupportedLocale,
  page: LegalPageId,
  facts: LegalFacts,
): LegalDocument {
  const source = legalLocaleContent(locale).pages[page];
  return {
    locale,
    page,
    title: source.title,
    shortTitle: source.shortTitle,
    description: source.description,
    intro: resolveTemplate(source.intro, locale, facts),
    sections: source.sections.map((section) => ({
      heading: section.heading,
      blocks: section.blocks.map((block) => block.kind === 'paragraph'
        ? { kind: 'paragraph', text: resolveTemplate(block.text ?? '', locale, facts) }
        : {
            kind: 'list',
            items: (block.items ?? []).map((item) => resolveTemplate(item, locale, facts)),
          }),
    })),
  };
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function legalTextProblems(value: string, path: string): string[] {
  const problems: string[] = [];
  for (const match of value.matchAll(/\{\{([^}]+)\}\}/gu)) {
    if (!FACT_TOKENS.has(match[1])) problems.push(`${path} has unknown legal fact token ${match[1]}`);
  }
  return problems;
}

export function legalContentProblems(
  content: LegalContentRegistry = LEGAL_CONTENT,
): string[] {
  const problems: string[] = [];
  for (const { id } of LOCALE_REGISTRY) {
    const locale = content[id];
    if (!locale) {
      problems.push(`legalContent.${id} is missing`);
      continue;
    }
    for (const key of LEGAL_CHROME_KEYS) {
      if (!nonEmpty(locale[key])) problems.push(`legalContent.${id}.${key} is missing`);
    }
    for (const page of LEGAL_PAGE_IDS) {
      const document = locale.pages?.[page];
      if (!document) {
        problems.push(`legalContent.${id}.${page} is missing`);
        continue;
      }
      for (const key of LEGAL_PAGE_COPY_KEYS) {
        const path = `legalContent.${id}.${page}.${key}`;
        if (!nonEmpty(document[key])) problems.push(`${path} is missing`);
        else problems.push(...legalTextProblems(document[key], path));
      }
      const sections = document.sections as readonly LegalContentSection[] | undefined;
      if (!Array.isArray(sections) || !sections.length) {
        problems.push(`legalContent.${id}.${page}.sections is empty`);
        continue;
      }
      sections.forEach((section: LegalContentSection, sectionIndex: number) => {
        const sectionPath = `legalContent.${id}.${page}.sections[${sectionIndex}]`;
        if (!nonEmpty(section?.heading)) problems.push(`${sectionPath}.heading is missing`);
        const blocks = section?.blocks as readonly LegalContentBlock[] | undefined;
        if (!Array.isArray(blocks) || !blocks.length) {
          problems.push(`${sectionPath}.blocks is empty`);
          return;
        }
        blocks.forEach((block: LegalContentBlock, blockIndex: number) => {
          const blockPath = `${sectionPath}.blocks[${blockIndex}]`;
          if (block?.kind === 'paragraph') {
            if (!nonEmpty(block.text)) problems.push(`${blockPath}.text is missing`);
            else problems.push(...legalTextProblems(block.text ?? '', `${blockPath}.text`));
            return;
          }
          if (block?.kind === 'list') {
            const items = block.items as readonly string[] | undefined;
            if (!Array.isArray(items) || !items.length) {
              problems.push(`${blockPath}.items is empty`);
              return;
            }
            items.forEach((item: string, itemIndex: number) => {
              const itemPath = `${blockPath}.items[${itemIndex}]`;
              if (!nonEmpty(item)) problems.push(`${itemPath} is missing`);
              else problems.push(...legalTextProblems(item, itemPath));
            });
            return;
          }
          problems.push(`${blockPath}.kind is invalid`);
        });
      });
    }
  }
  return problems;
}

export function legalPublicationProblems(
  config: LegalPublicationConfig,
  content: LegalContentRegistry = LEGAL_CONTENT,
): string[] {
  const problems: string[] = [];
  let origin: URL | undefined;
  try { origin = new URL(config.canonicalOrigin); } catch { /* reported below */ }
  if (!origin || origin.protocol !== 'https:' || origin.pathname !== '/'
      || origin.username || origin.password || origin.search || origin.hash) {
    problems.push('canonicalOrigin must be an HTTPS origin without a path');
  }
  for (const key of [
    'controllerName',
    'controllerStreet',
    'controllerPostalCity',
    'authorityName',
    'authorityStreet',
    'authorityPostalCity',
  ] as const) {
    if (!nonEmpty(config.facts[key])) problems.push(`${key} is missing`);
  }
  if (!nonEmpty(config.facts.publicEmail)
      || !isLinkablePublicEmail(config.facts.publicEmail ?? '')) {
    problems.push('publicEmail is missing or invalid');
  }
  for (const key of [
    'supabaseDatabaseRegion',
    'supabaseFunctionsRegion',
    'securityLogRetention',
    'backupRetention',
    'smtpProvider',
  ] as const) {
    if (!nonEmpty(config.facts[key])) problems.push(`${key} is missing`);
  }
  for (const key of LOCALIZED_FACTS) {
    const value = config.facts[key] as Readonly<Record<SupportedLocale, string>> | null;
    for (const { id } of LOCALE_REGISTRY) {
      if (!nonEmpty(value?.[id])) problems.push(`${key}.${id} is missing`);
    }
  }
  for (const [key, complete] of Object.entries(config.checks)) {
    if (!complete) problems.push(`${key} is not complete`);
  }
  problems.push(...legalContentProblems(content));
  return problems;
}

export function assertLegalPublicationReady(
  config: LegalPublicationConfig,
  content: LegalContentRegistry = LEGAL_CONTENT,
): void {
  if (config.status !== 'ready') throw new Error('Legal publication status is draft');
  const problems = legalPublicationProblems(config, content);
  if (problems.length) throw new Error(`Legal publication is not ready:\n- ${problems.join('\n- ')}`);
}

export function validateLegalContent(content: LegalContentRegistry = LEGAL_CONTENT): void {
  const problems = legalContentProblems(content);
  if (problems.length) throw new Error(`Incomplete legal content:\n- ${problems.join('\n- ')}`);
}

validateLegalContent();
