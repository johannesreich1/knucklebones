// The app icon is the SPLIT DIE (design study 56b, chosen 2026-09-02): one
// six-face Home die, its left pip column in one duel hue and its right column
// in the other, cut on a bright seam. dieMarkup supplies the face and the app's
// CSS supplies its glass, border, glow and pips — the halves and the seam are
// the only drawing here. The default pair is fixed cyan-and-magenta and never
// follows the player; profile-app-icons.mjs expands the same renderer across
// every ordered pair of duel hues so a device that opts into its own colours
// gets a pre-bundled launcher. iconSVG() below is still the single Home die:
// the launch screen (splash.mjs) keeps it.
//
//   mise exec -- node tools/appicon.mjs           regenerate the shipped icon set
//   mise exec -- node tools/appicon.mjs --dry     render one preview, write no shipped asset
//   mise exec -- node tools/appicon.mjs --android render @capacitor/assets Android inputs only
//   mise exec -- node tools/appicon.mjs --android-finalize restore adaptive XML after that CLI runs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dieMarkup, diePipCells } from '../src/ui/die-markup.ts';
import { DEFAULT_ICON_PAIR } from '../src/app-icon-registry.ts';
import { inlineCssGraph } from './css-graph.mjs';

export const APP_ICON_PAD = .15;
/* The split die is authored in a 120-unit square with a 96-unit die (the
   card's own proportions), so the launcher's die box is 80% of the canvas. */
export const SPLIT_ICON_PAD = .1;
export const SPLIT_ICON_FACE = 6;
export const MASKABLE_ICON_PAD = .2;
export const APP_ICON_TILT_DEG = 7;
export const ANDROID_ADAPTIVE_INSET = '10%';
export const SYSTEM_DARK_GRADIENT = Object.freeze({ top: '#313131', bottom: '#141414' });
export const SYSTEM_LIGHT_GRADIENT = Object.freeze({ top: '#ffffff', bottom: '#e5e5e5' });
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HOME_DIE_SIZE = 74;
const HOME_DIE_CSS = inlineCssGraph(['src/styles/main.css'], { rootDir: ROOT }).css;
/* the 5 face: four corners and the centre, in a 0..1 square */
const PIPS = [[.26, .26], [.74, .26], [.5, .5], [.26, .74], [.74, .74]];

/* `pad` is the margin around the die as a fraction of the canvas. The shipped
   15% restores the slightly larger launcher mark selected before the compact
   pass; maskable icons get 20% because an unknown launcher shape can crop
   their outer fifth. The shared 7° clockwise tilt keeps the face lively. */
/* iOS Dark keeps the quiet charcoal ground; iOS Light (Any) sits the same dark
   split die on the system light gradient, the way Maps and Photos wear a light
   tile in light mode (owner call, 2026-09-02). Tinted stays a separate
   monochrome source because iOS owns that material and tint. */
const THEME = {
  dark:  {
    canvasTop: SYSTEM_DARK_GRADIENT.top, canvasBottom: SYSTEM_DARK_GRADIENT.bottom,
  },
  light: {
    canvasTop: SYSTEM_LIGHT_GRADIENT.top, canvasBottom: SYSTEM_LIGHT_GRADIENT.bottom,
  },
};
const xmlText = (source) => source.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

export function iconSVG(
  S = 512,
  pad = APP_ICON_PAD,
  theme = 'dark',
  transparent = false,
  face = 5,
  hue = 'cy',
  renderOuterGlow = true,
) {
  const T = THEME[theme] ?? THEME.dark;
  const dieSide = S * (1 - pad * 2);
  const scale = dieSide / HOME_DIE_SIZE;
  const die = dieMarkup(face, {
    classes: 'p1 appicon-die',
    size: HOME_DIE_SIZE,
    inlineStyle: `--p1:var(--${hue});--p1-rgb:var(--${hue}-rgb);` +
      `--p1-hi:var(--${hue}-hi);transform:none!important;` +
      `${renderOuterGlow ? '' : '--duel-die-outer-glow:0 0 0 transparent;'}`,
  });
  const background = transparent ? '' :
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${T.canvasTop}"/>` +
    `<stop offset="1" stop-color="${T.canvasBottom}"/></linearGradient></defs>` +
    `<rect width="${S}" height="${S}" fill="url(#bg)"/>`;
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    background +
    `<foreignObject x="0" y="0" width="${S}" height="${S}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" id="kbroot" style="width:${S}px;height:${S}px">` +
    `<style>${xmlText(HOME_DIE_CSS)}</style>` +
    `<div class="duel appicon-canvas" style="width:${S}px;height:${S}px;margin:0;display:grid;place-items:center;overflow:hidden">` +
    `<div style="width:${HOME_DIE_SIZE}px;height:${HOME_DIE_SIZE}px;line-height:0;transform-origin:50% 50%;` +
    `transform:rotate(${APP_ICON_TILT_DEG}deg) scale(${scale})">${die}</div>` +
    `</div></div></foreignObject></svg>`;
}

