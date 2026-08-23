import { readdirSync } from 'node:fs';
import path from 'node:path';

export const DESIGN_CLASSIFICATIONS = Object.freeze([
  'product',
  'studies/open',
  'studies/archive',
]);

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const posix = (file) => file.split(path.sep).join('/');

function htmlBelow(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => compare(a.name, b.name))
    .flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return htmlBelow(file);
      return entry.isFile() && entry.name.endsWith('.html') ? [file] : [];
    });
}

/**
 * Discover every classified design-card source. Output remains flat, so a
 * basename is the card's durable identity and must be unique across folders.
 */
export function discoverDesignScreens(screenRoot) {
  const files = htmlBelow(screenRoot);
  if (!files.length) throw new Error(`no design cards under ${screenRoot}`);

  const seen = new Map();
  const screens = files.map((file) => {
    const relativePath = posix(path.relative(screenRoot, file));
    const classification = DESIGN_CLASSIFICATIONS.find((name) =>
      relativePath.startsWith(`${name}/`));
    if (!classification) {
      throw new Error(`${relativePath}: unclassified design card; place it under `
        + DESIGN_CLASSIFICATIONS.map((name) => `design/screens/${name}/`).join(', '));
    }

    const basename = path.basename(file);
    const previous = seen.get(basename);
    if (previous) {
      throw new Error(`${basename}: duplicate design-card basename in ${previous} and ${relativePath}; `
        + 'built output is flat, so basenames must be globally unique');
    }
    seen.set(basename, relativePath);
    return { file, basename, relativePath, classification };
  });

  return screens.sort((a, b) => compare(a.basename, b.basename));
}
