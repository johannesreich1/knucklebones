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
import { esCommon } from './locales/es/common.ts';
import { esGame } from './locales/es/game.ts';
import { esLearn } from './locales/es/learn.ts';
import { esOnline } from './locales/es/online.ts';
import { esSettings } from './locales/es/settings.ts';
import { frCommon } from './locales/fr/common.ts';
import { frGame } from './locales/fr/game.ts';
import { frLearn } from './locales/fr/learn.ts';
import { frOnline } from './locales/fr/online.ts';
import { frSettings } from './locales/fr/settings.ts';
import { itCommon } from './locales/it/common.ts';
import { itGame } from './locales/it/game.ts';
import { itLearn } from './locales/it/learn.ts';
import { itOnline } from './locales/it/online.ts';
import { itSettings } from './locales/it/settings.ts';
import { ptCommon } from './locales/pt/common.ts';
import { ptGame } from './locales/pt/game.ts';
import { ptLearn } from './locales/pt/learn.ts';
import { ptOnline } from './locales/pt/online.ts';
import { ptSettings } from './locales/pt/settings.ts';

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
  pt: {
    common: ptCommon,
    settings: ptSettings,
    game: ptGame,
    online: ptOnline,
    learn: ptLearn,
  },
  es: {
    common: esCommon,
    settings: esSettings,
    game: esGame,
    online: esOnline,
    learn: esLearn,
  },
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
  it: {
    common: itCommon,
    settings: itSettings,
    game: itGame,
    online: itOnline,
    learn: itLearn,
  },
} as const;