/* The split arrangement now lives in the APP, at src/styles/components/
   split-mark.css, and arrives here inside HOME_DIE_CSS like every other rule
   this generator uses. It moved on 2026-09-03 when Home started wearing the
   mark (design 14e / L5): as a string in this file it could only ever be baked
   into an SVG, which is what stopped the hero following a repointed pair.
   The canvas still pins the pair with hueVars below — the DEVICE's icon choice
   is not the page's — and injects --split-tilt so the tilt has one owner. */
export const hueVars = (pair) => ['p1', 'p2'].map((slot, index) => {
  const hue = index === 0 ? pair.p1 : pair.p2;
  return `--${slot}:var(--${hue});--${slot}-rgb:var(--${hue}-rgb);--${slot}-hi:var(--${hue}-hi);`;
}).join('');

export function splitDieIconSVG(
  S = 512,
  pad = SPLIT_ICON_PAD,
  theme = 'dark',
  transparent = false,
  pair = DEFAULT_ICON_PAIR,
) {
  const T = THEME[theme] ?? THEME.dark;
  const box = S * (1 - pad * 2);
  const scale = box / 96;
  const offset = (S - 120 * scale) / 2;
  const die = (owner) => dieMarkup(SPLIT_ICON_FACE, {
    classes: `${owner} appicon-die`,
    size: 96,
    inlineStyle: 'transform:none!important;',
  });
  const light = theme === 'light';
  const wash = light ? .2 : .16;
  const ground = transparent ? 'transparent' :
    `radial-gradient(54% 60% at 14% 72%,rgba(var(--p1-rgb),${wash}),transparent 70%),` +
    `radial-gradient(54% 60% at 86% 28%,rgba(var(--p2-rgb),${wash}),transparent 70%),` +
    `linear-gradient(${T.canvasTop},${T.canvasBottom})`;
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<foreignObject x="0" y="0" width="${S}" height="${S}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" id="kbroot" style="width:${S}px;height:${S}px">` +
    `<style>${xmlText(HOME_DIE_CSS)}</style>` +
    `<div class="appicon-canvas${light ? ' light' : ''}" style="${hueVars(pair)}--split-tilt:${APP_ICON_TILT_DEG}deg;width:${S}px;height:${S}px;position:relative;overflow:hidden;background:${ground}">` +
    `<div class="split" style="transform:translate(${offset}px,${offset}px) scale(${scale})">` +
    `<i class="plate"></i>` +
    `<i class="half left">${die('p1')}</i>` +
    `<i class="half right">${die('p2')}</i>` +
    `<i class="seam"></i>` +
    `</div></div></div></foreignObject></svg>`;
}

/* Adaptive foregrounds must carry alpha: Android supplies and independently
   masks the background layer. Keep the mark otherwise identical to the
   shipped icon so the adaptive, round and legacy launchers remain one design. */
export function adaptiveForegroundSVG(S = 1024, pair = DEFAULT_ICON_PAIR) {
  return splitDieIconSVG(S, SPLIT_ICON_PAD, 'dark', true, pair);
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
   the generated adaptive foreground; iOS Tinted reads the same drawing.
   The OS applies its own tint, so hue and glow disappear — which is why the
   split's SEAM is cut into the mask like the pips: without it a tinted icon
   would be an unmarked die. The mask shares the split die's geometry (the
   card's 14-of-96 corner and 78%-of-cell pips) and is pair-independent, so
   one drawing serves every launcher variant. */
export function monochromeIconSVG(S = 1024, pad = SPLIT_ICON_PAD, face = SPLIT_ICON_FACE, seam = true) {
  const m = S * pad, box = S - m * 2, r = box * (14 / 96), pr = box * .09;
  const positions = [.26, .5, .74];
  const holes = diePipCells(face).map((cell) => {
    const x = positions[cell % 3];
    const y = positions[Math.floor(cell / 3)];
    return `<circle cx="${(m + x * box).toFixed(2)}" cy="${(m + y * box).toFixed(2)}" ` +
      `r="${pr.toFixed(2)}" fill="#000"/>`;
  }).join('');
  /* the seam: a hair over 2% of the die, but never under 1.5px, so ldpi keeps it */
  const seamWidth = Math.max(box * .021, 1.5);
  const cut = seam
    ? `<rect x="${(S / 2 - seamWidth / 2).toFixed(2)}" y="${m.toFixed(2)}" width="${seamWidth.toFixed(2)}"` +
      ` height="${box.toFixed(2)}" fill="#000"/>`
    : '';
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><mask id="die"><rect width="${S}" height="${S}" fill="#000"/>` +
    `<rect x="${m.toFixed(2)}" y="${m.toFixed(2)}" width="${box.toFixed(2)}" height="${box.toFixed(2)}"` +
    ` rx="${r.toFixed(2)}" fill="#fff"/>${holes}${cut}</mask></defs>` +
    `<g transform="rotate(${APP_ICON_TILT_DEG} ${S / 2} ${S / 2})">` +
    `<rect width="${S}" height="${S}" fill="#fff" mask="url(#die)"/></g></svg>`;
}

