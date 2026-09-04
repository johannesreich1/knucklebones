// Architectural debt may shrink, but it may not spread silently.
//
// This is deliberately a ratchet rather than an ideal-state test: every
// existing exception is named in source with a removal reason, beside the rule
// it excepts — TS_NOCHECK_ALLOWLIST and SIZE_ALLOWLIST below,
// ALLOWED_CYCLE_EDGE_GROUPS in support/architecture-import-cycles.ts, CORE_DEBT
// in support/architecture-core-purity.ts. A refactor can delete an exception
// without changing the rule; a new exception requires an explicit, reviewable
// edit there. This file owns the two whole-tree ratchets, the debt report and
// the exit code; each support/architecture-*.ts module owns one claim about
// the tree, over the corpus support/module-corpus.ts reads for all of them.
// Run from the repository root:
//   mise exec -- node --experimental-strip-types tests/architecture.test.ts
import { statSync } from 'node:fs';
import { loadModuleCorpus } from './support/module-corpus.ts';
import { scanDomOwnership } from './support/architecture-dom-ownership.ts';
import { scanBundleGraph } from './support/architecture-bundle-graph.ts';
import { findImportCycles } from './support/architecture-import-cycles.ts';
import { scanCorePurity } from './support/architecture-core-purity.ts';

const corpus = loadModuleCorpus(process.cwd());
const { relative } = corpus;
const problems: string[] = [];

/* -------------------------------------------------------------------------
 * Type-checking debt
 * ---------------------------------------------------------------------- */

const TS_NOCHECK_ALLOWLIST = new Map<string, string>();

const typedSources = [...corpus.sourceFiles, ...corpus.edgeFunctionFiles]
  .filter((file) => /\.(?:ts|tsx)$/.test(file) && !file.endsWith('.d.ts'));
const noCheckFiles = typedSources
  .filter((file) => /^\s*\/\/\s*@ts-nocheck\b/m.test(corpus.read(file)))
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
  /* 2026-09-02 integration of three stopped streams (page motion, progression
     v2, cached Profile). Each entry names the split that removes it. */
  ['src/ui/page-motion.ts',
    'one navigation controller; split the hydration hold and the reconcile loop into owners'],
  ['src/online/screens/account-screen.ts',
    'Profile show() grew the standing wait and rune authority; move applyStanding out'],
  ['src/online/screens/result-screen.ts',
    'progression hold plus cover routing; move the progression hold to its owner'],
  ['tests/browser/legal.mjs',
    'motion sampling joined the matrix; split the sheet-stack cases out'],
  /* 2026-09-05: sat exactly on 400 and the curve-v2 default added a fixture —
     the old-schema fallback is only reachable from a cached v1 now, so the case
     has to establish one. */
  ['tests/play-sync.test.ts',
    'snapshot/replay and terminal-projection cases in one file; move the '
    + 'terminal, rejoin and schema-fallback cases to a support module the way '
    + 'edge-operations does, once their shared routes/online fixture is passed '
    + 'rather than closed over'],
  ['tests/browser/online-ui/harness/routes.mjs',
    'rune, equipment and progression stubs; move the rune stubs beside profile-routes'],
  ['tests/browser/online-ui/scenarios/page-navigation-motion.mjs',
    'one probe per page seam; split by surface (entry, result, account)'],
  ['tests/profile-back-navigation.mjs',
    'one line over after the identity stub; split the ladder walk out on the next touch'],
]);

const EXCLUDED_DIRS = /\/(?:fixtures|generated|snapshots|vendor)\//;
const authored = [
  ...corpus.sourceFiles.map((file) => ({ file, kind: 'runtime' })),
  ...corpus.edgeFunctionFiles.map((file) => ({ file, kind: 'runtime' })),
  ...corpus.testFiles.map((file) => ({ file, kind: 'test' })),
].filter(({ file }) => /\.(?:ts|tsx|js|mjs|css)$/.test(file)
  && !file.endsWith('.d.ts') && !EXCLUDED_DIRS.test(corpus.posix(file)));

const sizeDebt: Array<{ file: string; lines: number; bytes: number; rationale: string }> = [];
for (const { file, kind } of authored) {
  const name = relative(file);
  const maxLines = kind === 'test' ? 400 : 350;
  const maxBytes = (kind === 'test' ? 30 : 25) * 1024;
  const source = corpus.read(file);
  const lines = source === '' ? 0 : source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  // statSync, not the cached text: the budget is the file on disk, in bytes.
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
 * Per-claim scans, each owning its own exception list
 * ---------------------------------------------------------------------- */

const domOwnership = scanDomOwnership(corpus);
const bundleGraph = scanBundleGraph(corpus);
const importCycles = findImportCycles(corpus);
const corePurity = scanCorePurity(corpus);
problems.push(...domOwnership.problems, ...bundleGraph.problems,
  ...importCycles.problems, ...corePurity.problems);

console.log(JSON.stringify({
  scanned: { typedSources: typedSources.length, authoredModules: authored.length,
             graphModules: corpus.graphFiles.length, coreModules: corePurity.coreModules },
  currentDebt: {
    tsNoCheck: noCheckFiles, oversized: sizeDebt,
    importCycles: importCycles.importCycles, cyclicEdges: importCycles.cyclicEdges,
    rootStateEscapes: domOwnership.rootStateEscapes,
    rootQueryEscapes: domOwnership.rootQueryEscapes,
    rootHitTestEscapes: domOwnership.rootHitTestEscapes,
    edgeTransportEscapes: domOwnership.edgeTransportEscapes,
    gameViewEscapes: domOwnership.gameViewEscapes,
    onlineChunkEscapes: bundleGraph.onlineChunkEscapes,
    corePurity: corePurity.findings,
  },
  problems,
  errs: [],
}, null, 2));

process.exitCode = problems.length ? 1 : 0;
