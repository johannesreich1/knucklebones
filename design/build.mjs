// Build the design cards: each screen body in design/screens/ is wrapped with
// the GAME'S OWN stylesheets (inlined) plus a little preview chrome, and lands
// in design/dist/ ready for DesignSync. Design and product share CSS by
// construction — a token change in src/styles/ re-skins every design card on
// the next build.
//
//   node design/build.mjs
//
// Screen file format: first line is a meta comment —
//   <!-- meta name="…" group="…" subtitle="…" width=400 height=900 links="A,B" -->
// followed by the card's body HTML. {{die:V:p1|p2|gold}} expands to a die.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const die = (m) => { console.error('DESIGN BUILD FAILED: ' + m); process.exit(1); };

const css = ['src/styles/page.css', 'src/styles/main.css', 'src/online/online.css']
  .map((p) => readFileSync(join(root, p), 'utf8')).join('\n');

/* preview-only chrome: the phone-shaped stage and the flow-chips strip */
const chrome = `
body{display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px 12px;overflow:auto}
.stage{position:relative;width:384px;border-radius:26px;overflow:hidden;flex:0 0 auto;
  border:1px solid rgba(255,255,255,.14);background:var(--bg);
  box-shadow:0 24px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04)}
.stage .bgfx{position:absolute;inset:0;overflow:hidden;background:
  radial-gradient(120% 80% at 50% -10%, #17123a 0%, transparent 60%),
  radial-gradient(110% 70% at 50% 110%, #04263a 0%, transparent 60%),var(--bg)}
.stage .bgfx::before{content:"";position:absolute;inset:-30%;
  background:
    radial-gradient(closest-side,rgba(255,47,160,.42),transparent 70%) 20% 16%/64% 48% no-repeat,
    radial-gradient(closest-side,rgba(40,232,255,.36),transparent 70%) 80% 86%/66% 50% no-repeat,
    radial-gradient(closest-side,rgba(126,60,255,.30),transparent 70%) 62% 42%/52% 40% no-repeat;
  filter:blur(34px)}
.stage .scr{position:relative;z-index:1;display:flex;flex-direction:column;
  min-height:640px;padding:14px 16px}
.flows{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:384px}
.flows .fc{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);
  border:1px dashed rgba(255,255,255,.22);border-radius:99px;padding:3px 9px}
.flows .fc b{color:var(--cy);font-weight:800}
.dice-static .die{animation:none}
`;

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function dieHtml(v, cls, size) {
  const on = PIPS[v] || [];
  const pips = Array.from({ length: 9 }, (_, i) =>
    `<span class="pip${on.includes(i) ? ' on' : ''}"></span>`).join('');
  const style = size ? ` style="width:${size}px;height:${size}px;--cell:${size}px"` : '';
  return `<div class="die ${cls}"${style}>${pips}<b class="num">${v}</b></div>`;
}

/* Device sizes: every screen ships at each of these. The stage is the phone
   screen; on tablet the app keeps its real max-width column, centered — that
   is honestly how it renders there today. Foundations skips variants. */
const SIZES = [
  { key: 'sm', suffix: ' · 360', stageW: 336, minH: 580, dH: -70 },
  { key: 'md', suffix: '', stageW: 384, minH: 640, dH: 0 },
  { key: 'max', suffix: ' · 430 Max', stageW: 402, minH: 720, dH: 50 },
  { key: 'tab', suffix: ' · Tablet', stageW: 520, minH: 960, dH: 300 },
];

mkdirSync(join(here, 'dist'), { recursive: true });
const screens = readdirSync(join(here, 'screens')).filter((f) => f.endsWith('.html')).sort();
if (!screens.length) die('no screens');

for (const f of screens) {
  const src = readFileSync(join(here, 'screens', f), 'utf8');
  const meta = src.match(/^<!-- meta ([\s\S]*?)-->/);
  if (!meta) die(f + ': missing meta comment');
  const attr = (k, d) => meta[1].match(new RegExp(k + '="([^"]*)"'))?.[1]
    ?? meta[1].match(new RegExp(k + '=(\\d+)'))?.[1] ?? d;
  const name = attr('name', f);
  const group = attr('group', 'Screens');
  const subtitle = attr('subtitle', '');
  const width = attr('width', '412');
  const height = attr('height', '900');
  const links = attr('links', '');

  let body = src.slice(meta[0].length)
    .replace(/\{\{die:(\d):([a-z0-9]+)(?::(\d+))?\}\}/g,
      (_, v, cls, size) => dieHtml(+v, cls === 'gold' ? 'p1 m2' : cls, size ? +size : 0));

  const flows = links
    ? `<div class="flows">${links.split(',').map((l) => `<span class="fc">→ <b>${l.trim()}</b></span>`).join('')}</div>`
    : '';

  const sizes = f.startsWith('00-') ? SIZES.filter((s) => s.key === 'md') : SIZES;
  for (const s of sizes) {
    const sizeCss = `.stage{width:${s.stageW}px}.stage .scr{min-height:${s.minH}px}`;
    const outName = s.key === 'md' ? f : f.replace('.html', `--${s.key}.html`);
    const cardName = name + s.suffix;
    const cardW = f.startsWith('00-') ? width : s.stageW + 44;
    const cardH = f.startsWith('00-') ? height : Math.max(1, +height + s.dH);
    const out = `<!-- @dsCard group="${group}" name="${cardName}" subtitle="${subtitle}" width=${cardW} height=${cardH} -->
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cardName}</title>
<style>${css}\n${chrome}\n${sizeCss}</style></head>
<body>
${body}
${flows}
</body></html>`;
    writeFileSync(join(here, 'dist', outName), out);
  }
  console.log('built', f, `(${group} · ${name} × ${sizes.length})`);
}
/* The Design System pane renders what _ds_manifest.json lists — emit it here
   so every sync carries a complete, correctly-ordered card index. */
const rank = { sm: 0, md: 1, max: 2, tab: 3 };
const cards = readdirSync(join(here, 'dist'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => {
    const first = readFileSync(join(here, 'dist', f), 'utf8').split('\n', 1)[0];
    const a = (k) => first.match(new RegExp(k + '="([^"]*)"'))?.[1] ?? '';
    const size = f.match(/--(sm|max|tab)\.html$/)?.[1] ?? 'md';
    return { path: 'screens/' + f, group: a('group'), subtitle: a('subtitle'), name: a('name'),
             _base: f.replace(/--(sm|max|tab)\.html$/, '.html'), _r: rank[size] };
  })
  .sort((x, y) => x._base.localeCompare(y._base) || x._r - y._r)
  .map(({ _base, _r, ...card }) => card);
writeFileSync(join(here, 'dist', '_ds_manifest.json'), JSON.stringify({
  namespace: 'Knucklebones_e7cddf', components: [], startingPoints: [], cards,
  templates: [], hasThumbnailHtml: false, globalCssPaths: [], tokens: [],
  themes: [], fonts: [], brandFonts: [], source: 'spa',
}, null, 2));
console.log('manifest:', cards.length, 'cards');
console.log('design cards ready in design/dist/');
