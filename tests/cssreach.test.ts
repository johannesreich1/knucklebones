// The offline game may not depend on the ONLINE chunk's stylesheet.
//
// online.css ships inside the lazily-imported online chunk: on the PWA and
// native builds it is not linked from index.html and only arrives once
// something touches src/online/. The single-file build inlines everything, so
// this class of bug is invisible there — which is exactly how it survived: the
// first-run tutorial offer's "Skip, I know the rules" carried `.btn.ghost`,
// defined only in online.css, and rendered as a solid button for every
// newcomer who started an OFFLINE game on a real install.
//
// This is a static check on purpose. The rendered proof needs a newcomer, a
// served PWA build and a guarantee that nothing online was touched first;
// the invariant behind it is simply "offline markup, offline stylesheet", and
// that is decidable by reading the files.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inlineCssGraph } from '../tools/css-graph.mjs';

const problems: string[] = [];
const errs: string[] = [];

const read = (p: string) => readFileSync(p, 'utf8');
const classesIn = (css: string): Set<string> =>
  new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

const cssClasses = (label: string, entries: string[]): Set<string> => {
  try {
    return classesIn(inlineCssGraph(entries, { rootDir: process.cwd(), separator: '' }).css);
  } catch (error) {
    errs.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return new Set();
  }
};
const offlineCss = cssClasses('offline CSS graph', ['src/styles/page.css', 'src/styles/main.css']);
const onlineCss = cssClasses('online CSS graph', ['src/online/online.css']);

/* Every TypeScript module the two offline entry points can STATICALLY reach.
   This is deliberately an import closure rather than a list of directories:
   nested owners such as ui/game/, boot/ and markup/legal.ts were invisible to
   the old one-level scan. Dynamic import() is excluded, so src/online remains
   the lazily loaded boundary this check exists to protect. */
const STATIC_IMPORT = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g;
function withoutComments(source: string): string {
  let out = '';
  let state: 'code' | 'single' | 'double' | 'template' | 'line' | 'block' = 'code';
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; } else out += ' ';
    } else if (state === 'block') {
      if (c === '*' && next === '/') { out += '  '; i++; state = 'code'; }
      else out += c === '\n' ? '\n' : ' ';
    } else if (state === 'code') {
      if (c === '/' && next === '/') { out += '  '; i++; state = 'line'; }
      else if (c === '/' && next === '*') { out += '  '; i++; state = 'block'; }
      else {
        out += c;
        if (c === "'") state = 'single';
        else if (c === '"') state = 'double';
        else if (c === '`') state = 'template';
      }
    } else {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; }
      else if ((state === 'single' && c === "'")
        || (state === 'double' && c === '"')
        || (state === 'template' && c === '`')) state = 'code';
    }
  }
  return out;
}

function resolveTypeScript(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = path.extname(base) ? [base] : [`${base}.ts`, path.join(base, 'index.ts')];
  return candidates.find((candidate) => candidate.endsWith('.ts') && existsSync(candidate)) ?? null;
}

function staticClosure(entries: string[]): string[] {
  const pending = entries.map((entry) => path.resolve(entry));
  const seen = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of withoutComments(read(file)).matchAll(STATIC_IMPORT)) {
      const target = resolveTypeScript(file, match[1]);
      if (target && !seen.has(target)) pending.push(target);
    }
  }
  return [...seen].map((file) => path.relative(process.cwd(), file).split(path.sep).join('/')).sort();
}

const reachable = staticClosure(['src/main.ts', 'src/widget.ts']);
for (const required of ['src/boot/menu-bindings.ts', 'src/markup/legal.ts', 'src/ui/game/board.ts']) {
  if (!reachable.includes(required)) {
    problems.push(`${required} fell out of the offline static-import closure; CSS reach coverage shrank`);
  }
}
if (reachable.some((file) => file.startsWith('src/online/'))) {
  problems.push('the offline static-import closure crossed the lazy src/online boundary');
}

const used = new Map<string, Set<string>>();
for (const file of reachable) {
  /* class="a b c" — and class="a ${cond ? 'b' : ''}" too. This used to skip any
     attribute containing a $, on the reasoning that interpolated classes are
     not literals. Half of it is: the interpolation is not, but the LITERALS
     BESIDE IT ARE, and skipping the whole attribute made them invisible. When
     the sheet moved to ui/, this guard was cited as the proof that its classes
     may live in main.css — and it could see only two of the six, because the
     rest sat in `class="focard${'$'}{tint ? ' hued' : ''}"`. A guard that
     quietly covers less than it is credited with is worse than none.
     So the interpolations are blanked FIRST and the literals around them read
     as normal. Classes set through className/classList are read too, for the
     same reason: sheet.ts writes `ov.className = 'faceoff' + …`. */
  const src = read(file).replace(/\$\{[^}]*\}/g, ' ');
  for (const m of src.matchAll(/(?:className\s*=\s*|classList\.(?:add|toggle|remove)\()['"`]([^'"`]+)['"`]/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (!c) continue;
      (used.get(c) ?? used.set(c, new Set()).get(c)!).add(file);
    }
  }
  for (const m of src.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (!c) continue;
      (used.get(c) ?? used.set(c, new Set()).get(c)!).add(file);
    }
  }
}

for (const [cls, files] of used) {
  if (onlineCss.has(cls) && !offlineCss.has(cls)) {
    problems.push(`.${cls} is styled ONLY by the lazy online.css, but offline markup uses it `
      + `(${[...files].join(', ')}) — move the rule to src/styles/main.css`);
  }
}

console.log(JSON.stringify({
  offlineFilesScanned: reachable.length,
  offlineClassesUsed: used.size,
  problems,
  errs,
}, null, 2));
