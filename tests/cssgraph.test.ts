// The non-browser CSS consumers must see exactly the same ordered dependency
// graph as Vite. Exercise the resolver independently so a malformed manifest
// fails with a useful gate error rather than silently dropping styles.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inlineCssGraph } from '../tools/css-graph.mjs';

const problems: string[] = [];
const errs: string[] = [];
const fixture = mkdtempSync(join(tmpdir(), 'kb-cssgraph-'));
const write = (name: string, css: string) => writeFileSync(join(fixture, name), css);
const expectError = (name: string, pattern: RegExp, run: () => unknown) => {
  try {
    run();
    problems.push(`${name}: expected an error`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) problems.push(`${name}: wrong error: ${message}`);
  }
};

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* Commas inside :is(), steps() and cubic-bezier() are not separators. */
function commaList(value: string): string[] {
  const parts: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function animationInventory(css: string): { defined: Set<string>; used: Set<string> } {
  const clean = withoutComments(css);
  const defined = new Set([...clean.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/gi)]
    .map((match) => match[1]));
  const used = new Set<string>();
  const customNames = new Map<string, Set<string>>();
  for (const match of clean.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:\s*([a-z_][\w-]*)\s*(?=[;}])/gim)) {
    const values = customNames.get(match[1]) ?? new Set<string>();
    values.add(match[2]);
    customNames.set(match[1], values);
  }
  const keywords = new Set([
    'none', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse',
    'forwards', 'backwards', 'both', 'running', 'paused', 'linear', 'ease',
    'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'initial',
    'inherit', 'unset', 'revert', 'revert-layer',
  ]);
  for (const match of clean.matchAll(/(?:^|[;{])\s*animation(?:-name)?\s*:\s*([^;}]+)/gim)) {
    for (const item of commaList(match[1])) {
      for (const variable of item.matchAll(/var\(\s*(--[\w-]+)/gi)) {
        for (const name of customNames.get(variable[1]) ?? []) {
          if (!keywords.has(name.toLowerCase())) used.add(name);
        }
      }
      // All functions in the app's animation shorthands are timing functions
      // or var() indirection; a literal name remains as a bare identifier.
      let flat = item;
      let prior = '';
      while (flat !== prior) {
        prior = flat;
        flat = flat.replace(/[\w-]+\([^()]*\)/g, ' ');
      }
      const name = flat.split(/\s+/).find((token) => /^[a-z_][\w-]*$/i.test(token)
        && !keywords.has(token.toLowerCase()));
      if (name) used.add(name);
    }
  }
  return { defined, used };
}

/* A small CSS-rule scanner is less error-prone here than a selector regex:
   it ignores declaration blocks and the percentage blocks in keyframes while
   still seeing rules nested in @media. */
function ruleSelectors(css: string): string[] {
  const clean = withoutComments(css);
  const selectors: string[] = [];
  const stack: Array<{ keyframes: boolean }> = [];
  let token = '', quote = '', parens = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quote) {
      token += ch;
      if (ch === '\\') token += clean[++i] ?? '';
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; token += ch; continue; }
    if (ch === '(' || ch === '[') { parens++; token += ch; continue; }
    if (ch === ')' || ch === ']') { parens--; token += ch; continue; }
    if (parens === 0 && ch === '{') {
      const prelude = token.trim();
      token = '';
      const keyframes = !!stack.at(-1)?.keyframes
        || /^@(?:-webkit-)?keyframes\b/i.test(prelude);
      stack.push({ keyframes });
      if (!keyframes && prelude && !prelude.startsWith('@')) selectors.push(prelude);
    } else if (parens === 0 && ch === '}') {
      stack.pop();
      token = '';
    } else if (parens === 0 && ch === ';') {
      token = '';
    } else token += ch;
  }
  return selectors.flatMap(commaList);
}

