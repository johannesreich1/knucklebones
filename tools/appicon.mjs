// The app icon, generated rather than hand-drawn: one die face, five pips, the
// game's own cyan/magenta diagonal. Every size the PWA, Android and iOS ask for
// comes out of the SAME vector, so they can never drift apart.
//
//   mise exec -- node tools/appicon.mjs           regenerate the shipped APP_ICON_VARIANT below
//   mise exec -- node tools/appicon.mjs a         try another variant without editing anything
//   mise exec -- node tools/appicon.mjs c --dry   render a side-by-side sheet, write nothing
//   mise exec -- node tools/appicon.mjs --android render @capacitor/assets Android inputs only
//   mise exec -- node tools/appicon.mjs --android-finalize restore adaptive XML after that CLI runs
//
// Variants are kept on purpose: the choice between them is a taste call that
// gets revisited, and re-deriving the two not chosen is the annoying part.
//   a  the DIE carries the gradient, pips are true cutouts — loudest at 60px
//   b  dark die, the PIPS carry the gradient — closest to the in-game die
//   c  dark body, gradient frame AND pips — the game's look, still colourful
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export const APP_ICON_VARIANT = 'a';
export const APP_ICON_PAD = .15;
export const MASKABLE_ICON_PAD = .2;
export const SYSTEM_DARK_GRADIENT = Object.freeze({ top: '#313131', bottom: '#141414' });
export const SYSTEM_LIGHT_GRADIENT = Object.freeze({ top: '#ffffff', bottom: '#e5e5e5' });
const CY = '#28e8ff', MG = '#ff2fa0';
/* the 5 face: four corners and the centre, in a 0..1 square */
const PIPS = [[.26, .26], [.74, .26], [.5, .5], [.26, .74], [.74, .74]];

/* `pad` is the margin around the die as a fraction of the canvas. The shipped
   15% gives Apple's current grid more breathing room; maskable icons get 20%
   because an unknown launcher shape can crop their outer fifth. */
/* iOS supplies its exact System Dark gradient behind the transparent Dark
   rendition. The opaque light fallback and platforms without appearance-aware
   backgrounds use quiet neutral equivalents: light from the top, dark below,
   matching the system lighting direction without copying another app's art. */
const THEME = {
  dark:  {
    body: '#0a0c16', bodyB: '#0f1220',
    canvasTop: SYSTEM_DARK_GRADIENT.top, canvasBottom: SYSTEM_DARK_GRADIENT.bottom,
  },
  light: {
    body: '#ffffff', bodyB: '#f7f9fd',
    canvasTop: SYSTEM_LIGHT_GRADIENT.top, canvasBottom: SYSTEM_LIGHT_GRADIENT.bottom,
  },
};
export function iconSVG(
  kind = APP_ICON_VARIANT,
  S = 512,
  pad = APP_ICON_PAD,
  theme = 'dark',
  transparent = false,
) {
  const T = THEME[theme] ?? THEME.dark;
  const m = S * pad, box = S - m * 2, r = box * .235, pr = box * .092;
  const pip = ([x, y], fill) =>
    `<circle cx="${(m + x * box).toFixed(2)}" cy="${(m + y * box).toFixed(2)}" r="${pr.toFixed(2)}" fill="${fill}"/>`;
  const defs = `
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${T.canvasTop}"/><stop offset="1" stop-color="${T.canvasBottom}"/>
    </linearGradient>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${MG}"/><stop offset="1" stop-color="${CY}"/>
    </linearGradient>
    <mask id="die-cutouts" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}">
      <rect width="${S}" height="${S}" fill="#000"/>
      <rect x="${m.toFixed(2)}" y="${m.toFixed(2)}" width="${box.toFixed(2)}" height="${box.toFixed(2)}"
        rx="${r.toFixed(2)}" fill="#fff"/>
      ${PIPS.map(p => pip(p, '#000')).join('')}
    </mask>
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
    kind === 'a' ? `<g mask="url(#die-cutouts)">${face('url(#g)')}</g>`
    : kind === 'b' ? face(T.bodyB, 'url(#g)', S * .012) + glowPips
    : face(T.body, 'url(#g)', S * .026) + glowPips;
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>${defs}</defs>${transparent ? '' : `<rect width="${S}" height="${S}" fill="url(#bg)"/>`}${body}</svg>`;
}

