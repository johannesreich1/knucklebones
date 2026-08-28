// Import cycles inside src/, ratcheted one EDGE at a time.
import type { ModuleCorpus } from './module-corpus.ts';

// These are the current cyclic EDGES, not just their participants. Removing
// any edge can only improve the graph; a new edge inside an old component is
// still new debt and fails. Grouping only supplies the shared rationale.
const ALLOWED_CYCLE_EDGE_GROUPS: Array<{ edges: Array<[string, string]>; rationale: string }> = [];
const ALLOWED_CYCLIC_EDGES = new Set(ALLOWED_CYCLE_EDGE_GROUPS.flatMap((group) =>
  group.edges.map(([from, to]) => `${from} -> ${to}`)));

export interface ImportCycleReport {
  importCycles: string[][];
  cyclicEdges: string[];
  problems: string[];
}

export function findImportCycles(corpus: ModuleCorpus): ImportCycleReport {
  const { graph, relative } = corpus;

  /* Tarjan's algorithm reports strongly connected components, which is more
     useful than printing dozens of equivalent paths through the same cycle.
     Its bookkeeping is LOCAL to the call on purpose: held at module scope, a
     second call would find every node already indexed, walk nothing, and
     report the graph as acyclic. */
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

  const problems: string[] = [];
  const cyclicEdges: string[] = [];
  for (const component of cyclicComponents) {
    const members = new Set(component);
    const componentEdges = component.flatMap((from) => (graph.get(corpus.resolve(from)) ?? [])
      .map(relative).filter((to) => members.has(to)).map((to) => `${from} -> ${to}`)).sort();
    cyclicEdges.push(...componentEdges);
    const newEdges = componentEdges.filter((edge) => !ALLOWED_CYCLIC_EDGES.has(edge));
    if (newEdges.length) {
      problems.push(`new source import cycle among ${component.join(', ')}; new cyclic edge(s): `
        + `${newEdges.join(', ')}. Break it with a lower-level module or an injected typed port; `
        + `do not expand the baseline.`);
    }
  }

  return { importCycles: cyclicComponents, cyclicEdges, problems };
}
