import { createInstance } from 'i18next';
import {
  LOCALE_NAMESPACES,
  RESOURCES,
  type LocaleKey,
  type LocaleNamespace,
} from './catalogs.ts';
import {
  SUPPORTED_LOCALES,
  isLanguageOverride,
  localeLanguageTag,
  navigatorLanguageTags,
  resolveLocale,
  resolveSystemLocale,
  type LanguageOverride,
  type SupportedLocale,
} from './locale.ts';

let activeOverride: LanguageOverride = null;
let activeLocale: SupportedLocale = resolveSystemLocale();

/* Resources are bundled, and initAsync:false makes translations available in
   the same turn. No fetch, Suspense boundary, or first-paint language flash. */
const engine = createInstance();
let initializationError: Error | undefined;
void engine.init({
  resources: RESOURCES,
  lng: activeLocale,
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LOCALES],
  load: 'languageOnly',
  ns: [...LOCALE_NAMESPACES],
  defaultNS: 'common',
  initAsync: false,
  returnNull: false,
  interpolation: { escapeValue: false },
}, (error) => { initializationError = error ?? undefined; });
if (initializationError) throw initializationError;
if (!engine.isInitialized) throw new Error('Bundled translations did not initialize synchronously');

export interface LocaleChange {
  readonly override: LanguageOverride;
  readonly previousOverride: LanguageOverride;
  readonly locale: SupportedLocale;
  readonly previousLocale: SupportedLocale;
}

export type LocaleListener = (change: LocaleChange) => void;
const localeListeners = new Set<LocaleListener>();

export function languageOverride(): LanguageOverride {
  return activeOverride;
}

export function effectiveLocale(): SupportedLocale {
  return activeLocale;
}

function commitLocale(override: LanguageOverride, locale: SupportedLocale): LocaleChange | null {
  const previousOverride = activeOverride;
  const previousLocale = activeLocale;
  if (override === previousOverride && locale === previousLocale) return null;
  activeOverride = override;
  activeLocale = locale;
  const change = { override, previousOverride, locale, previousLocale } as const;
  for (const listener of [...localeListeners]) listener(change);
  return change;
}

/** Apply a player choice. Passing null returns to automatic system selection. */
export function setLanguageOverride(
  override: LanguageOverride,
  systemLanguageTags: readonly string[] = navigatorLanguageTags(),
): LocaleChange | null {
  if (!isLanguageOverride(override)) throw new TypeError(`Unsupported language override: ${String(override)}`);
  return commitLocale(override, resolveLocale(override, systemLanguageTags));
}

/** Re-evaluate the system language; explicit player choices remain untouched. */
export function refreshSystemLocale(
  systemLanguageTags: readonly string[] = navigatorLanguageTags(),
): LocaleChange | null {
  if (activeOverride !== null) return null;
  return commitLocale(null, resolveSystemLocale(systemLanguageTags));
}

export function subscribeLocale(listener: LocaleListener): () => void {
  localeListeners.add(listener);
  return () => { localeListeners.delete(listener); };
}

export interface TranslationValues {
  readonly [name: string]: unknown;
}

export function t<Namespace extends LocaleNamespace>(
  namespace: Namespace,
  key: LocaleKey<Namespace>,
  values: TranslationValues = {},
): string {
  const translate = engine.getFixedT(activeLocale, namespace) as (
    key: string,
    values?: TranslationValues,
  ) => string;
  return translate(key, values);
}

export interface TextTarget { textContent: string | null }

export function text<Namespace extends LocaleNamespace>(
  target: TextTarget,
  namespace: Namespace,
  key: LocaleKey<Namespace>,
  values?: TranslationValues,
): string {
  const translated = t(namespace, key, values);
  target.textContent = translated;
  return translated;
}

declare const trustedStaticRichBrand: unique symbol;
export type TrustedStaticRich = string & { readonly [trustedStaticRichBrand]: true };

/** HTML is allowed only from a bundled, interpolation-free catalog entry. */
export function trustedStaticRich<Namespace extends LocaleNamespace>(
  namespace: Namespace,
  key: LocaleKey<Namespace>,
): TrustedStaticRich {
  const raw = engine.getResource(activeLocale, namespace, key as string);
  if (typeof raw !== 'string') throw new TypeError(`Missing rich translation: ${namespace}:${key}`);
  if (/\{\{|\$t\(/u.test(raw)) {
    throw new TypeError(`Rich translation must be static: ${namespace}:${key}`);
  }
  return raw as TrustedStaticRich;
}

export function translationExists(namespace: LocaleNamespace, key: string): boolean {
  return engine.exists(key, { lng: 'en', ns: namespace });
}

type LanguageChangeTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
type ReadLanguageTags = () => readonly string[];

/** Listen where supported; native WebViews still resolve correctly at startup. */
export function bindSystemLanguageChanges(
  target: LanguageChangeTarget | null = typeof window === 'undefined' ? null : window,
  readLanguageTags: ReadLanguageTags = navigatorLanguageTags,
): () => void {
  if (!target) return () => {};
  const onLanguageChange = (): void => { refreshSystemLocale(readLanguageTags()); };
  target.addEventListener('languagechange', onLanguageChange);
  return () => { target.removeEventListener('languagechange', onLanguageChange); };
}

export function formatNumber(
  value: number | bigint,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(localeLanguageTag(activeLocale), options).format(value);
}

export function formatDate(
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(localeLanguageTag(activeLocale), options).format(value);
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions,
): string {
  return new Intl.RelativeTimeFormat(localeLanguageTag(activeLocale), options).format(value, unit);
}