/* Adaptive foregrounds must carry alpha: Android supplies and independently
   masks the background layer. Keep the mark otherwise identical to the
   shipped icon so the adaptive, round and legacy launchers remain one design. */
export function adaptiveForegroundSVG(kind = APP_ICON_VARIANT, S = 1024) {
  return iconSVG(kind, S, APP_ICON_PAD, 'dark', true);
}

export function iconBackgroundSVG(S = 1024) {
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${THEME.dark.canvasTop}"/>` +
    `<stop offset="1" stop-color="${THEME.dark.canvasBottom}"/></linearGradient></defs>` +
    `<rect width="${S}" height="${S}" fill="url(#bg)"/></svg>`;
}

/* @capacitor/assets 3.0.5 does not emit Android 13's monochrome layer. This
   extra source is an alpha mask for the Android project to resize alongside
   the generated adaptive foreground. Android applies the user's own tint, so
   gradients and glow intentionally disappear while the five-face survives. */
export function monochromeIconSVG(S = 1024, pad = APP_ICON_PAD) {
  const m = S * pad, box = S - m * 2, r = box * .235, pr = box * .092;
  const holes = PIPS.map(([x, y]) =>
    `<circle cx="${(m + x * box).toFixed(2)}" cy="${(m + y * box).toFixed(2)}" r="${pr.toFixed(2)}" fill="#000"/>`
  ).join('');
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><mask id="die"><rect width="${S}" height="${S}" fill="#000"/>` +
    `<rect x="${m.toFixed(2)}" y="${m.toFixed(2)}" width="${box.toFixed(2)}" height="${box.toFixed(2)}"` +
    ` rx="${r.toFixed(2)}" fill="#fff"/>${holes}</mask></defs>` +
    `<rect width="${S}" height="${S}" fill="#fff" mask="url(#die)"/></svg>`;
}

/* Every target that has to carry the icon. iOS reads the asset catalogue, the
   manifest reads public/, and build.mjs copies public/ into every web target —
   so this list is the whole story. */
const TARGETS = [
  { file: 'public/icon-180.png', size: 180 },
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  { file: 'public/icon-maskable-512.png', size: 512, pad: MASKABLE_ICON_PAD },
  /* iOS 18 asks for an appearance pair. LIGHT is the "Any" slot — the fallback
     the system uses in light mode and anywhere else it needs one icon — and
     DARK fills the dark-mode slot. Android and the PWA cannot switch at all,
     so they keep the dark one and that stays the app's usual face. */
  { file: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', size: 1024, theme: 'light' },
  { file: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-Dark-512@2x.png', size: 1024, theme: 'dark', transparent: true },
];

/* The Assets CLI turns the four custom-mode inputs into legacy, round, and
   adaptive launchers. Capacitor Assets 3.0.5 ignores icon-monochrome, so this
   generator also writes its density-specific tracked resources directly; the
   v33 adaptive-icon XML wires that layer into themed launchers. */
const ANDROID_TARGETS = [
  { file: 'native/assets/icon-only.png', size: 1024, svg: (kind) => iconSVG(kind, 1024) },
  { file: 'native/assets/icon-foreground.png', size: 1024, transparent: true, svg: adaptiveForegroundSVG },
  { file: 'native/assets/icon-background.png', size: 1024, svg: () => iconBackgroundSVG() },
  { file: 'native/assets/icon-monochrome.png', size: 1024, transparent: true, svg: () => monochromeIconSVG() },
  ...[
    ['ldpi', 36], ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96],
    ['xxhdpi', 144], ['xxxhdpi', 192],
  ].map(([density, size]) => ({
    file: `native/android/app/src/main/res/mipmap-${density}/ic_launcher_monochrome.png`,
    size,
    transparent: true,
    svg: () => monochromeIconSVG(size),
  })),
];

const androidAdaptiveIconXML = (themed) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
    </foreground>
${themed ? `    <monochrome>
        <inset android:drawable="@mipmap/ic_launcher_monochrome" android:inset="16.7%" />
    </monochrome>
` : ''}</adaptive-icon>
`;
const ANDROID_ADAPTIVE_BACKGROUND_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient
        android:angle="270"
        android:startColor="${SYSTEM_DARK_GRADIENT.top}"
        android:endColor="${SYSTEM_DARK_GRADIENT.bottom}"
        android:type="linear" />
</shape>
`;
const ANDROID_ADAPTIVE_ICON_FILES = [
  { file: 'native/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', themed: false },
  { file: 'native/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml', themed: false },
  { file: 'native/android/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml', themed: true },
  { file: 'native/android/app/src/main/res/mipmap-anydpi-v33/ic_launcher_round.xml', themed: true },
];
const ANDROID_ADAPTIVE_BACKGROUND_FILE =
  'native/android/app/src/main/res/drawable/ic_launcher_background.xml';

function writeAndroidAdaptiveResources() {
  for (const { file, themed } of ANDROID_ADAPTIVE_ICON_FILES) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, androidAdaptiveIconXML(themed));
    console.log(`${file}  (${themed ? 'Android 13 themed' : 'adaptive'} launcher)`);
  }
  mkdirSync(dirname(ANDROID_ADAPTIVE_BACKGROUND_FILE), { recursive: true });
  writeFileSync(ANDROID_ADAPTIVE_BACKGROUND_FILE, ANDROID_ADAPTIVE_BACKGROUND_XML);
  console.log(`${ANDROID_ADAPTIVE_BACKGROUND_FILE}  (full-bleed adaptive gradient)`);
}

/* importing iconSVG must not regenerate anything — only running the file does */
const RUN_AS_SCRIPT = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (!RUN_AS_SCRIPT) { /* imported for iconSVG alone */ }
else await main();

async function main() {
const args = process.argv.slice(2);
const argVariant = args.find((arg) => /^[abc]$/i.test(arg));
const kind = argVariant ? argVariant.toLowerCase() : APP_ICON_VARIANT;
const dry = args.includes('--dry');
const android = args.includes('--android');
const androidFinalize = args.includes('--android-finalize');

/* Capacitor Assets rewrites v26 after it rasterizes the source art. Finalize
   afterwards so every adaptive-icon version uses the same full-bleed gradient
   and only the foreground receives the launcher's safe-zone inset. */
if (androidFinalize) {
  writeAndroidAdaptiveResources();
  return;
}

const browser = await chromium.launch();
try {
  const shot = async (svg, size, transparent = false) => {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
    const buf = await page.screenshot({ omitBackground: transparent });
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
    const targets = android ? ANDROID_TARGETS : TARGETS;
    for (const t of targets) {
      const svg = t.svg ? t.svg(kind) : iconSVG(kind, t.size, t.pad, t.theme, t.transparent);
      const buf = await shot(svg, t.size, t.transparent);
      mkdirSync(dirname(t.file), { recursive: true });
      writeFileSync(t.file, buf);
      console.log(`${t.file}  ${t.size}x${t.size}` +
        `${t.pad ? '  (maskable safe zone)' : ''}${t.theme === 'light' ? '  (light appearance)' : ''}` +
        `${t.transparent ? '  (transparent)' : ''}`);
    }
    if (android) {
      writeAndroidAdaptiveResources();
    }
    console.log(`${android ? 'Android source icon set' : 'icon set'} regenerated from variant "${kind}"`);
  }
} finally { await browser.close(); }
}
