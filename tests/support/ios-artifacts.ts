import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const filesUnder = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const visit = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const file = path.join(current, name);
      if (statSync(file).isDirectory()) visit(file);
      else found.push(path.relative(dir, file).split(path.sep).join('/'));
    }
  };
  visit(dir);
  return found;
};

export const sameBytes = (a: string, b: string): boolean =>
  existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));

export const tagIn = (file: string): string | null => existsSync(file)
  ? (readFileSync(file, 'utf8').match(/data-build="([^"]+)"/) || [])[1] ?? null
  : null;

/** Reconstruct every shipped pre-stamp byte independently of build.mjs. */
export function recomputeArtifactTag({
  tag,
  nativeDir,
  standalone,
  pwaDir,
  widget,
  harness,
}: {
  tag: string;
  nativeDir: string;
  standalone: string;
  pwaDir: string;
  widget: string;
  harness: string;
}): string {
  const normalize = (file: string, kind: 'html' | 'sw' | 'bytes'): Buffer => {
    const bytes = readFileSync(file);
    if (kind === 'bytes') return bytes;
    let text = bytes.toString('utf8');
    if (kind === 'html') text = text.replace(`data-build="${tag}"`, 'data-build="dev"');
    else text = text.replace(`'kb-${tag}'`, "'kb-dev'");
    return Buffer.from(text);
  };
  const inputs = new Map<string, Buffer>();
  inputs.set('standalone/knucklebones-neon.html', normalize(standalone, 'html'));
  for (const file of filesUnder(nativeDir)) {
    inputs.set(`native/www/${file}`, normalize(`${nativeDir}/${file}`,
      file === 'index.html' ? 'html' : file === 'sw.js' ? 'sw' : 'bytes'));
  }
  for (const file of filesUnder(pwaDir)) {
    inputs.set(`pwa/${file}`, normalize(`${pwaDir}/${file}`,
      file === 'index.html' ? 'html' : file === 'sw.js' ? 'sw' : 'bytes'));
  }
  inputs.set('widget.html', normalize(widget, 'html'));
  inputs.set('harness.html', normalize(harness, 'html'));

  const digest = createHash('sha256');
  for (const [name, bytes] of [...inputs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    digest.update(name).update('\0').update(String(bytes.length)).update('\0').update(bytes).update('\0');
  }
  return digest.digest('hex').slice(0, 8);
}
