export interface TranslationLengthWarning {
  readonly locale: string;
  readonly key: string;
  readonly englishLength: number;
  readonly translatedLength: number;
  readonly ratio: number;
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Compare only player-visible copy: catalog markup and interpolation tokens do not occupy copy space. */
export function visibleCatalogCopy(value: string): string {
  return value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\{\{[^}]+\}\}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function graphemeCount(value: string): number {
  return [...segmenter.segment(visibleCatalogCopy(value))].length;
}

export function materiallyLonger(
  englishLength: number,
  translatedLength: number,
): boolean {
  return translatedLength - englishLength >= 4
    && translatedLength > englishLength * 1.30;
}

export function flattenStrings(value: object, prefix = ''): Map<string, string> {
  const leaves = new Map<string, string>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') leaves.set(path, child);
    else if (child && typeof child === 'object') {
      for (const [nestedPath, nestedValue] of flattenStrings(child, path)) {
        leaves.set(nestedPath, nestedValue);
      }
    }
  }
  return leaves;
}
