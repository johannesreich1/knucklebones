// The app icon is the Home screen's actual neon die, not a hand-drawn cousin:
// dieMarkup supplies the face and the app's CSS supplies its glass, chosen hue,
// border, glow and pips. profile-app-icons.mjs expands this renderer across the
// complete profile registry so the 42 native launcher identities cannot drift.
//
//   mise exec -- node tools/appicon.mjs           regenerate the shipped icon set
//   mise exec -- node tools/appicon.mjs --dry     render one preview, write no shipped asset
//   mise exec -- node tools/appicon.mjs --android render @capacitor/assets Android inputs only
//   mise exec -- node tools/appicon.mjs --android-finalize restore adaptive XML after that CLI runs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dieMarkup, diePipCells } from '../src/ui/die-markup.ts';
import { inlineCssGraph } from './css-graph.mjs';

export const APP_ICON_PAD = .15;
export const MASKABLE_ICON_PAD = .2;
export const APP_ICON_TILT_DEG = 7;
export const ANDROID_ADAPTIVE_INSET = '10%';
export const SYSTEM_DARK_GRADIENT = Object.freeze({ top: '#313131', bottom: '#141414' });
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HOME_DIE_SIZE = 74;
const HOME_DIE_CSS = inlineCssGraph(['src/styles/main.css'], { rootDir: ROOT }).css;

/* `pad` is the margin around the die as a fraction of the canvas. The shipped
   15% restores the slightly larger launcher mark selected before the compact
   pass; maskable icons get 20% because an unknown launcher shape can crop
   their outer fifth. The shared 7° clockwise tilt keeps the face lively. */
/* iOS supplies its exact System Dark gradient behind the transparent Dark
   rendition. The opaque Any/Light fallback and platforms without an
   appearance-aware ground use the same quiet charcoal direction; this keeps
   the requested dark identity stable instead of washing the glass out. */
const THEME = {
  dark:  {
    canvasTop: SYSTEM_DARK_GRADIENT.top, canvasBottom: SYSTEM_DARK_GRADIENT.bottom,
  },
  light: {
    canvasTop: SYSTEM_DARK_GRADIENT.top, canvasBottom: SYSTEM_DARK_GRADIENT.bottom,
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

/* Adaptive foregrounds must carry alpha: Android supplies and independently
   masks the background layer. Keep the mark otherwise identical to the
   shipped icon so the adaptive, round and legacy launchers remain one design. */
export function adaptiveForegroundSVG(S = 1024, face = 5, hue = 'cy') {
  return iconSVG(S, APP_ICON_PAD, 'dark', true, face, hue);
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
export function monochromeIconSVG(S = 1024, pad = APP_ICON_PAD, face = 5) {
  const m = S * pad, box = S - m * 2, r = box * .235, pr = box * .092;
  const positions = [.26, .5, .74];
  const holes = diePipCells(face).map((cell) => {
    const x = positions[cell % 3];
    const y = positions[Math.floor(cell / 3)];
    return `<circle cx="${(m + x * box).toFixed(2)}" cy="${(m + y * box).toFixed(2)}" ` +
      `r="${pr.toFixed(2)}" fill="#000"/>`;
  }).join('');
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><mask id="die"><rect width="${S}" height="${S}" fill="#000"/>` +
    `<rect x="${m.toFixed(2)}" y="${m.toFixed(2)}" width="${box.toFixed(2)}" height="${box.toFixed(2)}"` +
    ` rx="${r.toFixed(2)}" fill="#fff"/>${holes}</mask></defs>` +
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
  /* Any/Light deliberately keeps the requested dark system-style ground;
     Dark supplies the crisp transparent mark Apple asks for; Tinted supplies
     an authored grayscale face so Clear/Tinted need not derive from neon RGB.
     The primary trio remains die:5:cy and alternates mirror it mechanically. */
  { file: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', size: 1024, theme: 'light' },
  { file: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-Dark-512@2x.png', size: 1024, theme: 'dark', transparent: true, renderOuterGlow: false },
  {
    file: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-Tinted-512@2x.png',
    size: 1024,
    transparent: true,
    svg: () => monochromeIconSVG(1024, APP_ICON_PAD, 5),
  },
];

/* The Assets CLI turns the four custom-mode inputs into legacy, round, and
   adaptive launchers. Capacitor Assets 3.0.5 ignores icon-monochrome, so this
   generator also writes its density-specific tracked resources directly; the
   v33 adaptive-icon XML wires that layer into themed launchers. */
const ANDROID_TARGETS = [
  { file: 'native/assets/icon-only.png', size: 1024, svg: () => iconSVG(1024) },
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
  const { finalizeAndroidProfileIcons } = await import('./profile-app-icons.mjs');
  finalizeAndroidProfileIcons({
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
    const buf = await shot(iconSVG(1024), 1024);
    writeFileSync('icon-preview.png', buf);
    console.log('wrote icon-preview.png — no shipped asset touched');
  } else {
    const targets = android ? ANDROID_TARGETS : TARGETS;
    for (const t of targets) {
      const svg = t.svg ? t.svg()
        : iconSVG(t.size, t.pad, t.theme, t.transparent, 5, 'cy', t.renderOuterGlow);
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
    const profileIcons = await import('./profile-app-icons.mjs');
    const shared = {
      shot,
      iconSVG,
      adaptiveForegroundSVG,
      monochromeIconSVG,
      appIconPad: APP_ICON_PAD,
      appIconTiltDeg: APP_ICON_TILT_DEG,
      adaptiveInset: ANDROID_ADAPTIVE_INSET,
      darkGradient: SYSTEM_DARK_GRADIENT,
    };
    if (android) await profileIcons.generateAndroidProfileIcons(shared);
    else await profileIcons.generateIosProfileIcons(shared);
    await page.close();
    console.log(`${android ? 'Android source icon set' : 'icon set'} regenerated from the Home neon die`);
  }
} finally { await browser.close(); }
}
