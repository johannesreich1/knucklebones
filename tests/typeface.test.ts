// THE APP MAY NOT ASK FOR A WEIGHT IT DOES NOT SHIP.
//
// The app bundles one face. That face has a heaviest weight, and every rule in
// the product has to fit under it — which is not something a browser will ever
// tell you, because CSS weight matching is defined to succeed: ask for 900 from
// a family whose heaviest face is 700 and you get the 700 face, silently, with
// the stylesheet still saying 900. Nothing renders wrong, nothing throws, and
// the design's intent quietly stops being true.
//
// That is not hypothetical. Four rules in this app asked for `font-weight:950`
// for months. The comfortable reading — nothing goes past Black, so it renders
// as 900 — turned out to be false on macOS (ui-rounded keeps going, and 950
// paints measurably wider), and true everywhere else. Either way nobody chose
// it, no test saw it, and it survived a font audit by looking reasonable.
//
// So the ceiling is asserted here, statically, against the faces the app
// actually declares. Three rules:
//
//   1. no numeric font-weight literal survives outside an @font-face block —
//      every rule reads a token, which is what makes the ceiling retunable
//   2. every --fw-* a rule reads is declared
//   3. no declared --fw-* exceeds the heaviest shipped face
//
// The pixel half of this question — did the face actually load and bind on this
// page — is tests/support/rendering-font.mjs, asserted by every geometry suite.
import { readFileSync } from 'node:fs';
import { inlineCssGraph } from '../tools/css-graph.mjs';
import { shippedTypeface } from './support/rendering-font.mjs';

const problems: string[] = [];
const errs: string[] = [];
const out: Record<string, unknown> = {};

/** Rules the browser resolves, with the face declarations removed: an
 *  @font-face's own `font-weight` names the weight of a FILE, not a request. */
const ruleCss = (label: string, entries: string[]): string => {
  try {
    const { css } = inlineCssGraph(entries, { rootDir: process.cwd(), separator: '\n' });
    return css.replace(/@font-face\s*\{[^}]*\}/gs, '');
  } catch (error) {
    errs.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
};

let face: { family: string; weights: number[] } | null = null;
try {
  face = shippedTypeface();
  out.shipped = face;
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error));
}

/* Both builds, because the widget carries its own root declaration and would
   otherwise be free to drift. design/build.mjs's preview chrome is checked as
   text: its rules land inside the same #kbroot and must obey the same ceiling. */
const graphs: Record<string, string> = {
  app: ruleCss('app', ['src/styles/page.css', 'src/styles/main.css', 'src/online/online.css']),
  widget: ruleCss('widget', ['src/styles/widget-embed.css', 'src/styles/main.css']),
};
const designChrome = readFileSync('design/build.mjs', 'utf8')
  // the {{font:…}} generator emits @font-face for a STUDY's candidate; its
  // weight is a file's weight, and the app's ceiling has no claim on it
  .replace(/@font-face\{[^}]*\}/gs, '');

const tokensCss = readFileSync('src/styles/foundations/tokens.css', 'utf8');
const declared = new Map<string, number>();
for (const m of tokensCss.matchAll(/(--fw-[a-z]+)\s*:\s*(\d+)/g)) declared.set(m[1], Number(m[2]));
out.tokens = Object.fromEntries(declared);
if (!declared.size) problems.push('tokens.css declares no --fw-* weight tokens');

// 1. no literal weights left in any rule
for (const [label, css] of Object.entries({ ...graphs, designChrome })) {
  for (const m of css.matchAll(/font-weight:\s*(\d+)/g)) {
    problems.push(`${label}: font-weight:${m[1]} is a literal — read a --fw-* token instead, `
      + 'so the ceiling stays in one place');
  }
  // keyword weights hide the same problem behind a word
  for (const m of css.matchAll(/font-weight:\s*(bold|bolder|lighter)\b/g)) {
    problems.push(`${label}: font-weight:${m[1]} is a keyword — name the rung you mean`);
  }
}

// 2. every token a rule reads is declared
const used = new Set<string>();
for (const css of [...Object.values(graphs), designChrome]) {
  for (const m of css.matchAll(/font-weight:\s*var\((--fw-[a-z]+)/g)) used.add(m[1]);
}
out.tokensUsed = [...used].sort();
for (const token of used) {
  if (!declared.has(token)) problems.push(`${token} is read by a rule but declared nowhere`);
}
for (const token of declared.keys()) {
  if (!used.has(token) && token !== '--fw-body') {
    problems.push(`${token} is declared but no rule reads it — delete the rung or use it`);
  }
}

// 3. the ceiling itself
if (face) {
  const heaviest = Math.max(...face.weights);
  out.ceiling = heaviest;
  for (const [token, value] of declared) {
    if (value > heaviest) {
      problems.push(`${token}:${value} is above the heaviest face this app ships `
        + `(${face.family} ${heaviest}). It will render as ${heaviest} and the stylesheet `
        + 'will keep claiming otherwise — the exact shape of the font-weight:950 bug.');
    }
  }
  /* A weight a rule can reach that has no FILE renders as its nearest shipped
     neighbour. That is legal CSS and a broken design, so name it. */
  for (const [token, value] of declared) {
    if (value <= heaviest && !face.weights.includes(value)) {
      problems.push(`${token}:${value} has no face in the bundle (${face.family} ships `
        + `${face.weights.join(', ')}), so it renders as a neighbour`);
    }
  }
}

// 4. both builds name the bundled family first, and say the same thing
if (face) {
  const stackOf = (file: string): string | null => {
    const css = readFileSync(file, 'utf8').replace(/@font-face\s*\{[^}]*\}/gs, '');
    return css.match(/font-family:\s*([^;}]+)/)?.[1].trim() ?? null;
  };
  const app = stackOf('src/styles/page.css');
  const widget = stackOf('src/styles/widget-embed.css');
  out.stacks = { app, widget };
  for (const [label, stack] of Object.entries({ app, widget })) {
    if (!stack) { problems.push(`${label}: no font-family declared`); continue; }
    const first = stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (first !== face.family) {
      problems.push(`${label} stack leads with ${first}, not the bundled ${face.family} — `
        + 'the bundle would only ever be a fallback');
    }
  }
  if (app && widget && app !== widget) {
    problems.push('the two builds declare different stacks; the widget would render '
      + `a different app: app "${app}" vs widget "${widget}"`);
  }
}

console.log(JSON.stringify({ ...out, problems, errs }, null, 2));
if (problems.length || errs.length) process.exit(1);
