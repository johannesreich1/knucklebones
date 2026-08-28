// What may reach what.
//
// These three rules are properties of the RESOLVED import graph, not of any
// one file's text: both game drivers must still reach the shared view, online
// may never reach the concrete local flow, and no eagerly bundled module may
// statically reach the lazy online chunk. Reading a single module cannot
// answer any of them, which is why they do not live in
// architecture-dom-ownership.ts next to the seam scans.
import type { ModuleCorpus } from './module-corpus.ts';
import { DEATH_OWNER, MOTION_OWNER, MOVE_VIEW_OWNER } from './architecture-dom-ownership.ts';

const GAME_DRIVERS = ['src/flow/game.ts', 'src/online/play/play.ts'];

/* src/online is a LAZY chunk: one static import from the eagerly bundled layers
   (core/flow/ui/i18n/legal and the root modules) would merge the Supabase client
   into every local/widget load. Only boot's dynamic import() entries are legal. */
const EAGER_BUNDLE = /^src\/(?:core|flow|ui|i18n|legal)\/|^src\/[^/]+\.tsx?$/;

export interface BundleGraphReport {
  onlineChunkEscapes: string[];
  problems: string[];
}

export function scanBundleGraph(corpus: ModuleCorpus): BundleGraphReport {
  const problems: string[] = [];
  const onlineChunkEscapes: string[] = [];

  for (const driver of GAME_DRIVERS) {
    const dependencies = corpus.reachableFrom(driver);
    const driverSource = corpus.stripped(driver);
    for (const owner of [MOVE_VIEW_OWNER, MOTION_OWNER, DEATH_OWNER]) {
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
  for (const file of corpus.graphFiles.map(corpus.relative)
    .filter((name) => name.startsWith('src/online/'))) {
    if (corpus.reachableFrom(file).has('src/flow/game.ts')) {
      problems.push(`${file} imports the concrete local-game flow. Inject cross-flow actions from `
        + `src/boot.ts or its binding modules instead.`);
    }
  }

  for (const file of corpus.graphFiles
    .filter((candidate) => EAGER_BUNDLE.test(corpus.relative(candidate)))) {
    const staticOnline = [...new Set(corpus.staticSpecifiers(file)
      .map((specifier) => corpus.resolveLocal(file, specifier))
      .filter((target): target is string =>
        !!target && corpus.relative(target).startsWith('src/online/'))
      .map(corpus.relative))];
    if (!staticOnline.length) continue;
    onlineChunkEscapes.push(corpus.relative(file));
    problems.push(`${corpus.relative(file)} statically imports ${staticOnline.join(', ')}; reach the lazy `
      + `online chunk only through boot's dynamic import() entries or an injected typed port.`);
  }

  return { onlineChunkEscapes, problems };
}
