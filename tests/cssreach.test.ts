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
import { readFileSync, readdirSync } from 'node:fs';

const problems: string[] = [];
const errs: string[] = [];

const read = (p: string) => readFileSync(p, 'utf8');
const classesIn = (css: string): Set<string> =>
  new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

const offlineCss = classesIn(read('src/styles/main.css') + read('src/styles/page.css'));
const onlineCss = classesIn(read('src/online/online.css'));

/* every module the offline game can reach: the static markup plus ui/ and
   flow/, never online/ — those are the files that may only name offline CSS */
const reachable = ['src/markup.ts'];
for (const dir of ['src/ui', 'src/flow']) {
  for (const f of readdirSync(dir)) if (f.endsWith('.ts')) reachable.push(`${dir}/${f}`);
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
