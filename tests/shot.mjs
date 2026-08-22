// Playwright resolves a screenshot path against the process cwd, which for the
// gate is the repo root — so every suite that wanted a picture dropped a PNG
// beside package.json. The destination is the shared thing here and the name is
// the only real difference, so one helper owns the directory and .gitignore
// needs a single line for it.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'screens');

/** Screenshot a Page (or any Playwright target) into tests/screens/<name>.png. */
export function shot(target, name) {
  mkdirSync(DIR, { recursive: true });
  return target.screenshot({ path: join(DIR, `${name}.png`) });
}
