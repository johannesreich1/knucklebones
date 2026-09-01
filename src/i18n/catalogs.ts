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
import { idCommon } from './locales/id/common.ts';
import { idGame } from './locales/id/game.ts';
import { idLearn } from './locales/id/learn.ts';
import { idOnline } from './locales/id/online.ts';
import { idSettings } from './locales/id/settings.ts';
import { jaCommon } from './locales/ja/common.ts';
import { jaGame } from './locales/ja/game.ts';
import { jaLearn } from './locales/ja/learn.ts';
import { jaOnline } from './locales/ja/online.ts';
import { jaSettings } from './locales/ja/settings.ts';
import { koCommon } from './locales/ko/common.ts';
import { koGame } from './locales/ko/game.ts';
import { koLearn } from './locales/ko/learn.ts';
import { koOnline } from './locales/ko/online.ts';
import { koSettings } from './locales/ko/settings.ts';
import { plCommon } from './locales/pl/common.ts';
import { plGame } from './locales/pl/game.ts';
import { plLearn } from './locales/pl/learn.ts';
import { plOnline } from './locales/pl/online.ts';
import { plSettings } from './locales/pl/settings.ts';
import { ptCommon } from './locales/pt/common.ts';
import { ptGame } from './locales/pt/game.ts';
import { ptLearn } from './locales/pt/learn.ts';
import { ptOnline } from './locales/pt/online.ts';
import { ptSettings } from './locales/pt/settings.ts';
import { trCommon } from './locales/tr/common.ts';
import { trGame } from './locales/tr/game.ts';
import { trLearn } from './locales/tr/learn.ts';
import { trOnline } from './locales/tr/online.ts';
import { trSettings } from './locales/tr/settings.ts';

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
  pl: {
    common: plCommon,
    settings: plSettings,
    game: plGame,
    online: plOnline,
    learn: plLearn,
  },
  tr: {
    common: trCommon,
    settings: trSettings,
    game: trGame,
    online: trOnline,
    learn: trLearn,
  },
  id: {
    common: idCommon,
    settings: idSettings,
    game: idGame,
    online: idOnline,
    learn: idLearn,
  },
  ja: {
    common: jaCommon,
    settings: jaSettings,
    game: jaGame,
    online: jaOnline,
    learn: jaLearn,
  },
  ko: {
    common: koCommon,
    settings: koSettings,
    game: koGame,
    online: koOnline,
    learn: koLearn,
  },
} as const;
