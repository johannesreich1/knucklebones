import { LEGAL_PAGE_IDS, type LegalPageId } from './types.ts';

export interface LegalPageSpec {
  readonly id: LegalPageId;
  readonly domSuffix: string;
}

const DOM_SUFFIXES: Readonly<Record<LegalPageId, string>> = {
  imprint: 'Imprint',
  privacy: 'Privacy',
  support: 'Support',
  'delete-account': 'DeleteAccount',
};

export const LEGAL_PAGE_REGISTRY: readonly LegalPageSpec[] = Object.freeze(
  LEGAL_PAGE_IDS.map((id) => ({ id, domSuffix: DOM_SUFFIXES[id] })),
);

export function legalPageSpec(page: LegalPageId): LegalPageSpec {
  return LEGAL_PAGE_REGISTRY.find(({ id }) => id === page)!;
}