try {
  write('plain-a.css', '.a{}\n');
  write('plain-b.css', '.b{}\n');
  const plain = inlineCssGraph(['plain-a.css', 'plain-b.css'], { rootDir: fixture });
  if (plain.css !== '.a{}\n\n.b{}\n') problems.push('import-free entries are not byte-preserving');
  if (plain.files.length !== 2) problems.push('import-free closure contains unexpected files');

  write('leaf.css', '.leaf{}');
  write('middle.css', '@import url("./leaf.css");\n.middle{}');
  write('entry.css', '/* @import "./ignored.css"; */\n@import "./middle.css";\n.entry{}');
  const nested = inlineCssGraph(['entry.css'], { rootDir: fixture });
  const order = ['.leaf{}', '.middle{}', '.entry{}'].map((text) => nested.css.indexOf(text));
  if (order.some((at) => at < 0) || !(order[0] < order[1] && order[1] < order[2])) {
    problems.push('recursive imports were not inlined in cascade order');
  }
  if (nested.files.length !== 3) problems.push('recursive closure did not report all three files');

  write('duplicate.css', '@import "./leaf.css";\n@import "./leaf.css";');
  expectError('duplicate', /duplicate CSS inclusion/, () =>
    inlineCssGraph(['duplicate.css'], { rootDir: fixture }));

  write('cycle-a.css', '@import "./cycle-b.css";');
  write('cycle-b.css', '@import "./cycle-a.css";');
  expectError('cycle', /CSS import cycle/, () =>
    inlineCssGraph(['cycle-a.css'], { rootDir: fixture }));

  write('remote.css', '@import "https://example.com/theme.css";');
  expectError('remote', /remote @import is forbidden/, () =>
    inlineCssGraph(['remote.css'], { rootDir: fixture }));

  write('qualified.css', '@import "./leaf.css" screen;');
  expectError('qualified', /qualified @imports are unsupported/, () =>
    inlineCssGraph(['qualified.css'], { rootDir: fixture }));

  /* The authored manifests are part of this gate too. Eager CSS may only use
     eager keyframes; lazy CSS may reuse eager definitions because it is loaded
     after main.css. This is the check that catches a named animation such as
     breathe/dots being referenced but never defined. */
  const eager = inlineCssGraph(['src/styles/main.css']).css;
  const lazy = inlineCssGraph(['src/online/online.css']).css;
  const eagerAnimations = animationInventory(eager);
  const lazyAnimations = animationInventory(lazy);
  const missingEager = [...eagerAnimations.used]
    .filter((name) => !eagerAnimations.defined.has(name));
  const availableLazy = new Set([...eagerAnimations.defined, ...lazyAnimations.defined]);
  const missingLazy = [...lazyAnimations.used].filter((name) => !availableLazy.has(name));
  if (missingEager.length || missingLazy.length) {
    problems.push(`animations without keyframes: eager=[${missingEager}] lazy=[${missingLazy}]`);
  }

  /* Lazy screen CSS must not be able to repaint eager Home by coincidence.
     The only class roots are deliberate cross-overlay components: faceoff is
     the shared body-level sheet, online-queue is also worn by design card 21,
     and pointschip remains for the active result study 36d. History uses an exact
     two-screen :is() root because one row implementation serves both lists. */
  const onlineIds = /^(?:#ovOnline|#onAuth|#onQueue|#onBoard|#onAccount|#onAvatar|#onHistory)(?:\b|[.#:[>+~ ])/;
  const classRoots = /^(?:\.faceoff|\.online-queue|\.pointschip)(?:\b|[.#:[>+~ ])/;
  const historyRoot = /^:is\(#onAccount,#onHistory\)\s+\.history-row(?:\b|[.#:[>+~ ])/;
  const unrooted = ruleSelectors(lazy)
    .filter((selector) => !onlineIds.test(selector)
      && !classRoots.test(selector) && !historyRoot.test(selector));
  if (unrooted.length) problems.push(`unrooted lazy-online selectors: ${unrooted.join(' | ')}`);
} catch (error) {
  errs.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log(JSON.stringify({ problems, errs }, null, 2));
