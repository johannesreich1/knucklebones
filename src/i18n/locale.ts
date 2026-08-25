/** The only roster of supported locales. Add future languages here and add catalogs. */
export const LOCALE_REGISTRY = [
  { id: 'en', languageTag: 'en', selfName: 'English' },
  { id: 'pt', languageTag: 'pt-BR', selfName: 'Português (Brasil)' },
  { id: 'es', languageTag: 'es', selfName: 'Español' },
  { id: 'de', languageTag: 'de', selfName: 'Deutsch' },
  { id: 'fr', languageTag: 'fr', selfName: 'Français' },
  { id: 'it', languageTag: 'it', selfName: 'Italiano' },
] as const;

export type SupportedLocale = typeof LOCALE_REGISTRY[number]['id'];
/** `null` means automatic browser/system selection; persisted settings use DB NULL. */
export type LanguageOverride = SupportedLocale | null;

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = Object.freeze(
  LOCALE_REGISTRY.map(({ id }) => id),
);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string'
    && SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function isLanguageOverride(value: unknown): value is LanguageOverride {
  return value === null || isSupportedLocale(value);
}

export function localeSelfName(locale: SupportedLocale): string {
  return LOCALE_REGISTRY.find(({ id }) => id === locale)!.selfName;
}

/** BCP-47 tag for HTML, Intl, native metadata, and other presentation APIs. */
export function localeLanguageTag(locale: SupportedLocale): string {
  return LOCALE_REGISTRY.find(({ id }) => id === locale)!.languageTag;
}

export interface LanguageSource {
  readonly languages?: readonly string[];
  readonly language?: string;
}

function browserLanguageSource(): LanguageSource | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

/** Normalize BCP-47 language and region variants to the supported base language. */
export function normalizeLanguageTag(tag: string): string {
  return tag.trim().replace(/_/gu, '-').split('-', 1)[0].toLowerCase();
}

/** Browser preference order: `languages`, then the single-language fallback. */
export function navigatorLanguageTags(
  source: LanguageSource | undefined = browserLanguageSource(),
): readonly string[] {
  if (!source) return [];
  const ordered = [...(source.languages ?? []), source.language ?? ''];
  const seen = new Set<string>();
  return ordered.filter((tag) => {
    if (typeof tag !== 'string' || !tag.trim()) return false;
    const identity = tag.trim().toLowerCase();
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function resolveSystemLocale(
  languageTags: readonly string[] = navigatorLanguageTags(),
): SupportedLocale {
  for (const tag of languageTags) {
    const candidate = normalizeLanguageTag(tag);
    if (isSupportedLocale(candidate)) return candidate;
  }
  return 'en';
}

export function resolveLocale(
  override: LanguageOverride,
  languageTags: readonly string[] = navigatorLanguageTags(),
): SupportedLocale {
  return override ?? resolveSystemLocale(languageTags);
}
