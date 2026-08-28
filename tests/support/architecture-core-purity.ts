// core/ purity: common DOM, scheduling and randomness APIs.
//
// src/core/ has to replay identically in a browser, in Node and in Deno, so it
// may not touch the DOM, schedule its own work, read ambient randomness, or
// import anything outside core/ (src/config.ts aside). Existing uses are
// counted, not merely listed: CORE_DEBT below allows exactly N occurrences per
// file and kind, so the N+1th is new debt and fails.
import type { ModuleCorpus } from './module-corpus.ts';

const CORE_DEBT = new Map<string, Record<string, number>>();

/* The corpus has already blanked comments; blanking string LITERALS too stops
   the word `document` inside a message from counting as a DOM use. Both passes
   substitute in place, preserving length and newlines — which is the only
   reason a match index taken here can number a line in the RAW source. */
const maskStrings = (clean: string): string =>
  clean.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/gs,
    (text) => text.replace(/[^\n]/g, ' '));

const CORE_PATTERNS = [
  { kind: 'dom', re: /\b(?:document|window|navigator|localStorage|sessionStorage|HTMLElement|Document|Window|Element|Node)\b/g },
  { kind: 'timer', re: /\b(?:setTimeout|clearTimeout|setInterval|clearInterval|requestAnimationFrame|cancelAnimationFrame|queueMicrotask)\b/g },
  { kind: 'randomness', re: /\b(?:Math\s*\.\s*random|crypto\s*\.\s*getRandomValues)\b/g },
];

export interface CorePurityFinding {
  file: string;
  kind: string;
  line: number;
  token: string;
}

export interface CorePurityReport {
  findings: CorePurityFinding[];
  coreModules: number;
  problems: string[];
}

export function scanCorePurity(corpus: ModuleCorpus): CorePurityReport {
  const problems: string[] = [];
  const findings: CorePurityFinding[] = [];

  for (const file of corpus.sourceFiles.filter((candidate) =>
    corpus.relative(candidate).startsWith('src/core/') && /\.(?:ts|tsx)$/.test(candidate))) {
    const source = corpus.read(file);
    const clean = maskStrings(corpus.stripped(file));
    for (const { kind, re } of CORE_PATTERNS) {
      for (const match of clean.matchAll(re)) {
        findings.push({
          file: corpus.relative(file), kind,
          line: source.slice(0, match.index).split('\n').length,
          token: match[0].replace(/\s+/g, ''),
        });
      }
    }
    for (const specifier of corpus.importSpecifiers(file)) {
      if (/^(?:node:)?(?:timers(?:\/promises)?|crypto)$/.test(specifier)) {
        findings.push({ file: corpus.relative(file), kind: 'forbidden-import', line: 1, token: specifier });
      }
      const resolved = corpus.resolveLocal(file, specifier);
      if (resolved) {
        const target = corpus.relative(resolved);
        if (!target.startsWith('src/core/') && target !== 'src/config.ts') {
          findings.push({ file: corpus.relative(file), kind: 'forbidden-import', line: 1, token: target });
        }
      }
    }
  }

  const seenCoreDebt = new Map<string, number>();
  for (const finding of findings) {
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

  const coreModules = corpus.sourceFiles
    .filter((file) => corpus.relative(file).startsWith('src/core/')).length;
  return { findings, coreModules, problems };
}
