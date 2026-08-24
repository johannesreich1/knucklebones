/** Widen an English catalog's string literals while preserving its exact key tree. */
export type CatalogShape<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: CatalogShape<T[K]> }
    : T extends object
      ? { [K in keyof T]: CatalogShape<T[K]> }
      : T;

/** Dot-separated paths to every string leaf in a catalog namespace. */
export type StringLeafPaths<T> = T extends object
  ? {
      [K in Extract<keyof T, string>]: T[K] extends string
        ? K
        : T[K] extends object
          ? `${K}.${StringLeafPaths<T[K]>}`
          : never;
    }[Extract<keyof T, string>]
  : never;

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
type PluralBase<Path extends string> = Path extends `${infer Base}_${infer Category}`
  ? Category extends PluralCategory ? Base : never
  : never;

/** Catalog leaf paths plus i18next's virtual base key for plural families. */
export type TranslationLeafPaths<T> = StringLeafPaths<T> extends infer Path
  ? Path extends string ? Path | PluralBase<Path> : never
  : never;
