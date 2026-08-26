// Architectural debt may shrink, but it may not spread silently.
//
// This is deliberately a ratchet rather than an ideal-state test: the few
// existing exceptions are named below with a removal reason. A refactor can
// delete an exception without changing this file; a new exception requires an
// explicit, reviewable edit here. Run from the repository root:
//   mise exec -- node --experimental-strip-types tests/architecture.test.ts
import {
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const problems: string[] = [];
const posix = (file: string) => file.split(path.sep).join('/');
const relative = (file: string) => posix(path.relative(ROOT, file));

function filesBelow(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesBelow(file) : entry.isFile() ? [file] : [];
  }).sort();
}

const sourceFiles = filesBelow(path.join(ROOT, 'src'));
const edgeFunctionFiles = filesBelow(path.join(ROOT, 'supabase/functions'));
const testFiles = filesBelow(path.join(ROOT, 'tests'));

/* -------------------------------------------------------------------------
 * Type-checking debt
 * ---------------------------------------------------------------------- */

const TS_NOCHECK_ALLOWLIST = new Map<string, string>();

const typedSources = [...sourceFiles, ...edgeFunctionFiles]
  .filter((file) => /\.(?:ts|tsx)$/.test(file) && !file.endsWith('.d.ts'));
const noCheckFiles = typedSources
  .filter((file) => /^\s*\/\/\s*@ts-nocheck\b/m.test(readFileSync(file, 'utf8')))
  .map(relative);

for (const file of noCheckFiles) {
  if (!TS_NOCHECK_ALLOWLIST.has(file)) {
    problems.push(`${file} adds @ts-nocheck. Type the boundary instead; if this is truly `
      + `temporary, add the exact file and a removal rationale to TS_NOCHECK_ALLOWLIST.`);
  }
}

/* -------------------------------------------------------------------------
 * Authored module size budgets
 * ---------------------------------------------------------------------- */

const SIZE_ALLOWLIST = new Map<string, string>([
]);

const EXCLUDED_DIRS = /\/(?:fixtures|generated|snapshots|vendor)\//;
const authored = [
  ...sourceFiles.map((file) => ({ file, kind: 'runtime' })),
  ...edgeFunctionFiles.map((file) => ({ file, kind: 'runtime' })),
  ...testFiles.map((file) => ({ file, kind: 'test' })),
].filter(({ file }) => /\.(?:ts|tsx|js|mjs|css)$/.test(file)
  && !file.endsWith('.d.ts') && !EXCLUDED_DIRS.test(posix(file)));

const sizeDebt: Array<{ file: string; lines: number; bytes: number; rationale: string }> = [];
for (const { file, kind } of authored) {
  const name = relative(file);
  const css = file.endsWith('.css');
  const maxLines = kind === 'test' ? 400 : 350;
  const maxBytes = (kind === 'test' ? 30 : 25) * 1024;
  const source = readFileSync(file, 'utf8');
  const lines = source === '' ? 0 : source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  const bytes = statSync(file).size;
  if (lines <= maxLines && bytes <= maxBytes) continue;

  const rationale = SIZE_ALLOWLIST.get(name);
  if (rationale) {
    sizeDebt.push({ file: name, lines, bytes, rationale });
    continue;
  }
  problems.push(`${name} is ${lines} lines / ${bytes} bytes (budget: ${maxLines} lines `
    + `/ ${maxBytes} bytes). Split it by ownership, or document a temporary exception `
    + `with a removal rationale in SIZE_ALLOWLIST.`);
}

/* -------------------------------------------------------------------------
 * Source import cycles
 * ---------------------------------------------------------------------- */

// These are the current cyclic EDGES, not just their participants. Removing
// any edge can only improve the graph; a new edge inside an old component is
// still new debt and fails. Grouping only supplies the shared rationale.
const ALLOWED_CYCLE_EDGE_GROUPS: Array<{ edges: Array<[string, string]>; rationale: string }> = [];
const ALLOWED_CYCLIC_EDGES = new Set(ALLOWED_CYCLE_EDGE_GROUPS.flatMap((group) =>
  group.edges.map(([from, to]) => `${from} -> ${to}`)));

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

/* The game shell's JS→CSS class contract has one typed owner. State lives on
   #kbroot (not the host documentElement), and a direct read is also an escape:
   consumers ask semantic queries so `p2turn => face` cannot be bypassed. */
