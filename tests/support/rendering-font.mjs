// IS THIS MACHINE RENDERING A FONT A PLAYER ACTUALLY HAS?
//
// The app ships no font files. `src/styles/page.css` names only OS-provided
// faces, so what a pixel suite measures is decided entirely by what the host
// happens to have installed:
//
//   macOS    system-ui  -> the Apple system face. What a player sees.
//   Android  system-ui  -> Roboto. What a player sees.
//   Windows  Segoe UI   -> what a player sees.
//   Linux    system-ui  -> whatever fontconfig ranks FIRST, which is not a
//                          decision anyone made. On a GitHub runner that is
//                          DejaVu Sans; on a bare Playwright image it is
//                          WenQuanYi Zen Hei, a Chinese face.
//
// That last row is why hosted CI spent days red on geometry while every local
// gate was green: the suites were measuring a rendering no player will ever
// see, and reporting its metrics as layout defects. Three commits went into
// chasing it from the wrong end — two of them widened design-card frames to fit
// Linux metrics (`Expand design card frames for Linux`, `Cover Linux design
// font variants`), which bakes a font nobody has into the card declarations.
//
// So a geometry suite should say THAT, once and by name, instead of emitting a
// list of things that are 12px too tall. `system-ui` is legitimate wherever it
// is a real system face; on Linux the only defensible binding is Roboto, which
// the app's own stack names and which is exactly what Android resolves to.
import { readFileSync } from 'node:fs';

/** Read the app's own stack from source, so this guard cannot drift from it. */
export function appFontStack() {
  const css = readFileSync(new URL('../../src/styles/page.css', import.meta.url), 'utf8');
  const declared = css.match(/font-family:\s*([^;}]+)/);
  if (!declared) throw new Error('src/styles/page.css no longer declares a font-family');
  return declared[1].trim();
}

/**
 * Measure the stack and its candidate faces in the page itself. There is no API
 * that reports which family a stack resolved to, so compare metrics: two
 * families that lay out a mixed-script string to the identical fraction of a
 * pixel are the same face.
 */
export async function inspectRenderingFont(page, stack) {
  return page.evaluate((stack) => {
    const probe = document.createElement('span');
    probe.textContent = 'Hamburgefonstiv MENTIONS LÉGALES 0123456789';
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;font-size:100px';
    document.body.append(probe);
    const widthOf = (family) => {
      probe.style.fontFamily = family;
      return Math.round(probe.getBoundingClientRect().width * 1000) / 1000;
    };
    const measured = {
      stack: widthOf(stack),
      roboto: widthOf('Roboto'),
      systemUi: widthOf('system-ui'),
      // A family that cannot exist, to learn this browser's "not found" width.
      absent: widthOf('"__no_such_family_anywhere__"'),
    };
    probe.remove();
    return measured;
  }, stack);
}

/**
 * The reason this rendering is not representative, or null when it is.
 * Platform is a parameter so the rule itself stays testable.
 */
export function unrepresentativeFont(measured, platform = process.platform) {
  // Everywhere else `system-ui` IS the face the platform ships to players.
  if (platform !== 'linux') return null;
  if (measured.roboto === measured.absent) {
    return 'Roboto is not installed, so the app stack fell through to whatever '
      + 'fontconfig ranks first. Install fonts-roboto-unhinted.';
  }
  if (measured.stack !== measured.roboto) {
    return 'Roboto is installed but the app stack does not bind it: `system-ui` '
      + 'comes first in the stack and still wins. Alias the generic families to '
      + 'Roboto (see the font step in .github/workflows/ci.yml).';
  }
  return null;
}

/**
 * One call for a suite: measure, and hand back the detail to publish plus the
 * problem to report. Geometry assertions downstream are only meaningful when
 * `problem` is null.
 */
export async function checkRenderingFont(page) {
  const stack = appFontStack();
  const measured = await inspectRenderingFont(page, stack);
  return { stack, measured, problem: unrepresentativeFont(measured) };
}
