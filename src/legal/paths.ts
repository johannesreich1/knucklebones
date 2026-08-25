import type { SupportedLocale } from '../i18n/locale.ts';
import type { LegalPageId } from './types.ts';

export function legalPagePath(locale: SupportedLocale, page: LegalPageId): string {
  return `/legal/${locale}/${page}/`;
}

export function legalPageUrl(
  canonicalOrigin: string,
  locale: SupportedLocale,
  page: LegalPageId,
): string {
  return new URL(legalPagePath(locale, page), canonicalOrigin).href;
}
