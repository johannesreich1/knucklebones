import type { LegalPublicationConfig, LocalizedLegalFact } from './types.ts';

const GERMANY_NAMES: LocalizedLegalFact = Object.freeze({
  en: 'Germany',
  pt: 'Alemanha',
  es: 'Alemania',
  de: 'Deutschland',
  fr: 'Allemagne',
  it: 'Germania',
  pl: 'Niemcy',
  tr: 'Almanya',
  id: 'Jerman',
  ja: 'ドイツ',
  ko: '독일',
});

/**
 * Publication is deliberately fail-closed. Changing this to `ready` makes the
 * build validate every fact and review flag before it can emit a public page.
 */
export const LEGAL_RELEASE: LegalPublicationConfig = {
  status: 'draft',
  canonicalOrigin: 'https://knucklebones-asg.pages.dev',
  facts: {
    controllerName: 'Johannes Reich',
    controllerStreet: 'Krumpterstr. 4',
    controllerPostalCity: '81543 München',
    controllerCountry: GERMANY_NAMES,
    publicEmail: null,
    authorityName: 'Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)',
    authorityStreet: 'Promenade 18',
    authorityPostalCity: '91522 Ansbach',
    authorityCountry: GERMANY_NAMES,
    supabaseDatabaseRegion: null,
    supabaseFunctionsRegion: null,
    cloudflareProcessingScope: null,
    securityLogRetention: null,
    backupRetention: null,
    transferSafeguards: null,
    smtpProvider: null,
    deletionVerification: null,
  },
  checks: {
    legalReviewComplete: false,
    translationsReviewed: false,
    processorFactsVerified: false,
    childPrivacyReviewed: false,
    deletionWorkflowVerified: false,
  },
};
