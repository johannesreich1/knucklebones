import { LOCALE_REGISTRY, type SupportedLocale } from '../i18n/locale.ts';
import type { LegalLocaleContent } from './types.ts';
import { DE_LEGAL } from './locales/de.ts';
import { EN_LEGAL } from './locales/en.ts';
import { ES_LEGAL } from './locales/es.ts';
import { FR_LEGAL } from './locales/fr.ts';
import { IT_LEGAL } from './locales/it.ts';
import { PT_LEGAL } from './locales/pt.ts';

export const LEGAL_CONTENT: Readonly<Record<SupportedLocale, LegalLocaleContent>> = {
  en: EN_LEGAL,
  pt: PT_LEGAL,
  es: ES_LEGAL,
  de: DE_LEGAL,
  fr: FR_LEGAL,
  it: IT_LEGAL,
};

for (const { id } of LOCALE_REGISTRY) {
  if (!LEGAL_CONTENT[id]) throw new Error(`Missing legal content for supported locale: ${id}`);
}

export function legalLocaleContent(locale: SupportedLocale): LegalLocaleContent {
  return LEGAL_CONTENT[locale];
}
