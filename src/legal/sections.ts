/* The section table moved to types.ts (2026-09-05): defined here it imported
   LegalPageId from types.ts while types.ts imported LegalSectionId back — a
   type-only cycle the architecture gate refuses. Re-exported so nothing that
   reaches for './sections.ts' has to move. */
export { LEGAL_SECTION_IDS } from './types.ts';
export type { LegalSectionId } from './types.ts';