/* Every target that has to carry the icon. iOS reads the asset catalogue, the
   manifest reads public/, and build.mjs copies public/ into every web target —
   so this list is the whole story. */
const TARGETS = [
  { file: 'public/icon-180.png', size: 180 },
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  { file: 'public/icon-maskable-512.png', size: 512, pad: MASKABLE_ICON_PAD },
  /* an unknown launcher shape crops the outer fifth; the seam and the pip
     columns stay inside it at the maskable pad */
  /* Any/Light wears the system light ground, Dark the charcoal one; the die,
     its tilt and its pips are the same drawing on both. Tinted remains an
     authored grayscale source for iOS-owned appearances. */
  { file: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', size: 1024, theme: 'light' },
  { file: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-Dark-512@2x.png', size: 1024, theme: 'dark' },
  {
    file: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-Tinted-512@2x.png',
    size: 1024,
    transparent: true,
    svg: () => monochromeIconSVG(1024),
  },
];

/* The Assets CLI turns the four custom-mode inputs into legacy, round, and
   adaptive launchers. Capacitor Assets 3.0.5 ignores icon-monochrome, so this
   generator also writes its density-specific tracked resources directly; the
   v33 adaptive-icon XML wires that layer into themed launchers. */
const ANDROID_TARGETS = [
  { file: 'native/assets/icon-only.png', size: 1024, svg: () => splitDieIconSVG(1024) },
  { file: 'native/assets/icon-foreground.png', size: 1024, transparent: true, svg: () => adaptiveForegroundSVG(1024) },
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
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="${ANDROID_ADAPTIVE_INSET}" />
    </foreground>
${themed ? `    <monochrome>
        <inset android:drawable="@mipmap/ic_launcher_monochrome" android:inset="${ANDROID_ADAPTIVE_INSET}" />
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
const dry = args.includes('--dry');
const android = args.includes('--android');
const androidFinalize = args.includes('--android-finalize');

/* Capacitor Assets rewrites v26 after it rasterizes the source art. Finalize
   afterwards so every adaptive-icon version uses the same full-bleed gradient
   and only the foreground receives the launcher's safe-zone inset. */
if (androidFinalize) {
  writeAndroidAdaptiveResources();
  const { finalizeAndroidPairIcons } = await import('./profile-app-icons.mjs');
  finalizeAndroidPairIcons({
    appIconPad: APP_ICON_PAD,
    appIconTiltDeg: APP_ICON_TILT_DEG,
    adaptiveInset: ANDROID_ADAPTIVE_INSET,
    darkGradient: SYSTEM_DARK_GRADIENT,
  });
  return;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  const shot = async (svg, size, transparent = false) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
    const buf = await page.screenshot({ omitBackground: transparent });
    return buf;
  };
  if (dry) {
    const buf = await shot(splitDieIconSVG(1024), 1024);
    writeFileSync('icon-preview.png', buf);
    console.log('wrote icon-preview.png — no shipped asset touched');
  } else {
    const targets = android ? ANDROID_TARGETS : TARGETS;
    for (const t of targets) {
      const buf = t.copyFrom ? readFileSync(t.copyFrom) : await shot(
        t.svg ? t.svg()
          : splitDieIconSVG(t.size, t.pad ?? SPLIT_ICON_PAD, t.theme, t.transparent),
        t.size,
        t.transparent,
      );
      mkdirSync(dirname(t.file), { recursive: true });
      writeFileSync(t.file, buf);
      console.log(`${t.file}  ${t.size}x${t.size}` +
        `${t.pad ? '  (maskable safe zone)' : ''}${t.theme === 'light' ? '  (light appearance)' : ''}` +
        `${t.theme === 'dark' ? '  (dark appearance)' : ''}` +
        `${t.transparent ? '  (transparent)' : ''}`);
    }
    if (android) {
      writeAndroidAdaptiveResources();
    }
    const pairIcons = await import('./profile-app-icons.mjs');
    const shared = {
      shot,
      splitDieIconSVG,
      adaptiveForegroundSVG,
      monochromeIconSVG,
      appIconPad: SPLIT_ICON_PAD,
      appIconTiltDeg: APP_ICON_TILT_DEG,
      adaptiveInset: ANDROID_ADAPTIVE_INSET,
      darkGradient: SYSTEM_DARK_GRADIENT,
    };
    if (android) await pairIcons.generateAndroidPairIcons(shared);
    else await pairIcons.generateIosPairIcons(shared);
    await page.close();
    console.log(`${android ? 'Android source icon set' : 'icon set'} regenerated from the split die`);
  }
} finally { await browser.close(); }
}
