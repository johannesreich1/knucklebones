/** Public localization facade. Callers never import catalogs or engine internals directly. */
export type { LocaleKey, LocaleNamespace } from './catalogs.ts';
export { ENGLISH_CATALOG, LOCALE_NAMESPACES, RESOURCES } from './catalogs.ts';
export * from './locale.ts';
export * from './runtime.ts';
export * from './dom.ts';
export * from './display.ts';
