import type { LegalPageId } from './types.ts';

/** Every translation must cover the same reviewed legal subjects exactly once. */
export const LEGAL_SECTION_IDS = {
  imprint: ['provider', 'contact', 'project'],
  privacy: [
    'controller', 'scope', 'device-storage', 'accounts', 'apple', 'purposes',
    'recipients', 'public-profile', 'retention', 'support', 'rights', 'objection',
    'children', 'automated-decisions', 'changes',
  ],
  support: ['contact', 'help', 'details', 'credentials', 'handling'],
  'delete-account': ['in-app', 'server-data', 'local-data', 'external', 'verification', 'apple'],
} as const satisfies Readonly<Record<LegalPageId, readonly string[]>>;

export type LegalSectionId = typeof LEGAL_SECTION_IDS[LegalPageId][number];
