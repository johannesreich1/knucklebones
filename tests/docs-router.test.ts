// THE DOCUMENT ROUTER MUST AGREE WITH ITSELF AND WITH THE TREE.
//
// The router has two halves on purpose: the task → document table in CLAUDE.md
// and AGENTS.md (byte-identical by repo rule), always in context so routing
// works before anything is loaded; and the knucklebones-docs skill, which maps
// what each of those documents owns and does not. Two files that must name
// the same documents will diverge unless something asserts they agree — the
// App Store locale set was the same lesson (marketing/app-store/ios/README.md,
// "The locale set is written once"), learned by losing three languages to a
// merge.
//
// What this pins, and the day each rule was first broken (all 2026-09-05):
//   · The skill is TRACKED. `.claude/skills/` was gitignored wholesale for the
//     npx-installed skills, so the router commit (bf7f747b) shipped a CLAUDE.md
//     that pointed every other checkout, worktree and CI run at a file none of
//     them had. "Not ignored" is not enough — the file must be in the index.
//   · A "§ N" reference resolves to exactly one "## N." heading. LADDER.md
//     grew a second "## 7." the same day, so "§ 7" meant progression v2 to
//     STATUS.md and the queue to the router.
//   · Every routed path exists, the table and the map name the same set of
//     documents, and CLAUDE.md names the skill's path — an agent that cannot
//     invoke skills (anything reading AGENTS.md) must still be able to open it.
// Run from the repository root:
//   mise exec -- node --experimental-strip-types tests/docs-router.test.ts
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { emitReport } from './support/emit-report.mjs';

const ROOT = process.cwd();
const SKILL = '.claude/skills/knucklebones-docs/SKILL.md';
const SKILL_NAME = 'knucklebones-docs';
const CLAUDE = 'CLAUDE.md';
const AGENTS = 'AGENTS.md';
const STATUS = 'docs/STATUS.md';

const problems: string[] = [];
const check = (ok: unknown, message: string): void => {
  if (!ok) problems.push(message);
};
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

/* ------------------------------------------------------------------------
 * The two always-loaded copies are one file.
 * ---------------------------------------------------------------------- */

check(readFileSync(path.join(ROOT, CLAUDE)).equals(readFileSync(path.join(ROOT, AGENTS))),
  `${CLAUDE} and ${AGENTS} differ; the repo rule is that they stay byte-identical`);

/* ------------------------------------------------------------------------
 * The skill exists in every checkout, not only this one.
 * ---------------------------------------------------------------------- */

check(existsSync(path.join(ROOT, SKILL)), `${SKILL} is missing`);
const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', SKILL], { cwd: ROOT });
check(tracked.status === 0,
  `${SKILL} is not tracked by git (ls-files exited ${tracked.status}); un-ignore it and add it, `
  + 'or every other checkout routes to a file it does not have');

/* ------------------------------------------------------------------------
 * Routing tables: which rows, which paths.
 * ---------------------------------------------------------------------- */

/** The body of one `## heading` section: from the heading to the next `## `. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`);
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Table rows of a section, minus the header and the separator. */
function tableRows(text: string): string[] {
  return text.split('\n')
    .filter((line) => line.startsWith('|'))
    .filter((line) => !/^\|\s*-+\s*\|/.test(line))
    .slice(1);
}

const PATH_TOKEN = /`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:md|ts|mjs|json))(?:\s*§\s*\d+)?`/g;
const LINK_TARGET = /\]\(([^)]+\.md)\)/g;

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;

/** Repo-relative paths a table routes to, from backticks and markdown links.
 *  A link's target is relative to the document (STATUS.md links `LADDER.md`
 *  from docs/); a bare backtick is repo-relative. The link is removed before
 *  the backtick scan so its backticked text is not read as a second path. */
function routedPaths(rows: string[], baseDir = ''): Set<string> {
  const found = new Set<string>();
  for (const row of rows) {
    for (const match of row.matchAll(LINK_TARGET)) found.add(path.posix.join(baseDir, match[1]));
    for (const match of row.replace(MARKDOWN_LINK, '').matchAll(PATH_TOKEN)) found.add(match[1]);
  }
  return found;
}

