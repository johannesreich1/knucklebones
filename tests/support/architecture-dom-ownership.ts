// Single-owner seams, proven by reading every module that is NOT the owner.
//
// Each rule here names one file that may do a thing and asserts nobody else
// does it: the #kbroot state classes, host-document lookups and hit tests, the
// Edge Function transport, and game-die motion. They are text scans on purpose
// — a bypass is caught in the module that wrote it, before it ever shows up as
// a graph edge (architecture-bundle-graph.ts owns the graph-shaped rules).
import type { ModuleCorpus } from './module-corpus.ts';

/* The game shell's JS→CSS class contract has one typed owner. State lives on
   #kbroot (not the host documentElement), and a direct read is also an escape:
   consumers ask semantic queries so `p2turn => face` cannot be bypassed. */
const ROOT_STATE_OWNER = 'src/ui/game/root-state.ts';
const ROOT_STATE_CLASS = /['"](?:rowmode|rowswitch|face|p2turn|opponent-turn|land|shortv|sidepts|casting|castself|numerals|clock|tut)['"]/;

/* The shared game view's owners live here because this module polices who may
   paint their pixels; architecture-bundle-graph.ts imports them to assert that
   both drivers still reach them. */
export const MOVE_VIEW_OWNER = 'src/ui/game/move-view.ts';
export const MOTION_OWNER = 'src/ui/game/motion.ts';
export const DEATH_OWNER = 'src/ui/game/destruction-view.ts'; // move-view's destruction owner

export interface DomOwnershipReport {
  rootStateEscapes: string[];
  rootQueryEscapes: string[];
  rootHitTestEscapes: string[];
  edgeTransportEscapes: string[];
  gameViewEscapes: string[];
  problems: string[];
}

export function scanDomOwnership(corpus: ModuleCorpus): DomOwnershipReport {
  const problems: string[] = [];
  const rootStateEscapes: string[] = [];
  const rootQueryEscapes: string[] = [];
  const rootHitTestEscapes: string[] = [];
  const edgeTransportEscapes: string[] = [];
  const gameViewEscapes: string[] = [];
  const modules = corpus.sourceFiles.filter((candidate) => /\.tsx?$/.test(candidate));

  for (const file of modules) {
    const name = corpus.relative(file);
    if (name === ROOT_STATE_OWNER) continue;
    const clean = corpus.stripped(file);
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
    /* supabase-js's FunctionsClient attaches an x-client-info header that the
       Edge CORS allow-list did not name, so the browser answered a successful
       preflight by dropping the POST — no request, no error, no log. */
    if (/\bfunctions\s*\.\s*invoke\s*\(/.test(clean)) {
      edgeTransportEscapes.push(name);
      problems.push(`${name} calls functions.invoke(). Send every Edge Function request through `
        + `callFunction() in src/online/api/client.ts, whose headers the shared CORS allow-list `
        + `names; a library-added header makes the browser silently drop the POST.`);
    }
  }

  /* A SECOND pass over the same files, deliberately. The loop above skips
     ROOT_STATE_OWNER outright, so folding private motion into it would exempt
     root-state.ts from this rule too and silently stop policing 'rolling' and
     'dying' there. The corpus already holds the stripped text; the pass is free. */
  for (const file of modules) {
    const name = corpus.relative(file);
    const clean = corpus.stripped(file);
    const privateRoll = /\.classList\s*\.\s*(?:add|toggle)\s*\(\s*['"]rolling['"]/.test(clean);
    const privateDeath = /\.classList\s*\.\s*add\s*\(\s*['"]dying['"]/.test(clean);
    if ((privateRoll && name !== MOTION_OWNER) || (privateDeath && name !== DEATH_OWNER)) {
      gameViewEscapes.push(name);
      problems.push(`${name} implements private game-die motion. Extend ${MOTION_OWNER} or `
        + `${DEATH_OWNER} through a typed option instead of duplicating the visual pipeline.`);
    }
  }

  return {
    rootStateEscapes, rootQueryEscapes, rootHitTestEscapes,
    edgeTransportEscapes, gameViewEscapes, problems,
  };
}
