import type { TranslationLeafPaths } from './catalog-shape.ts';
import { deCommon } from './locales/de/common.ts';
import { deGame } from './locales/de/game.ts';
import { deLearn } from './locales/de/learn.ts';
import { deOnline } from './locales/de/online.ts';
import { deSettings } from './locales/de/settings.ts';
import { enCommon } from './locales/en/common.ts';
import { enGame } from './locales/en/game.ts';
import { enLearn } from './locales/en/learn.ts';
import { enOnline } from './locales/en/online.ts';
import { enSettings } from './locales/en/settings.ts';
import { frCommon } from './locales/fr/common.ts';
import { frGame } from './locales/fr/game.ts';
import { frLearn } from './locales/fr/learn.ts';
import { frOnline } from './locales/fr/online.ts';
import { frSettings } from './locales/fr/settings.ts';

export const ENGLISH_CATALOG = {
  common: enCommon,
  settings: enSettings,
  game: enGame,
  online: enOnline,
  learn: enLearn,
} as const;

export type LocaleNamespace = keyof typeof ENGLISH_CATALOG;
export type LocaleKey<Namespace extends LocaleNamespace> =
  TranslationLeafPaths<(typeof ENGLISH_CATALOG)[Namespace]>;

export const LOCALE_NAMESPACES = Object.freeze(
  Object.keys(ENGLISH_CATALOG) as LocaleNamespace[],
);

export const RESOURCES = {
  en: ENGLISH_CATALOG,
  de: {
    common: deCommon,
    settings: deSettings,
    game: deGame,
    online: deOnline,
    learn: deLearn,
  },
  fr: {
    common: frCommon,
    settings: frSettings,
    game: frGame,
    online: frOnline,
    learn: frLearn,
  },
} as const;
