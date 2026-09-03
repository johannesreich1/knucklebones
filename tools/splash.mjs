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
  splitDieIconSVG,
} from './appicon.mjs';

const BG = '#05060e';
/* The launch wash follows the MARK. While the splash was a single cyan five a
   single cyan halo was the only honest light; the split die has two owners, so
   a cyan-only wash lights one of them and leaves the other sitting in someone
   else's glow. Two offset radials instead, each at half the old strength, so
   the total light on the ground is unchanged and its two halves agree with the
   die standing in front of them. Values are tokens.css --cy / --mg. */
const GLOW_P1 = '#28e8ff';
const GLOW_P2 = '#ff2fa0';
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
export function splashSVG(S = SIZE) {
  const dieScale = SPLASH_ICON_SCALE * (1 - APP_ICON_PAD * 2);
  const fullCanvasPad = (1 - dieScale) / 2;
  /* Only the shared die mark is embedded. Its transparent full-size canvas
     lets #05060e continue around the glass while leaving the glow unclipped. */
  const mark = splitDieIconSVG(S, fullCanvasPad, 'dark', true);
  /* Each half of the wash leans under its own half of the die and carries half
     the old opacity, so cyan + magenta together land on the ground at the one
     intensity that was tuned here. The lean is only 3% either side of centre
     and r is 54%, both for the same reason: two overlapping low-alpha gradients
     quantise to 8 bits, and a wider, barely-offset pair keeps every
     adjacent-pixel step under the 4/255 that ios-shell-contract reads as a
     clipped glow. At 43/57 with r 50% the right and bottom bands stepped 4.7. */
  const wash = (id, colour, cx) =>
    `<radialGradient id="${id}" cx="${cx}%" cy="50%" r="54%">` +
    `<stop offset="0" stop-color="${colour}" stop-opacity=".050"/>` +
    `<stop offset=".32" stop-color="${colour}" stop-opacity=".0375"/>` +
    `<stop offset=".72" stop-color="${colour}" stop-opacity=".0125"/>` +
    `<stop offset="1" stop-color="${colour}" stop-opacity="0"/>` +
    `</radialGradient>`;
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>${wash('launchGlowP1', GLOW_P1, 47)}${wash('launchGlowP2', GLOW_P2, 53)}</defs>` +
    `<rect width="${S}" height="${S}" fill="${BG}"/>` +
    `<rect width="${S}" height="${S}" fill="url(#launchGlowP1)"/>` +
    `<rect width="${S}" height="${S}" fill="url(#launchGlowP2)"/>${mark}</svg>`;
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
