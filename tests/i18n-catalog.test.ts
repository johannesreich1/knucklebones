import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { GROUPS } from '../src/core/ladder.ts';
import { MODES } from '../src/core/modes.ts';
import { SPELLS } from '../src/core/spells.ts';
import {
  LADDER_GROUP_IDS,
  LOCALE_NAMESPACES,
  MODE_COPY_IDS,
  RESOURCES,
  SPELL_COPY_IDS,
  SUPPORTED_LOCALES,
  translationExists,
  type LocaleNamespace,
} from '../src/i18n/index.ts';

function flatten(value: object, prefix = ''): Map<string, string> {
  const leaves = new Map<string, string>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') leaves.set(path, child);
    else if (child && typeof child === 'object') {
      for (const [nestedPath, nestedValue] of flatten(child, path)) {
        leaves.set(nestedPath, nestedValue);
      }
    }
  }
  return leaves;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/gu)]
    .map((match) => match[1]).sort();
}

function richMarkup(value: string): string[] {
  return [...value.matchAll(/<\/?[a-z][^>]*>/giu)]
    .map((match) => match[0].replace(/\s+/gu, ' '));
}

assert.deepEqual(Object.keys(RESOURCES), [...SUPPORTED_LOCALES],
  'catalog aggregation must follow the locale registry exactly');

for (const namespace of LOCALE_NAMESPACES) {
  const english = flatten(RESOURCES.en[namespace]);
  for (const locale of SUPPORTED_LOCALES) {
    const translated = flatten(RESOURCES[locale][namespace]);
    assert.deepEqual([...translated.keys()].sort(), [...english.keys()].sort(),
      `${locale}:${namespace} must have exact English key parity`);
    for (const [key, source] of english) {
      const value = translated.get(key)!;
      assert.ok(value.trim(), `${locale}:${namespace}.${key} must not be blank`);
      assert.deepEqual(placeholders(value), placeholders(source),
        `${locale}:${namespace}.${key} must preserve interpolation placeholders`);
      assert.deepEqual(richMarkup(value), richMarkup(source),
        `${locale}:${namespace}.${key} must preserve trusted rich-text markup`);
    }
  }
}

assert.deepEqual(MODES.map(({ id }) => id), MODE_COPY_IDS.filter((id) => id !== 'random'));
assert.deepEqual(SPELLS.map(({ id }) => id),
  SPELL_COPY_IDS.filter((id) => id !== 'none' && id !== 'random' && id !== 'random2'));
assert.deepEqual(GROUPS.map(({ id }) => id), LADDER_GROUP_IDS);

/* Portable rule registries expose stable identity and mechanics only. Copy
   belongs to catalogs so adding a locale cannot create a second roster. */
for (const mode of MODES) {
  for (const field of ['name', 'compactName', 'blurb', 'detail']) {
    assert.equal(field in mode, false, `core mode ${mode.id} leaked display field ${field}`);
  }
}
for (const spell of SPELLS) {
  for (const field of ['name', 'compactName', 'blurb', 'detail', 'aim']) {
    assert.equal(field in spell, false, `core spell ${spell.id} leaked display field ${field}`);
  }
}
for (const group of GROUPS) {
  assert.equal('name' in group, false, `core ladder group ${group.id} leaked its display name`);
}

/* Compact labels are the fixed game-view variants. This guard is only an
   early warning; browser layout coverage must still measure rendered pixels. */
for (const locale of SUPPORTED_LOCALES) {
  const game = RESOURCES[locale].game;
  for (const mode of MODE_COPY_IDS) assert.ok(game.modes[mode].compact.length <= 10,
    `${locale} mode compact label grew beyond 10 characters: ${mode}`);
  for (const spell of SPELL_COPY_IDS) assert.ok(game.runes[spell].compact.length <= 10,
    `${locale} rune compact label grew beyond 10 characters: ${spell}`);
  for (const group of LADDER_GROUP_IDS) assert.ok(RESOURCES[locale].online.ladder.groups[group].compact.length <= 10,
    `${locale} ladder compact label grew beyond 10 characters: ${group}`);
}

assert.deepEqual(LOCALE_NAMESPACES, ['common', 'settings', 'game', 'online', 'learn']);

/* Static bindings are string attributes rather than t() calls, so TypeScript
   cannot catch a misspelt namespace/key. Keep every literal hook resolvable;
   the DOM translator deliberately throws on an unknown token at startup. */
const markupDirectory = new URL('../src/markup/', import.meta.url);
const markupSources = [
  readFileSync(new URL('../build.mjs', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/markup.ts', import.meta.url), 'utf8'),
  /* The screens beside markup.ts are read by DIRECTORY, never by a list. They
     were split out of markup.ts one at a time, and a hand-written list drops
     each screen's tokens the day it moves — silently, because the test still
     passes on whatever is left behind. */
  ...readdirSync(markupDirectory).filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(new URL(name, markupDirectory), 'utf8')),
  readFileSync(new URL('../src/online/screens/shell.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/ui/firstrun.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/ui/learn-page.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/ui/loader.ts', import.meta.url), 'utf8'),
];
const staticTokens = new Set<string>();
const richTokens = new Set<string>();
for (const source of markupSources) {
  for (const match of source.matchAll(/data-i18n="([^"$]+)"/gu)) staticTokens.add(match[1]);
  for (const match of source.matchAll(/data-i18n-rich="([^"$]+)"/gu)) {
    staticTokens.add(match[1]);
    richTokens.add(match[1]);
  }
  for (const match of source.matchAll(/data-i18n-attr="([^"$]+)"/gu)) {
    for (const declaration of match[1].split(';')) staticTokens.add(declaration.slice(declaration.indexOf('=') + 1));
  }
}
for (const token of staticTokens) {
  const separator = token.indexOf(':');
  const namespace = token.slice(0, separator) as LocaleNamespace;
  const key = token.slice(separator + 1);
  assert.ok(LOCALE_NAMESPACES.includes(namespace) && translationExists(namespace, key),
    `unknown static translation token: ${token}`);
}
function catalogValue(locale: typeof SUPPORTED_LOCALES[number], token: string): string {
  const separator = token.indexOf(':');
  const namespace = token.slice(0, separator) as LocaleNamespace;
  const key = token.slice(separator + 1);
  let value: unknown = RESOURCES[locale][namespace];
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part];
  assert.equal(typeof value, 'string', `${locale}:${token} must be a string`);
  return value as string;
}
for (const token of richTokens) {
  for (const locale of SUPPORTED_LOCALES) {
    assert.doesNotMatch(catalogValue(locale, token), /\{\{|\$t\(/u,
      `${locale}:${token} rich copy must remain trusted static text`);
  }
}
console.log(JSON.stringify({ problems: [] }));
