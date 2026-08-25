// Build every deliverable from src/. Three Vite builds, then deterministic
// assembly — no regex patching of code, and every step asserts.
//
//   dist/main/index.html  (single file) -> knucklebones-neon.html + native/www/
//   dist/pwa/…            (chunked)     -> pwa/  + generated sw.js precache list
//   dist/widget/…         (single file) -> widget.html + harness.html
//
// One build hash for all targets, derived from the pre-stamp bytes of EVERY
// assembled deliverable. The fixed `dev` placeholders avoid a self-reference:
// hash the standalone, native payload, final PWA layout, widget and harness,
// then replace those placeholders with the resulting tag. A public icon,
// manifest, worker or widget-only change therefore moves the same version as an
// application-code change.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'fs';
import { dirname } from 'path';
import { LEGAL_RELEASE } from './src/legal/config.ts';
import { generateLegalPageFiles, generatedLegalPaths } from './src/legal/static-pages.ts';

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
const filesIn = dir => {
  const files = new Map();
  const visit = (current, relative = '') => {
    for (const name of readdirSync(current).sort()) {
      const file = `${current}/${name}`;
      const logical = relative ? `${relative}/${name}` : name;
      if (statSync(file).isDirectory()) visit(file, logical);
      else files.set(logical, readFileSync(file));
    }
  };
  visit(dir);
  return files;
};
const buildTag = files => {
  const hash = createHash('sha256');
  const ordered = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [name, content] of ordered) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    // Names and byte lengths make concatenation unambiguous.
    hash.update(name).update('\0').update(String(bytes.length)).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex').slice(0, 8);
};

// ---- type gate, then the three Vite builds ----
rmSync('dist', { recursive: true, force: true });
runNode('node_modules/typescript/bin/tsc', ['--noEmit']);
runNode('node_modules/vite/bin/vite.js', ['build']);
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.pwa.config.mjs']);
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.widget.config.mjs']);

/* Public legal pages are generated from the same typed documents as the app,
   after Vite has assembled the hosted tree but before its file snapshot and
   content hash. Draft is fail-closed: no legal directory survives. */
rmSync('dist/pwa/legal', { recursive: true, force: true });
const legalPageFiles = generateLegalPageFiles(LEGAL_RELEASE);
for (const [name, html] of legalPageFiles) {
  const output = `dist/pwa/${name}`;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
}
const LEGAL_PATHS = generatedLegalPaths(LEGAL_RELEASE);

// ---- assemble every target with fixed placeholders, then hash those bytes ----
const single = readFileSync('dist/main/index.html', 'utf8');
const mainFiles = filesIn('dist/main');
const pwaFiles = filesIn('dist/pwa');

const pwaPageDev = sub(readFileSync('dist/pwa/index.html', 'utf8'), '</head>',
  `<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
</head>`, 'pwa link injection');
const canonicalAsset = file => file.startsWith('legal/') && file.endsWith('/index.html')
  ? `./${file.slice(0, -'index.html'.length)}`
  : `./${file}`;
const ASSETS = ['./', ...[...pwaFiles.keys()]
  .filter(file => file !== 'sw.js')
  .map(canonicalAsset)];
if (!ASSETS.some(asset => asset.includes('/assets/'))) die('expected hashed assets in the pwa bundle');
const pwaSwDev = subRe(readFileSync('public/sw.js', 'utf8'), /const ASSETS = \[[\s\S]*?\];/,
  'const ASSETS = ' + JSON.stringify(ASSETS, null, 2) + ';', 'sw precache list');
const pwaSwWithRoutes = subRe(pwaSwDev, /const LEGAL_PATHS = \[[\s\S]*?\];/,
  'const LEGAL_PATHS = ' + JSON.stringify(LEGAL_PATHS, null, 2) + ';', 'sw legal route list');

const wpage = readFileSync('dist/widget/widget-page.html', 'utf8');
const styles = [...wpage.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(match => match[0]);
if (!styles.length) die('widget styles');
const scriptM = wpage.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
if (!scriptM || scriptM[1].length < 1000) die('widget inline script');
const fragmentDev =
  styles.join('\n') + '\n'
  + '<div id="kbroot" data-build="dev">\n'
  + '<h2 class="sr-only" data-i18n="game:widget.title">Playable Knucklebones dice game: two 3 by 3 grids, tap a column to place your rolled die.</h2>\n'
  + '</div>\n'
  + '<script type="module">\n' + scriptM[1] + '\n</script>\n';
for (const needle of ['id="kbroot"', 'data-build="dev"', 'insertAdjacentHTML']) {
  if (!fragmentDev.includes(needle)) die('fragment sanity: ' + needle);
}
if (!/#kbroot\{[^}]*position:relative/.test(fragmentDev)) die('fragment sanity: #kbroot positioned');
const harnessDev =
  '<!DOCTYPE html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<style>html{--cell:host-cell;--txt:rgb(17,34,51)}'
  + 'body{margin:0;padding:12px 8px;background:rgb(250,249,245);color:rgb(31,41,55)}'
  + '#hostSentinel{display:block;width:40px;padding:5px;color:var(--txt);font:16px serif}</style>'
  + '</head><body><output id="hostSentinel">host</output>' + fragmentDev + '</body></html>';

const tagInputs = new Map([['standalone/knucklebones-neon.html', single]]);
for (const [name, content] of mainFiles) tagInputs.set(`native/www/${name}`, content);
for (const [name, content] of pwaFiles) {
  tagInputs.set(`pwa/${name}`, name === 'index.html' ? pwaPageDev : name === 'sw.js' ? pwaSwWithRoutes : content);
}
tagInputs.set('widget.html', fragmentDev);
tagInputs.set('harness.html', harnessDev);
const HASH = buildTag(tagInputs);
const stamp = (html, label) => sub(html, 'data-build="dev"', `data-build="${HASH}"`, label);

// ---- standalone single file + native web assets ----
writeFileSync('knucklebones-neon.html', stamp(single, 'neon build tag'));
rmSync('native/www', { recursive: true, force: true });
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
writeFileSync('pwa/index.html', stamp(pwaPageDev, 'pwa build tag'));
writeFileSync('pwa/sw.js',
  sub(pwaSwWithRoutes, "const VERSION = 'kb-dev';", `const VERSION = 'kb-${HASH}';`, 'sw cache key'));

// ---- widget fragment: extracted from our own built page, structure guaranteed ----
writeFileSync('widget.html', stamp(fragmentDev, 'widget build tag'));
writeFileSync('harness.html', stamp(harnessDev, 'harness build tag'));

console.log(`build ok — tag ${HASH}, sw cache key kb-${HASH}, ${ASSETS.length} precached files, ${LEGAL_PATHS.length} legal routes`);