const claudeText = read(CLAUDE);
const skillText = existsSync(path.join(ROOT, SKILL)) ? read(SKILL) : '';
const statusText = read(STATUS);

const claudeRows = tableRows(section(claudeText, 'Load only the context the task needs'));
const skillRows = tableRows(section(skillText, 'What each document owns'));
const statusRows = tableRows(section(statusText, 'Documentation map'));
check(claudeRows.length > 0, `${CLAUDE} has no routing table under "Load only the context the task needs"`);
check(skillRows.length > 0, `${SKILL} has no ownership map under "What each document owns"`);
check(statusRows.length > 0, `${STATUS} has no table under "Documentation map"`);

/* The map's first column names the documents a row covers; its other cells
   are prose and may mention anything. */
const firstCell = (row: string): string => row.split('|')[1] ?? '';
const tables: Array<[string, Set<string>]> = [
  [CLAUDE, routedPaths(claudeRows)],
  [SKILL, routedPaths(skillRows.map(firstCell))],
  [STATUS, routedPaths(statusRows, 'docs')],
];
for (const [file, paths] of tables) {
  for (const target of paths) {
    check(existsSync(path.join(ROOT, target)), `${file} routes to ${target}, which does not exist`);
  }
}

/* Two halves, one set of documents: a document the table routes to but the
   map does not describe (or the reverse) is a fork of the router. */
for (const target of tables[0][1]) {
  check(tables[1][1].has(target), `${CLAUDE} routes to ${target} but ${SKILL} does not describe it`);
}
for (const target of tables[1][1]) {
  check(tables[0][1].has(target), `${SKILL} describes ${target} but ${CLAUDE} does not route to it`);
}

/* ------------------------------------------------------------------------
 * Section references resolve to exactly one heading.
 * ---------------------------------------------------------------------- */

const SECTION_REF = /`([A-Za-z0-9_./-]+\.md)(?:`\s*§\s*(\d+)|\s*§\s*(\d+)`)/g;
const headingNumbers = (text: string): string[] =>
  [...text.matchAll(/^##\s+(\d+)\./gm)].map((match) => match[1]);

let sectionRefs = 0;
for (const file of [CLAUDE, SKILL, STATUS]) {
  const text = file === SKILL ? skillText : read(file);
  for (const match of text.matchAll(SECTION_REF)) {
    sectionRefs += 1;
    const [, target, a, b] = match;
    const number = a ?? b;
    if (!existsSync(path.join(ROOT, target))) {
      problems.push(`${file} references ${target} § ${number}, and the file does not exist`);
      continue;
    }
    const hits = headingNumbers(read(target)).filter((n) => n === number).length;
    check(hits === 1,
      `${file} references ${target} § ${number}, which matches ${hits} "## ${number}." headings there`);
  }
}

/* Two sections with one number make every "§ N" ambiguous, referenced or not. */
const routedDocs = new Set([...tables.flatMap(([, paths]) => [...paths])].filter((p) => p.endsWith('.md')));
for (const doc of routedDocs) {
  if (!existsSync(path.join(ROOT, doc))) continue;
  const numbers = headingNumbers(read(doc));
  const duplicates = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))];
  check(duplicates.length === 0,
    `${doc} numbers more than one section ${duplicates.map((n) => `"## ${n}."`).join(', ')}`);
}

/* ------------------------------------------------------------------------
 * The skill is a skill, and CLAUDE.md says where it is.
 * ---------------------------------------------------------------------- */

const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skillText)?.[1] ?? '';
const field = (name: string): string =>
  new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(frontmatter)?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
check(field('name') === SKILL_NAME,
  `${SKILL} frontmatter name is "${field('name')}", not the directory name "${SKILL_NAME}"`);
check(field('description').length > 0 && field('description').length <= 1024,
  `${SKILL} description is ${field('description').length} characters; it must be 1–1024`);
check(skillText.split('\n').length <= 500, `${SKILL} body exceeds 500 lines; move detail into owner documents`);
check(claudeText.includes(SKILL),
  `${CLAUDE} must name the skill's path (${SKILL}) so an agent that cannot invoke skills can still read it`);

emitReport({
  routers: [CLAUDE, AGENTS, SKILL, STATUS],
  routedPaths: routedDocs.size,
  sectionRefs,
  problems,
}, problems.length > 0);