const ROOT_STATE_OWNER = 'src/ui/game/root-state.ts';
const ROOT_STATE_CLASS = /['"](?:rowmode|rowswitch|face|p2turn|opponent-turn|land|shortv|sidepts|casting|castself|numerals|clock|tut)['"]/;
const rootStateEscapes: string[] = [];
const rootQueryEscapes: string[] = [];
const rootHitTestEscapes: string[] = [];
for (const file of sourceFiles.filter((candidate) => /\.tsx?$/.test(candidate))) {
  const name = relative(file);
  if (name === ROOT_STATE_OWNER) continue;
  const clean = withoutComments(readFileSync(file, 'utf8'));
  const hostRoot = /\bdocument\s*\.\s*documentElement\s*\.\s*classList\b/.test(clean);
  const directAppRoot = /\b(?:appRoot|kbroot)\s*\(\s*\)\s*(?:\?\.|\.)\s*classList\b/.test(clean)
    || /\b(?:getElementById\s*\(\s*['"]kbroot['"]\s*\)|querySelector\s*\(\s*['"]#kbroot['"]\s*\))\s*(?:\?\.|\.)\s*classList\b/.test(clean);
  const namedStateWrite = [...clean.matchAll(/\.classList\s*\.\s*(?:add|remove|toggle|contains)\s*\(([^)]*)\)/g)]
    .some((match) => ROOT_STATE_CLASS.test(match[1]));
  if (hostRoot || directAppRoot || namedStateWrite) {
    rootStateEscapes.push(name);
    problems.push(`${name} reads or writes the application-root state classes directly. Add a narrow `
      + `semantic operation to ${ROOT_STATE_OWNER} instead of growing a second JS→CSS contract.`);
  }
  if (/\bdocument\s*\.\s*querySelector(?:All)?\s*\(/.test(clean)
      || (name !== 'src/ui/embed.ts' && /\bdocument\s*\.\s*getElementById\s*\(/.test(clean))) {
    rootQueryEscapes.push(name);
    problems.push(`${name} queries the host document for application elements. Scope the lookup beneath `
      + `appRoot() (the $/byId helpers in src/ui) so a widget cannot touch matching host markup.`);
  }
  if (name !== 'src/ui/query.ts' && /\bdocument\s*\.\s*elementFromPoint\s*\(/.test(clean)) {
    rootHitTestEscapes.push(name);
    problems.push(`${name} hit-tests the host document directly. Route coordinates through `
      + `rootElementFromPoint() so matching host markup cannot become an application target.`);
  }
}

const STATIC_IMPORT = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
function importSpecifiers(source: string): string[] {
  const clean = withoutComments(source);
  const specs = new Set<string>();
  for (const re of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of clean.matchAll(re)) specs.add(match[1]);
  }
  return [...specs];
}

const graphFiles = sourceFiles.filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file));
const graphSet = new Set(graphFiles.map((file) => path.resolve(file)));
const graph = new Map<string, string[]>(graphFiles.map((file) => [path.resolve(file), []]));

function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const raw = path.resolve(path.dirname(from), specifier.split(/[?#]/)[0]);
  const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, `${raw}.mjs`,
    path.join(raw, 'index.ts'), path.join(raw, 'index.tsx'), path.join(raw, 'index.js')];
  if (raw.endsWith('.js')) candidates.push(`${raw.slice(0, -3)}.ts`);
  return candidates.map((file) => path.resolve(file)).find((file) => graphSet.has(file)) ?? null;
}

for (const file of graphFiles) {
  const from = path.resolve(file);
  const edges = importSpecifiers(readFileSync(file, 'utf8'))
    .map((specifier) => resolveLocal(from, specifier)).filter(Boolean) as string[];
  graph.set(from, [...new Set(edges)].sort());
}

/* -------------------------------------------------------------------------
 * Shared game-view ownership
 * ---------------------------------------------------------------------- */

const MOVE_VIEW_OWNER = 'src/ui/game/move-view.ts';
const MOTION_OWNER = 'src/ui/game/motion.ts';
const GAME_DRIVERS = ['src/flow/game.ts', 'src/online/play.ts'];
const reachableFrom = (entry: string): Set<string> => {
  const reached = new Set<string>();
  const pending = [...(graph.get(path.resolve(ROOT, entry)) ?? [])];
  while (pending.length) {
    const dependency = pending.pop()!;
    if (reached.has(dependency)) continue;
    reached.add(dependency);
    pending.push(...(graph.get(dependency) ?? []));
  }
  return new Set([...reached].map(relative));
};
for (const driver of GAME_DRIVERS) {
  const dependencies = reachableFrom(driver);
  const driverSource = withoutComments(readFileSync(path.join(ROOT, driver), 'utf8'));
  for (const owner of [MOVE_VIEW_OWNER, MOTION_OWNER]) {
    if (!dependencies.has(owner)) {
      problems.push(`${driver} no longer drives the shared ${owner}. Keep local and ranked `
        + `view/motion differences in its typed spec instead of restoring a private pipeline.`);
    }
  }
  if (/S\s*\.\s*boards\s*\[\s*who\s*\]\s*\[\s*col\s*\]\s*\.\s*push\s*\(\s*die\s*\)/.test(driverSource)) {
    problems.push(`${driver} commits a visible move privately. Placement, score feedback and `
      + `strikes belong to ${MOVE_VIEW_OWNER}; express differences in GameViewSpec.`);
  }
}

/* Online is a lazy driver, never a composition root for local play. Tutorial
   handoff and similar cross-flow actions arrive as typed ports from boot; an
   online import of flow/game would couple the chunks and restore two owners. */
for (const file of graphFiles.map(relative).filter((name) => name.startsWith('src/online/'))) {
  if (reachableFrom(file).has('src/flow/game.ts')) {
    problems.push(`${file} imports the concrete local-game flow. Inject cross-flow actions from `
      + `src/boot.ts or its binding modules instead.`);
  }
}

/* src/online is a LAZY chunk: one static import from the eagerly bundled layers
   (core/flow/ui/i18n/legal and the root modules) would merge the Supabase client
   into every local/widget load. Only boot's dynamic import() entries are legal. */
const EAGER_BUNDLE = /^src\/(?:core|flow|ui|i18n|legal)\/|^src\/[^/]+\.tsx?$/;
const onlineChunkEscapes: string[] = [];
for (const file of graphFiles.filter((candidate) => EAGER_BUNDLE.test(relative(candidate)))) {
  const staticOnline = [...new Set([...withoutComments(readFileSync(file, 'utf8')).matchAll(STATIC_IMPORT)]
    .map((match) => resolveLocal(path.resolve(file), match[1]))
    .filter((target): target is string => !!target && relative(target).startsWith('src/online/'))
    .map(relative))];
  if (!staticOnline.length) continue;
  onlineChunkEscapes.push(relative(file));
  problems.push(`${relative(file)} statically imports ${staticOnline.join(', ')}; reach the lazy `
    + `online chunk only through boot's dynamic import() entries or an injected typed port.`);
}

const gameViewEscapes: string[] = [];
for (const file of sourceFiles.filter((candidate) => /\.tsx?$/.test(candidate))) {
  const name = relative(file);
  const clean = withoutComments(readFileSync(file, 'utf8'));
  const privateRoll = /\.classList\s*\.\s*(?:add|toggle)\s*\(\s*['"]rolling['"]/.test(clean);
  const privateDeath = /\.classList\s*\.\s*add\s*\(\s*['"]dying['"]/.test(clean);
  if ((privateRoll && name !== MOTION_OWNER) || (privateDeath && name !== MOVE_VIEW_OWNER)) {
    gameViewEscapes.push(name);
    problems.push(`${name} implements private game-die motion. Extend ${MOTION_OWNER} or `
      + `${MOVE_VIEW_OWNER} through a typed option instead of duplicating the visual pipeline.`);
  }
}

// Tarjan's algorithm reports strongly connected components, which is more
// useful than printing dozens of equivalent paths through the same cycle.
let nextIndex = 0;
const indices = new Map<string, number>();
const lowLinks = new Map<string, number>();
const stack: string[] = [];
const onStack = new Set<string>();
const cyclicComponents: string[][] = [];

function connect(file: string) {
  indices.set(file, nextIndex);
  lowLinks.set(file, nextIndex++);
  stack.push(file);
  onStack.add(file);
  for (const dependency of graph.get(file) ?? []) {
    if (!indices.has(dependency)) {
      connect(dependency);
      lowLinks.set(file, Math.min(lowLinks.get(file)!, lowLinks.get(dependency)!));
    } else if (onStack.has(dependency)) {
      lowLinks.set(file, Math.min(lowLinks.get(file)!, indices.get(dependency)!));
    }
  }
  if (lowLinks.get(file) !== indices.get(file)) return;
  const component: string[] = [];
  let member: string;
  do {
    member = stack.pop()!;
    onStack.delete(member);
    component.push(relative(member));
  } while (member !== file);
  const selfCycle = component.length === 1 && (graph.get(file) ?? []).includes(file);
  if (component.length > 1 || selfCycle) cyclicComponents.push(component.sort());
}

for (const file of [...graph.keys()].sort()) if (!indices.has(file)) connect(file);
cyclicComponents.sort((a, b) => a.join('|').localeCompare(b.join('|')));

const cyclicEdges: string[] = [];
for (const component of cyclicComponents) {
  const members = new Set(component);
  const componentEdges = component.flatMap((from) => (graph.get(path.resolve(ROOT, from)) ?? [])
    .map(relative).filter((to) => members.has(to)).map((to) => `${from} -> ${to}`)).sort();
  cyclicEdges.push(...componentEdges);
  const newEdges = componentEdges.filter((edge) => !ALLOWED_CYCLIC_EDGES.has(edge));
  if (newEdges.length) {
    problems.push(`new source import cycle among ${component.join(', ')}; new cyclic edge(s): `
      + `${newEdges.join(', ')}. Break it with a lower-level module or an injected typed port; `
      + `do not expand the baseline.`);
  }
}

/* -------------------------------------------------------------------------
 * core/ purity: common DOM, scheduling and randomness APIs
 * ---------------------------------------------------------------------- */

const CORE_DEBT = new Map<string, Record<string, number>>();

function maskStringsAndComments(source: string): string {
  return withoutComments(source).replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/gs,
    (text) => text.replace(/[^\n]/g, ' '));
}

const coreFindings: Array<{ file: string; kind: string; line: number; token: string }> = [];
const corePatterns = [
  { kind: 'dom', re: /\b(?:document|window|navigator|localStorage|sessionStorage|HTMLElement|Document|Window|Element|Node)\b/g },
  { kind: 'timer', re: /\b(?:setTimeout|clearTimeout|setInterval|clearInterval|requestAnimationFrame|cancelAnimationFrame|queueMicrotask)\b/g },
  { kind: 'randomness', re: /\b(?:Math\s*\.\s*random|crypto\s*\.\s*getRandomValues)\b/g },
];

for (const file of sourceFiles.filter((candidate) => relative(candidate).startsWith('src/core/')
  && /\.(?:ts|tsx)$/.test(candidate))) {
  const source = readFileSync(file, 'utf8');
  const clean = maskStringsAndComments(source);
  for (const { kind, re } of corePatterns) {
    for (const match of clean.matchAll(re)) {
      coreFindings.push({
        file: relative(file), kind,
        line: source.slice(0, match.index).split('\n').length,
        token: match[0].replace(/\s+/g, ''),
      });
    }
  }
  for (const specifier of importSpecifiers(source)) {
    if (/^(?:node:)?(?:timers(?:\/promises)?|crypto)$/.test(specifier)) {
      coreFindings.push({ file: relative(file), kind: 'forbidden-import', line: 1, token: specifier });
    }
    const resolved = resolveLocal(path.resolve(file), specifier);
    if (resolved) {
      const target = relative(resolved);
      if (!target.startsWith('src/core/') && target !== 'src/config.ts') {
        coreFindings.push({ file: relative(file), kind: 'forbidden-import', line: 1, token: target });
      }
    }
  }
}

const seenCoreDebt = new Map<string, number>();
for (const finding of coreFindings) {
  const key = `${finding.file}:${finding.kind}`;
  const occurrence = (seenCoreDebt.get(key) ?? 0) + 1;
  seenCoreDebt.set(key, occurrence);
  const allowed = CORE_DEBT.get(finding.file)?.[finding.kind] ?? 0;
  if (occurrence <= allowed) continue;
  const remedy = finding.kind === 'dom' ? 'move DOM work to ui/'
    : finding.kind === 'timer' ? 'have the caller schedule the pure transition'
      : 'inject the value/source explicitly';
  problems.push(`${finding.file}:${finding.line} uses ${finding.kind} API ${finding.token} `
    + `inside core/; ${remedy}. Existing debt is counted explicitly in CORE_DEBT.`);
}

console.log(JSON.stringify({
  scanned: {
    typedSources: typedSources.length,
    authoredModules: authored.length,
    graphModules: graphFiles.length,
    coreModules: sourceFiles.filter((file) => relative(file).startsWith('src/core/')).length,
  },
  currentDebt: {
    tsNoCheck: noCheckFiles,
    oversized: sizeDebt,
    importCycles: cyclicComponents,
    cyclicEdges,
    rootStateEscapes,
    rootQueryEscapes,
    rootHitTestEscapes,
    gameViewEscapes,
    onlineChunkEscapes,
    corePurity: coreFindings,
  },
  problems,
  errs: [],
}, null, 2));

process.exitCode = problems.length ? 1 : 0;
