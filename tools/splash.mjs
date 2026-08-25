// The iOS launch screen, generated from the SAME vector as the app icon —
// tools/appicon.mjs's iconSVG — so the two can never drift apart.
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
import { iconSVG } from './appicon.mjs';

const BG = '#05060e';
const SIZE = 2732;
/* The die is ~17% of the canvas: after aspect-fill on a phone that lands
   around 140pt — a mark, not a poster. Rendered at its own 512 canvas and
   embedded, so the icon's glow blur stays in proportion to the die instead
   of scaling with the whole splash. */
const DIE = Math.round(SIZE * 0.17);

export function splashSVG(S = SIZE) {
  const die = Math.round(S * 0.17);
  const off = Math.round((S - die) / 2);
  /* the icon carries its own #05060e canvas — same ground, seamless */
  const mark = iconSVG('c', 512, 0.085, 'dark')
    .replace('<svg ', `<svg x="${off}" y="${off}" `)
    .replace(`width="512" height="512"`, `width="${die}" height="${die}"`);
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${S}" height="${S}" fill="${BG}"/>${mark}</svg>`;
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
      console.log(`${android ? 'Android source splash set' : 'splash'} regenerated from the app icon vector`);
    }
  } finally { await browser.close(); }
}
