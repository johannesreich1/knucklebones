type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
type PluralSiblingKey<Key extends string> = Key extends `${infer Base}_${infer Category}`
  ? Category extends PluralCategory ? `${Base}_${PluralCategory}` : never
  : never;
type PluralSiblingKeys<T> = PluralSiblingKey<Extract<keyof T, string>>;

/** Widen an English catalog's string literals while preserving its key tree.
    A locale may add the CLDR plural-category siblings its grammar requires. */
export type CatalogShape<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: CatalogShape<T[K]> }
    : T extends object
      ? { [K in keyof T]: CatalogShape<T[K]> }
        & { [K in Exclude<PluralSiblingKeys<T>, keyof T>]?: string }
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

type PluralBase<Path extends string> = Path extends `${infer Base}_${infer Category}`
  ? Category extends PluralCategory ? Base : never
  : never;

/** Catalog leaf paths plus i18next's virtual base key for plural families. */
export type TranslationLeafPaths<T> = StringLeafPaths<T> extends infer Path
  ? Path extends string ? Path | PluralBase<Path> : never
  : never;
