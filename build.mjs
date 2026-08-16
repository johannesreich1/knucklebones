// Build every deliverable from src/. Successor to build.sh + port.py:
// two Vite builds, then deterministic assembly — no regex patching of code.
//
//   dist/main/index.html   -> knucklebones-neon.html   (standalone single file)
//                          -> pwa/                     (hosted build + sw.js/manifest/icons)
//                          -> native/www/              (Capacitor web assets)
//   dist/widget/…          -> widget.html + harness.html (embeddable fragment + test page)
//
// The build tag / service-worker cache key derive from the built page's own
// hash, so a deploy is provably a new version and the title screen says which.
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from 'fs';

const die = m => { console.error('BUILD FAILED: ' + m); process.exit(1); };
const sub = (text, old, neu, label) => {
  const n = text.split(old).length - 1;
  if (n !== 1) die(`pattern for "${label}" matched ${n} times`);
  return text.replace(old, neu);
};

// ---- type gate, then the two Vite builds (each fails loudly on bad source) ----
rmSync('dist', { recursive: true, force: true });
execSync('npx tsc --noEmit', { stdio: 'inherit' });
execSync('npx vite build', { stdio: 'inherit' });
execSync('npx vite build --config vite.widget.config.mjs', { stdio: 'inherit' });

// ---- stamp the visible build tag off the artifact's own hash ----
let page = readFileSync('dist/main/index.html', 'utf8');
const HASH = createHash('md5').update(page).digest('hex').slice(0, 8);
page = sub(page, 'build dev<', `build ${HASH}<`, 'build tag');

// ---- standalone single file ----
writeFileSync('knucklebones-neon.html', page);

// ---- hosted PWA bundle ----
mkdirSync('pwa', { recursive: true });
for (const f of readdirSync('dist/main')) {
  if (f !== 'index.html') cpSync('dist/main/' + f, 'pwa/' + f, { recursive: true });
}
writeFileSync('pwa/index.html', sub(page, '</head>',
  `<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
</head>`, 'pwa link injection'));
const sw = readFileSync('public/sw.js', 'utf8');
if (!sw.includes("const VERSION = 'kb-dev';")) die('sw.js VERSION template');
writeFileSync('pwa/sw.js', sw.replace("const VERSION = 'kb-dev';", `const VERSION = 'kb-${HASH}';`));

// ---- native web assets ----
mkdirSync('native/www', { recursive: true });
cpSync('pwa', 'native/www', { recursive: true });

// ---- widget fragment: extracted from our own built page, structure guaranteed ----
const wpage = readFileSync('dist/widget/widget-page.html', 'utf8');
const styles = [...wpage.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m => m[0]);
if (!styles.length) die('widget styles');
const scriptM = wpage.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
if (!scriptM || scriptM[1].length < 1000) die('widget inline script');
const fragment =
  '<h2 class="sr-only">Playable Knucklebones dice game: two 3 by 3 grids, tap a column to place your rolled die.</h2>\n'
  + styles.join('\n') + '\n'
  + '<div id="kbroot"></div>\n'
  + '<script type="module">\n' + scriptM[1] + '\n</script>\n';
for (const needle of ['#kbroot{position:relative', 'id="kbroot"', 'MARKUP']) {
  if (!fragment.includes(needle)) die('fragment sanity: ' + needle);
}
writeFileSync('widget.html', fragment);
writeFileSync('harness.html',
  '<!DOCTYPE html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<style>body{margin:0;padding:12px 8px;background:#faf9f5}'
  + '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}</style></head><body>'
  + fragment + '</body></html>');

// ---- Capacitor sync, when the native project exists ----
try {
  execSync('[ -d native/node_modules ] && [ -d native/android ] && cd native && npx cap sync', { stdio: 'ignore', shell: '/bin/bash' });
} catch { /* no native project checked out — fine */ }

console.log(`build ok — tag ${HASH}, service worker cache key kb-${HASH}`);
