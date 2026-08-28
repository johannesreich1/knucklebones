// The corpus every architecture rule reads, gathered once.
//
// Mechanism, never policy: which files are authored under src/,
// supabase/functions/ and tests/; their text with comments removed; the
// specifiers they import; where those specifiers resolve inside src/; and what
// each entry point transitively reaches. The rules that judge this corpus are
// the architecture-*.ts modules beside it, so a new rule adds a module instead
// of a second private walk of the tree.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/* Consume these only through matchAll, which clones the pattern. Both carry
   /g, so a .test()/.exec() here would leave a lastIndex behind that silently
   changes the next file's result. */
const STATIC_IMPORT = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Removing comments is enough for imports: specifiers remain quoted, while an
// `import` example in prose cannot become a graph edge.
function withoutComments(source: string): string {
  let out = '';
  let state: 'code' | 'single' | 'double' | 'template' | 'line' | 'block' = 'code';
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; } else out += ' ';
    } else if (state === 'block') {
      if (c === '*' && n === '/') { out += '  '; i++; state = 'code'; }
      else out += c === '\n' ? '\n' : ' ';
    } else if (state === 'code') {
      if (c === '/' && n === '/') { out += '  '; i++; state = 'line'; }
      else if (c === '/' && n === '*') { out += '  '; i++; state = 'block'; }
      else {
        out += c;
        if (c === "'") state = 'single';
        else if (c === '"') state = 'double';
        else if (c === '`') state = 'template';
      }
    } else {
      out += c;
      if (c === '\\') { out += n ?? ''; i++; }
      else if ((state === 'single' && c === "'")
        || (state === 'double' && c === '"')
        || (state === 'template' && c === '`')) state = 'code';
    }
  }
  return out;
}

function filesBelow(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesBelow(file) : entry.isFile() ? [file] : [];
  }).sort();
}

export interface ModuleCorpus {
  /** Authored files, absolute and sorted, per source tree. */
  sourceFiles: string[];
  edgeFunctionFiles: string[];
  testFiles: string[];
  /** The src/ modules that form the import graph, and that graph keyed absolutely. */
  graphFiles: string[];
  graph: Map<string, string[]>;
  /** Path shaping. Every accessor below takes an absolute or root-relative path. */
  relative(file: string): string;
  resolve(file: string): string;
  posix(file: string): string;
  /** File text, read once. `stripped` is `read` with comments blanked in place. */
  read(file: string): string;
  stripped(file: string): string;
  /** Import specifiers a file writes, deduplicated, in source order. */
  staticSpecifiers(file: string): string[];
  importSpecifiers(file: string): string[];
  /** The src/ module a specifier names, or null when it leaves the graph. */
  resolveLocal(from: string, specifier: string): string | null;
  /** Everything an entry point transitively imports, as relative names. */
  reachableFrom(entry: string): Set<string>;
}

export function loadModuleCorpus(root: string): ModuleCorpus {
  const posix = (file: string): string => file.split(path.sep).join('/');
  const relative = (file: string): string => posix(path.relative(root, file));
  const resolve = (file: string): string => path.resolve(root, file);

  const sourceFiles = filesBelow(path.join(root, 'src'));
  const edgeFunctionFiles = filesBelow(path.join(root, 'supabase/functions'));
  const testFiles = filesBelow(path.join(root, 'tests'));

  /* Raw and stripped text come from ONE read and stay byte-aligned: core
     purity takes a match index in the stripped text and slices the raw source
     to number the line, which holds only while the two share length and
     newlines. Never normalise or trim either. */
  const rawText = new Map<string, string>();
  const strippedText = new Map<string, string>();
  const read = (file: string): string => {
    const key = resolve(file);
    const cached = rawText.get(key);
    if (cached !== undefined) return cached;
    const text = readFileSync(key, 'utf8');
    rawText.set(key, text);
    return text;
  };
  const stripped = (file: string): string => {
    const key = resolve(file);
    const cached = strippedText.get(key);
    if (cached !== undefined) return cached;
    const text = withoutComments(read(key));
    strippedText.set(key, text);
    return text;
  };

  const specifiers = (file: string, patterns: RegExp[]): string[] => {
    const clean = stripped(file);
    const specs = new Set<string>();
    for (const re of patterns) {
      for (const match of clean.matchAll(re)) specs.add(match[1]);
    }
    return [...specs];
  };
  const staticSpecifiers = (file: string): string[] => specifiers(file, [STATIC_IMPORT]);
  const importSpecifiers = (file: string): string[] =>
    specifiers(file, [STATIC_IMPORT, DYNAMIC_IMPORT]);

  const graphFiles = sourceFiles.filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file));
  const graphSet = new Set(graphFiles.map(resolve));
  const graph = new Map<string, string[]>(graphFiles.map((file) => [resolve(file), []]));

  /* Deliberately src/ ONLY: a specifier that leaves the graph resolves to null
     and is silently allowed here, which is exactly what core purity's
     forbidden-import rule relies on to ignore supabase/functions. Adding a
     tree would change both that rule's findings and the cycle graph. */
  const resolveLocal = (from: string, specifier: string): string | null => {
    if (!specifier.startsWith('.')) return null;
    const raw = path.resolve(path.dirname(resolve(from)), specifier.split(/[?#]/)[0]);
    const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, `${raw}.mjs`,
      path.join(raw, 'index.ts'), path.join(raw, 'index.tsx'), path.join(raw, 'index.js')];
    if (raw.endsWith('.js')) candidates.push(`${raw.slice(0, -3)}.ts`);
    return candidates.map((file) => path.resolve(file)).find((file) => graphSet.has(file)) ?? null;
  };

  for (const file of graphFiles) {
    const from = resolve(file);
    const edges = importSpecifiers(from)
      .map((specifier) => resolveLocal(from, specifier)).filter(Boolean) as string[];
    graph.set(from, [...new Set(edges)].sort());
  }

  const reachableFrom = (entry: string): Set<string> => {
    const reached = new Set<string>();
    const pending = [...(graph.get(resolve(entry)) ?? [])];
    while (pending.length) {
      const dependency = pending.pop()!;
      if (reached.has(dependency)) continue;
      reached.add(dependency);
      pending.push(...(graph.get(dependency) ?? []));
    }
    return new Set([...reached].map(relative));
  };

  return {
    sourceFiles, edgeFunctionFiles, testFiles, graphFiles, graph,
    relative, resolve, posix, read, stripped,
    staticSpecifiers, importSpecifiers, resolveLocal, reachableFrom,
  };
}
