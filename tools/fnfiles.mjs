// WHAT AN EDGE FUNCTION IS MADE OF — computed, never remembered.
//
// PvP operations import `./core/*.ts` and `../config.ts`; those files live in
// src/ and are uploaded VERBATIM beside the function at deploy time. HTTP and
// auth infrastructure lives once in supabase/functions/_shared and is carried
// through the same transitive import walk. Nothing is copied into a function
// directory — the upload IS the copy.
//
// That set used to be written down in supabase/functions/README.md, and prose
// cannot be re-checked: by 2026-08-22 the list still named `elo.ts` (deleted
// months earlier) and omitted `ladder.ts` and `modes.ts`, which all three PvP
// functions import. Deploying from a stale list uploads a function that fails
// on its first request. So the list is derived from the imports instead, by
// the same code the gate runs (tests/fnsync.test.ts).
//
//   node tools/fnfiles.mjs                 # every function, as a table
//   node tools/fnfiles.mjs pvp-join        # one function
//   node tools/fnfiles.mjs pvp-join --json # exactly what deploy_edge_function wants
//
// The --json form is the deploy: its output is the `files` argument, so the
// upload can neither miss a file nor carry a hand-edited one.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export const FN_DIR = 'supabase/functions';

/* every relative specifier in a module — `import`, `export ... from` and
   `import type` alike, single- or multi-line. Bare specifiers (jsr:, npm:,
   https:) are the runtime's problem, not ours: nothing is uploaded for them. */
function relativeImports(src) {
  return [...src.matchAll(/from\s*["'](\.[^"']*)["']/g)].map((m) => m[1]);
}

/* Where a file uploaded as `name` actually lives in the repo. A function may
   carry private modules of its own (gc-auth/verify.ts) as well as the shared
   core; the upload path is identical either way, so the only question is which
   tree holds the source. */
function sourceOf(slug, name) {
  const own = path.join(FN_DIR, slug, name);
  if (existsSync(own)) return own;
  const functionShared = path.join(FN_DIR, name);
  if (existsSync(functionShared)) return functionShared;
  const shared = path.join('src', name);
  if (existsSync(shared)) return shared;
  return null;
}

/* Source uses Supabase's conventional sibling import (`../_shared/http.ts`).
   The MCP upload is rooted at index.ts, so its safe equivalent is
   `_shared/http.ts`. Keep source/editor/CLI paths conventional and normalize
   only the computed upload boundary. */
function uploadedName(name) {
  const parent = `..${path.sep}`;
  const shared = `${parent}_shared${path.sep}`;
  return name.startsWith(shared) ? name.slice(parent.length) : name;
}

/**
 * The complete upload set for one function: index.ts plus the transitive
 * closure of its relative imports, each with the repo file it is read from.
 * `missing` names an import that resolves to no file in either tree — a rename
 * or deletion in src/core that a function still asks for, which is a deploy
 * that would fail at runtime rather than at build time.
 */
export function fnFiles(slug) {
  const files = [], missing = [], seen = new Set();
  const walk = (name, from) => {
    if (seen.has(name)) return;
    seen.add(name);
    const source = sourceOf(slug, name);
    if (!source) { missing.push({ name, from }); return; }
    files.push({ name, source });
    for (const spec of relativeImports(readFileSync(source, 'utf8'))) {
      // resolve against the file's place in the UPLOADED tree, which is what
      // Deno will see — src/core/rules.ts asking for '../config.ts' means
      // config.ts sits beside core/, at the function root
      walk(uploadedName(path.normalize(path.join(path.dirname(name), spec))), name);
    }
  };
  walk('index.ts', null);
  /* Supabase recommends a per-function deno.json for deployed dependency
     isolation. It is runtime input rather than a TypeScript import, so add it
     explicitly to the otherwise import-derived closure. */
  const denoConfig = path.join(FN_DIR, slug, 'deno.json');
  if (existsSync(denoConfig)) files.push({ name: 'deno.json', source: denoConfig });
  else missing.push({ name: 'deno.json', from: null });
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { slug, files, missing };
}

export function allSlugs() {
  return readdirSync(FN_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(FN_DIR, e.name, 'index.ts')))
    .map((e) => e.name).sort();
}

export function deployContent(file) {
  const source = readFileSync(file.source, 'utf8');
  return source.replace(/(["'])\.\.\/_shared\//g, '$1./_shared/');
}

/* what the Supabase MCP's deploy_edge_function takes: [{ name, content }] */
export const uploadPayload = (slug) =>
  fnFiles(slug).files.map((file) => ({ name: file.name, content: deployContent(file) }));

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const slugs = args.filter((a) => !a.startsWith('--'));
  if (json) {
    if (slugs.length !== 1) {
      console.error('--json takes exactly one function slug');
      process.exit(2);
    }
    console.log(JSON.stringify(uploadPayload(slugs[0]), null, 2));
  } else {
    for (const slug of slugs.length ? slugs : allSlugs()) {
      const { files, missing } = fnFiles(slug);
      console.log(`\n${slug}  (${files.length} files)`);
      for (const f of files) console.log(`  ${f.name.padEnd(18)} <- ${f.source}`);
      for (const m of missing) console.log(`  MISSING: ${m.name} (imported by ${m.from})`);
    }
    console.log('');
  }
}
