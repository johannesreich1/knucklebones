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
  iconSVG,
} from './appicon.mjs';

const BG = '#05060e';
const GLOW = '#28e8ff';
const SIZE = 2732;
export const SPLASH_ICON_SCALE = .24;
/* The launcher's icon composition is 24% of the splash. Its restored 70% die
   is therefore about 16.8% before rotation:
   clearly larger than on the launcher, while still reading as a mark rather
   than a poster. Render that same geometry directly on the full splash canvas:
   the old nested 512px icon canvas clipped the 34px Home glow into a visible
   square when it was enlarged. The full canvas gives every shadow room to
   decay naturally while keeping the die itself exactly the same size. */
export function splashSVG(S = SIZE) {
  const dieScale = SPLASH_ICON_SCALE * (1 - APP_ICON_PAD * 2);
  const fullCanvasPad = (1 - dieScale) / 2;
  /* Only the shared die mark is embedded. Its transparent full-size canvas
     lets #05060e continue around the glass while leaving the glow unclipped. */
  const mark = iconSVG(S, fullCanvasPad, 'dark', true, 5, 'cy', false);
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><radialGradient id="launchGlow" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0" stop-color="${GLOW}" stop-opacity=".10"/>` +
    `<stop offset=".32" stop-color="${GLOW}" stop-opacity=".075"/>` +
    `<stop offset=".72" stop-color="${GLOW}" stop-opacity=".025"/>` +
    `<stop offset="1" stop-color="${GLOW}" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<rect width="${S}" height="${S}" fill="${BG}"/>` +
    `<rect width="${S}" height="${S}" fill="url(#launchGlow)"/>${mark}</svg>`;
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
      console.log(`${android ? 'Android source splash set' : 'splash'} regenerated from the Home neon die`);
    }
  } finally { await browser.close(); }
}
