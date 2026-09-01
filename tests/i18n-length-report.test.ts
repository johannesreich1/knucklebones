import assert from 'node:assert/strict';
import {
  LOCALE_NAMESPACES,
  RESOURCES,
  SUPPORTED_LOCALES,
} from '../src/i18n/index.ts';
import {
  flattenStrings,
  graphemeCount,
  materiallyLonger,
  visibleCatalogCopy,
  type TranslationLengthWarning,
} from './support/translation-length.ts';

assert.equal(graphemeCount('🇧🇷'), 1, 'the audit must count grapheme clusters, not code points');
assert.equal(visibleCatalogCopy('<b>Hello</b> {{name}}'), 'Hello');
assert.equal(materiallyLonger(10, 14), true);
assert.equal(materiallyLonger(10, 13), false, 'exactly 30% longer is below the review threshold');
assert.equal(materiallyLonger(20, 23), false, 'fewer than four extra graphemes is below the threshold');

const warnings: TranslationLengthWarning[] = [];
const pluralSource = (english: Map<string, string>, key: string): string | undefined => {
  const match = key.match(/^(.*)_(?:zero|one|two|few|many|other)$/u);
  if (!match) return undefined;
  return english.get(`${match[1]}_other`) ?? english.get(`${match[1]}_one`);
};
for (const namespace of LOCALE_NAMESPACES) {
  const english = flattenStrings(RESOURCES.en[namespace]);
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === 'en') continue;
    const translated = flattenStrings(RESOURCES[locale][namespace]);
    for (const [key, value] of translated) {
      const source = english.get(key) ?? pluralSource(english, key);
      assert.ok(source, `${locale}:${namespace}.${key} has no English source family`);
      const englishLength = graphemeCount(source);
      const translatedLength = graphemeCount(value);
      if (!materiallyLonger(englishLength, translatedLength)) continue;
      warnings.push({
        locale,
        key: `${namespace}.${key}`,
        englishLength,
        translatedLength,
        ratio: Number((translatedLength / englishLength).toFixed(2)),
      });
    }
  }
}

/* This is deliberately a review report, not a release gate. Rendered mobile
   geometry is authoritative; natural copy may remain longer when it fits. */
console.log(JSON.stringify({ problems: [], translationLengthWarnings: warnings }));
