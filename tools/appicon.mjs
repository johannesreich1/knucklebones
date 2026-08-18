// The app icon, generated rather than hand-drawn: one die face, five pips, the
// game's own cyan/magenta diagonal. Every size the PWA, Android and iOS ask for
// comes out of the SAME vector, so they can never drift apart.
//
//   node tools/appicon.mjs           regenerate the shipped icon (SHIPPED below)
//   node tools/appicon.mjs a         try another variant without editing anything
//   node tools/appicon.mjs c --dry   render a side-by-side sheet, write nothing
//
// Variants are kept on purpose: the choice between them is a taste call that
// gets revisited, and re-deriving the two not chosen is the annoying part.
//   a  the DIE carries the gradient, pips punched out dark — loudest at 60px
//   b  dark die, the PIPS carry the gradient — closest to the in-game die
//   c  dark body, gradient frame AND pips — the game's look, still colourful
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const SHIPPED = 'c';
const CY = '#28e8ff', MG = '#ff2fa0', BG = '#05060e';
/* the 5 face: four corners and the centre, in a 0..1 square */
const PIPS = [[.26, .26], [.74, .26], [.5, .5], [.26, .74], [.74, .74]];

/* `pad` is the margin around the die as a fraction of the canvas. Maskable
   icons are cropped to an unknown shape, so their art must sit inside the
   middle 80% — they get a much bigger margin than the square ones. */
/* The die body and the canvas behind it. The gradient frame and pips never
   change — they ARE the identity, and they read on either ground. */
const THEME = {
  dark:  { body: '#0a0c16', bodyB: '#0f1220', canvas: BG,        pipCut: '#0a0c16' },
  light: { body: '#ffffff', bodyB: '#f7f9fd', canvas: '#f2f4f9', pipCut: '#0a0c16' },
};
export function iconSVG(kind = SHIPPED, S = 512, pad = .085, theme = 'dark') {
  const T = THEME[theme] ?? THEME.dark;
  const m = S * pad, box = S - m * 2, r = box * .235, pr = box * .092;
  const pip = ([x, y], fill) =>
    `<circle cx="${(m + x * box).toFixed(2)}" cy="${(m + y * box).toFixed(2)}" r="${pr.toFixed(2)}" fill="${fill}"/>`;
  const defs = `
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${MG}"/><stop offset="1" stop-color="${CY}"/>
    </linearGradient>
    <filter id="f" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${(S * .022).toFixed(2)}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;
  const face = (fill, stroke, sw) =>
    `<rect x="${m.toFixed(2)}" y="${m.toFixed(2)}" width="${box.toFixed(2)}" height="${box.toFixed(2)}"` +
    ` rx="${r.toFixed(2)}" fill="${fill}"` +
    (stroke ? ` stroke="${stroke}" stroke-width="${sw.toFixed(2)}"` : '') + `/>`;
  const glowPips = `<g filter="url(#f)">${PIPS.map(p => pip(p, 'url(#g)')).join('')}</g>`;
  const body =
    kind === 'a' ? face('url(#g)') + PIPS.map(p => pip(p, T.pipCut)).join('')
    : kind === 'b' ? face(T.bodyB, 'url(#g)', S * .012) + glowPips
    : face(T.body, 'url(#g)', S * .026) + glowPips;
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>${defs}</defs><rect width="${S}" height="${S}" fill="${T.canvas}"/>${body}</svg>`;
}

/* Every target that has to carry the icon. iOS reads the asset catalogue, the
   manifest reads public/, and build.mjs copies public/ into every web target —
   so this list is the whole story. */
const TARGETS = [
  { file: 'public/icon-180.png', size: 180 },
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  { file: 'public/icon-maskable-512.png', size: 512, pad: .2 },
  /* iOS 18 asks for an appearance pair. LIGHT is the "Any" slot — the fallback
     the system uses in light mode and anywhere else it needs one icon — and
     DARK fills the dark-mode slot. Android and the PWA cannot switch at all,
     so they keep the dark one and that stays the app's usual face. */
  { file: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', size: 1024, theme: 'light' },
  { file: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-Dark-512@2x.png', size: 1024, theme: 'dark' },
];

/* importing iconSVG must not regenerate anything — only running the file does */
const RUN_AS_SCRIPT = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (!RUN_AS_SCRIPT) { /* imported for iconSVG alone */ }
else await main();

async function main() {
const [, , argVariant, ...flags] = process.argv;
const kind = (argVariant && /^[abc]$/i.test(argVariant) ? argVariant.toLowerCase() : SHIPPED);
const dry = flags.includes('--dry');

const browser = await chromium.launch();
try {
  const shot = async (svg, size) => {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0">${svg}</body>`);
    const buf = await page.screenshot({ omitBackground: false });
    await page.close();
    return buf;
  };
  if (dry) {
    const row = ['a', 'b', 'c'].map((k) => iconSVG(k, 512)).join('');
    const page = await browser.newPage({ viewport: { width: 1536, height: 512 } });
    await page.setContent(`<body style="margin:0;display:flex">${row}</body>`);
    await page.screenshot({ path: 'icon-variants.png' });
    await page.close();
    console.log('wrote icon-variants.png (a | b | c) — nothing else touched');
  } else {
    for (const t of TARGETS) {
      const buf = await shot(iconSVG(kind, t.size, t.pad, t.theme), t.size);
      mkdirSync(dirname(t.file), { recursive: true });
      writeFileSync(t.file, buf);
      console.log(`${t.file}  ${t.size}x${t.size}` +
        `${t.pad ? '  (maskable safe zone)' : ''}${t.theme === 'light' ? '  (light appearance)' : ''}`);
    }
    console.log(`icon set regenerated from variant "${kind}"`);
  }
} finally { await browser.close(); }
}
