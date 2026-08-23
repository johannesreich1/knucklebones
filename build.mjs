// Build every deliverable from src/. Three Vite builds, then deterministic
// assembly — no regex patching of code, and every step asserts.
//
//   dist/main/index.html  (single file) -> knucklebones-neon.html + native/www/
//   dist/pwa/…            (chunked)     -> pwa/  + generated sw.js precache list
//   dist/widget/…         (single file) -> widget.html + harness.html
//
// One build hash for all targets, derived from the single-file page (it
// contains all code and styles). It becomes the visible data-build tag and the
// service-worker cache key, so "which version is my phone running?" always has
// an answer.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'fs';

const die = m => { console.error('BUILD FAILED: ' + m); process.exit(1); };
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor !== 24) die(`Node 24 is required (running ${process.versions.node}); use .nvmrc`);

/* Run every JS tool under this exact Node binary. Calling `npx` here could
   resolve a different system Node than the one that launched the build, which
   makes a nominal Node-24 build an older-runtime build in disguise. */
const runNode = (entry, args = []) =>
  execFileSync(process.execPath, [entry, ...args], { stdio: 'inherit' });
const sub = (text, old, neu, label) => {
  const n = text.split(old).length - 1;
  if (n !== 1) die(`pattern for "${label}" matched ${n} times`);
  return text.replace(old, neu);
};
const subRe = (text, re, neu, label) => {
  const ms = text.match(re);
  if (!ms) die(`pattern for "${label}" not found`);
  return text.replace(re, neu);
};

// ---- type gate, then the three Vite builds ----
rmSync('dist', { recursive: true, force: true });
runNode('node_modules/typescript/bin/tsc', ['--noEmit']);
runNode('node_modules/vite/bin/vite.js', ['build']);
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.pwa.config.mjs']);
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.widget.config.mjs']);

// ---- one hash for the whole build ----
const single = readFileSync('dist/main/index.html', 'utf8');
const HASH = createHash('md5').update(single).digest('hex').slice(0, 8);
const stamp = (html, label) => sub(html, 'data-build="dev"', `data-build="${HASH}"`, label);

// ---- standalone single file + native web assets ----
writeFileSync('knucklebones-neon.html', stamp(single, 'neon build tag'));
mkdirSync('native/www', { recursive: true });
cpSync('dist/main', 'native/www', { recursive: true });
writeFileSync('native/www/index.html', stamp(single, 'native build tag'));
// dist/main carries public/sw.js verbatim, so the native payload needs the same
// cache-key stamp the hosted bundle gets. Unstamped it stays 'kb-dev' in every
// build: the bytes never change, so iOS never sees a new worker to install, and
// the cache-first icons and manifest cached on first launch outlive every
// update. Its ASSETS list is right as it stands — the single-file page has no
// hashed chunks to enumerate.
writeFileSync('native/www/sw.js',
  sub(readFileSync('public/sw.js', 'utf8'), "const VERSION = 'kb-dev';",
    `const VERSION = 'kb-${HASH}';`, 'native sw cache key'));

// ---- hosted PWA bundle (chunked) ----
rmSync('pwa', { recursive: true, force: true });
cpSync('dist/pwa', 'pwa', { recursive: true });
let page = stamp(readFileSync('dist/pwa/index.html', 'utf8'), 'pwa build tag');
page = sub(page, '</head>',
  `<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
</head>`, 'pwa link injection');
writeFileSync('pwa/index.html', page);

// service worker: cache key + precache list generated from the actual output
const walk = (dir, prefix = '.') => readdirSync(dir).flatMap(f => {
  const p = dir + '/' + f;
  return statSync(p).isDirectory() ? walk(p, prefix + '/' + f) : [prefix + '/' + f];
});
const ASSETS = ['./', ...walk('pwa').filter(f => !f.endsWith('/sw.js') && !f.endsWith('/README.md'))];
if (!ASSETS.some(a => a.includes('/assets/'))) die('expected hashed assets in the pwa bundle');
let sw = readFileSync('public/sw.js', 'utf8');
sw = sub(sw, "const VERSION = 'kb-dev';", `const VERSION = 'kb-${HASH}';`, 'sw cache key');
sw = subRe(sw, /const ASSETS = \[[\s\S]*?\];/,
  'const ASSETS = ' + JSON.stringify(ASSETS, null, 2) + ';', 'sw precache list');
writeFileSync('pwa/sw.js', sw);

// ---- widget fragment: extracted from our own built page, structure guaranteed ----
const wpage = readFileSync('dist/widget/widget-page.html', 'utf8');
const styles = [...wpage.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m => m[0]);
if (!styles.length) die('widget styles');
const scriptM = wpage.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
if (!scriptM || scriptM[1].length < 1000) die('widget inline script');
const fragment =
  styles.join('\n') + '\n'
  + '<div id="kbroot">\n'
  + '<h2 class="sr-only">Playable Knucklebones dice game: two 3 by 3 grids, tap a column to place your rolled die.</h2>\n'
  + '</div>\n'
  + '<script type="module">\n' + scriptM[1] + '\n</script>\n';
// needles must survive minification: our own added div, and a DOM method name
// (the minifier mangles identifiers but never property names)
for (const needle of ['id="kbroot"', 'insertAdjacentHTML']) {
  if (!fragment.includes(needle)) die('fragment sanity: ' + needle);
}
// the widget-embed shell rule must be present and positioned — the CSS
// minifier merges #kbroot rules and reorders declarations, so match loosely
if (!/#kbroot\{[^}]*position:relative/.test(fragment)) die('fragment sanity: #kbroot positioned');
writeFileSync('widget.html', fragment);
writeFileSync('harness.html',
  '<!DOCTYPE html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<style>html{--cell:host-cell;--txt:rgb(17,34,51)}'
  + 'body{margin:0;padding:12px 8px;background:rgb(250,249,245);color:rgb(31,41,55)}'
  + '#hostSentinel{display:block;width:40px;padding:5px;color:var(--txt);font:16px serif}</style>'
  + '</head><body><output id="hostSentinel">host</output>' + fragment + '</body></html>');

console.log(`build ok — tag ${HASH}, sw cache key kb-${HASH}, ${ASSETS.length} precached files`);
