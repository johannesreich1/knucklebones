import { LOCALE_REGISTRY, type SupportedLocale } from '../../src/i18n/locale.ts';
import type {
  LegalPublicationConfig,
  LocalizedLegalFact,
} from '../../src/legal/types.ts';

function localized(label: string): LocalizedLegalFact {
  return Object.fromEntries(LOCALE_REGISTRY.map(({ id }) => [id, `${label} (${id})`])) as
    Record<SupportedLocale, string>;
}

export function completeLegalFixture(): LegalPublicationConfig {
  return {
    status: 'ready',
    canonicalOrigin: 'https://knucklebones-asg.pages.dev',
    facts: {
      noticeDate: '2026-09-05',
      commandReceiptRetentionDays: '7',
      appleRevocationRetryDays: '7',
      appleRevocationScheduleMinutes: '5',
      controllerName: 'Fixture Controller',
      controllerStreet: '1 Test Street',
      controllerPostalCity: '12345 Test City',
      controllerCountry: localized('fixture controller country'),
      publicEmail: 'privacy@example.test',
      authorityName: 'Fixture Authority',
      authorityStreet: '2 Review Road',
      authorityPostalCity: '54321 Review City',
      authorityCountry: localized('fixture authority country'),
      supabaseDatabaseRegion: 'fixture-db-region',
      supabaseFunctionsRegion: localized('fixture functions region'),
      cloudflareProcessingScope: localized('fixture delivery scope'),
      securityLogRetention: localized('fixture security period'),
      backupRetention: localized('fixture backup period'),
      transferSafeguards: localized('fixture transfer safeguard'),
      smtpProvider: 'Fixture Mail Provider',
      smtpRetention: localized('fixture mail retention'),
      supportProcessing: localized('fixture support processing'),
      supportRetention: localized('fixture support retention'),
      deletionVerification: localized('fixture ownership verification'),
    },
    checks: {
      legalReviewComplete: true,
      translationsReviewed: true,
      processorFactsVerified: true,
      childPrivacyReviewed: true,
      deletionWorkflowVerified: true,
    },
  };
}
