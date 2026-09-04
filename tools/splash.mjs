// The iOS launch screen is generated from the SAME Home neon-die component as
// the app icon. tools/appicon.mjs wraps the real markup and CSS for raster
// export, so launcher and loading artwork cannot drift apart.
//
//   mise exec -- node tools/splash.mjs            regenerate native/ios Splash.imageset
//   mise exec -- node tools/splash.mjs --dry      render splash-preview.png, write nothing
//   mise exec -- node tools/splash.mjs --android  render @capacitor/assets Android inputs only
//
// An iOS launch screen is static by platform law: the storyboard renders
// before a single line of the app runs, so no animation is possible here.
// Apple's guidance (and ours) is therefore "the app's first frame": the die
// mark, small and centred on the game's own night, no text — text reads as
// slow and would need localising. The moment the webview boots on the same
// #05060e (capacitor.config ios.backgroundColor), the boot loader draws its
// die where this one stands: the launch die WAKES UP, it never blinks away.
//
// The imageset stays one 2732×2732 square per scale, centred full-bleed by
// the storyboard's scaleAspectFill: a uniform ground crops safely on every
// device, which is why the mark must keep to the middle of the canvas.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  APP_ICON_PAD,
  hueVars,
  splitDieIconSVG,
} from './appicon.mjs';
import { DEFAULT_ICON_PAIR, SPLASH_MARK_FRACTION } from '../src/app-icon-registry.ts';
import { inlineCssGraph } from './css-graph.mjs';

const HERE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(HERE_DIR, '..');
/* The ground is the app's OWN page background, not a copy of it: --aurora is
   read out of src/styles the same way tools/appicon.mjs reads the die's CSS,
   so the launch frame and the first screen the webview paints cannot drift. */
/* The @font-face blocks come out. The mark is dice — no glyph, no text node —
   so the faces are dead weight here, and their url()s are RELATIVE to
   src/styles/foundations/, which resolves to nothing at all inside an SVG that
   is about to be inlined as a data URI. Twelve dead references travelled into
   every one of the 41 alternate icon catalogs before this line existed. */
const APP_CSS = inlineCssGraph(['src/styles/main.css'], { rootDir: ROOT_DIR }).css
  .replace(/@font-face\s*\{[^}]*\}/gs, "");
const PAGE_GROUND = '#04050c';
const BG = '#05060e';
/* THE LAUNCH FRAME IS GREYSCALE, AND THAT IS THE WHOLE POINT.
   The launcher tile comes in 42 ordered hue pairs; the launch screen cannot.
   iOS names one image in Info.plist and compiles it in — there is no
   CFBundleAlternateLaunchImages to match CFBundleAlternateIcons, and Android's
   cold-start window is fixed the same way. Shipping 42 renditions would add
   ~860MB and the OS would still only ever show one of them.
   So the frame claims no hue at all: desaturated, at reduced opacity, over the
   app's own page ground. A player on violet-and-green is not contradicted by
   it, because it says nothing about colour — and the colour arrives a moment
   later, when the webview paints their actual pair. One image, 42 players. */
const MARK_OPACITY = .62;
const SIZE = 2732;
export const SPLASH_ICON_SCALE = .24;
/* The launcher's icon composition is 24% of the splash. Its restored 70% die
   is therefore about 16.8% before rotation:
   clearly larger than on the launcher, while still reading as a mark rather
   than a poster. Render that same geometry directly on the full splash canvas:
   the old nested 512px icon canvas clipped the 34px Home glow into a visible
   square when it was enlarged. The full canvas gives every shadow room to
   decay naturally while keeping the die itself exactly the same size.

   THE MARK IS THE SPLIT DIE, not the single cyan five it was until 2026-09-03.
   Boot used to show two different marks half a second apart — the launcher tile
   the player tapped is the split die, the storyboard drew a cyan five, and Home
   drew a third thing — so the one moment the app has to say "this is the same
   app" said the opposite. One object now runs tile -> storyboard -> hero.

   THE PAD IS UNCHANGED, and that is not an oversight. splitDieIconSVG lays a
   96-unit die inside a 120-unit canvas and sizes that canvas so the DIE fills
   the box the pad leaves — the extra 25% is transparent margin around it, not
   part of the mark. So (1 - dieScale) / 2 puts the same ink on the screen as
   iconSVG did, and the die's footprint is untouched across the change of mark.
   Dividing by 96/120 here was the first attempt and it was wrong: it grew the
   die to 22.7% of the canvas, which tests/support/ios-shell-contract.ts caught
   twice over — once on size, and again because the oversized die reached into
   the bands that scan the clear air for a clipped glow. */
/* foreignObject content is XML: an unescaped & or < in the stylesheet ends the
   document. Same guard tools/appicon.mjs uses on the same CSS. */
const xmlText = (value) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function splashSVG(S = SIZE, pair = DEFAULT_ICON_PAIR) {
  const dieScale = SPLASH_MARK_FRACTION;
  const fullCanvasPad = (1 - dieScale) / 2;
  /* Only the shared die mark is embedded. Its transparent full-size canvas
     lets the ground continue around the glass while leaving the glow unclipped. */
  const mark = splitDieIconSVG(S, fullCanvasPad, 'dark', true, pair);
  /* The pair still reaches the mark and the ground, and then saturate=0 takes
     it straight back out. That is deliberate rather than wasteful: the geometry
     and the light stay the shipped generator's, so a change to either follows
     here, and only the hue is dropped. Rendering a hand-built grey die instead
     would be a second mark, free to drift from the one on the tile. */
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><filter id="launchMono" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="saturate" values="0"/></filter></defs>` +
    `<rect width="${S}" height="${S}" fill="${PAGE_GROUND}"/>` +
    `<g filter="url(#launchMono)">` +
    `<foreignObject x="0" y="0" width="${S}" height="${S}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" id="kbroot" style="width:${S}px;height:${S}px">` +
    `<style>${xmlText(APP_CSS)}</style>` +
    `<div style="${hueVars(pair)}width:${S}px;height:${S}px;` +
    `background:var(--aurora);background-color:${PAGE_GROUND}"></div>` +
    `</div></foreignObject>` +
    `<g opacity="${MARK_OPACITY}">${mark}</g>` +
    `</g></svg>`;
}

const SET = 'native/ios/App/App/Assets.xcassets/Splash.imageset';
const TARGETS = [`${SET}/splash-2732x2732-2.png`, `${SET}/splash-2732x2732-1.png`, `${SET}/splash-2732x2732.png`];
/* The shell is deliberately dark in both system appearances, so the two
   custom-mode sources are byte-identical. Naming both lets Capacitor Assets
   populate its normal and night resource buckets without recolouring either. */
const ANDROID_TARGETS = ['native/assets/splash.png', 'native/assets/splash-dark.png'];

const RUN_AS_SCRIPT = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (RUN_AS_SCRIPT) {
  const dry = process.argv.includes('--dry');
  const android = process.argv.includes('--android');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    await page.setContent(`<body style="margin:0">${splashSVG()}</body>`);
    const buf = await page.screenshot();
    await page.close();
    if (dry) {
      writeFileSync('splash-preview.png', buf);
      console.log('wrote splash-preview.png — nothing else touched');
    } else {
      const targets = android ? ANDROID_TARGETS : TARGETS;
      for (const f of targets) {
        mkdirSync(dirname(f), { recursive: true });
        writeFileSync(f, buf);
        console.log(`${f}  ${SIZE}x${SIZE}`);
      }
      console.log(`${android ? 'Android source splash set' : 'splash'} regenerated from the launcher's split die`);
    }
  } finally { await browser.close(); }
}
