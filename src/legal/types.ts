import type { SupportedLocale } from '../i18n/locale.ts';

export const LEGAL_PAGE_IDS = [
  'imprint',
  'privacy',
  'support',
  'delete-account',
] as const;

export type LegalPageId = typeof LEGAL_PAGE_IDS[number];
export type LegalPublicationStatus = 'draft' | 'ready';

export const LEGAL_FACT_KEYS = [
  'controllerName',
  'controllerStreet',
  'controllerPostalCity',
  'controllerCountry',
  'publicEmail',
  'authorityName',
  'authorityStreet',
  'authorityPostalCity',
  'authorityCountry',
  'supabaseDatabaseRegion',
  'supabaseFunctionsRegion',
  'cloudflareProcessingScope',
  'securityLogRetention',
  'backupRetention',
  'transferSafeguards',
  'smtpProvider',
  'deletionVerification',
] as const;

export type LegalFactKey = typeof LEGAL_FACT_KEYS[number];
export type LocalizedLegalFact = Readonly<Record<SupportedLocale, string>>;

export interface LegalFacts {
  readonly controllerName: string;
  readonly controllerStreet: string;
  readonly controllerPostalCity: string;
  readonly controllerCountry: LocalizedLegalFact;
  readonly publicEmail: string | null;
  readonly authorityName: string;
  readonly authorityStreet: string;
  readonly authorityPostalCity: string;
  readonly authorityCountry: LocalizedLegalFact;
  readonly supabaseDatabaseRegion: string | null;
  readonly supabaseFunctionsRegion: string | null;
  readonly cloudflareProcessingScope: LocalizedLegalFact | null;
  readonly securityLogRetention: string | null;
  readonly backupRetention: string | null;
  readonly transferSafeguards: LocalizedLegalFact | null;
  readonly smtpProvider: string | null;
  readonly deletionVerification: LocalizedLegalFact | null;
}

export interface LegalReleaseChecks {
  readonly legalReviewComplete: boolean;
  readonly translationsReviewed: boolean;
  readonly processorFactsVerified: boolean;
  readonly childPrivacyReviewed: boolean;
  readonly deletionWorkflowVerified: boolean;
}

export interface LegalPublicationConfig {
  readonly status: LegalPublicationStatus;
  readonly canonicalOrigin: string;
  readonly facts: LegalFacts;
  readonly checks: LegalReleaseChecks;
}

export interface LegalContentBlock {
  readonly kind: 'paragraph' | 'list';
  readonly text?: string;
  readonly items?: readonly string[];
}

export interface LegalContentSection {
  readonly heading: string;
  readonly blocks: readonly LegalContentBlock[];
}

export interface LegalPageContent {
  readonly title: string;
  readonly shortTitle: string;
  readonly description: string;
  readonly intro: string;
  readonly sections: readonly LegalContentSection[];
}

export interface LegalLocaleContent {
  readonly siteTitle: string;
  readonly languageLabel: string;
  readonly pageNavigationLabel: string;
  readonly languageNavigationLabel: string;
  readonly homeLabel: string;
  readonly backLabel: string;
  readonly pendingFact: string;
  readonly pages: Readonly<Record<LegalPageId, LegalPageContent>>;
}

export interface LegalBlock {
  readonly kind: 'paragraph' | 'list';
  readonly text?: string;
  readonly items?: readonly string[];
}

export interface LegalSection {
  readonly heading: string;
  readonly blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  readonly locale: SupportedLocale;
  readonly page: LegalPageId;
  readonly title: string;
  readonly shortTitle: string;
  readonly description: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
}
