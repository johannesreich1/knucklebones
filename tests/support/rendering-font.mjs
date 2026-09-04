// IS THIS PAGE RENDERING THE FACE THE APP SHIPS?
//
// It used to have to ask a weaker question. The app shipped no font file:
// `src/styles/page.css` named OS-provided faces, so what a pixel suite measured
// was decided entirely by what the host happened to have installed —
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
// THE APP NOW BUNDLES ITS OWN FACE, so the question gets to be the real one:
// did that face load and bind, here, on this page? That is answerable on every
// platform, and it is strictly stronger than the old guard — a broken asset
// pipeline, a stale data URI or a typo in the family name now fails on macOS
// too, where the old check returned null and looked away.
//
// The Linux/Roboto rule survives in a reduced form, because the fallback tail
// still matters: `ja` and `ko` have no bundled coverage and fall through to the
// OS, and design/build.mjs's springboard mock deliberately renders `system-ui`.
import { readFileSync } from 'node:fs';

const TYPEFACE = new URL('../../src/styles/foundations/typeface.css', import.meta.url);
const PAGE = new URL('../../src/styles/page.css', import.meta.url);

/**
 * What the app actually ships: the family name and every weight it has a face
 * for. Read from the stylesheet that declares them, so this guard cannot drift
 * from the bundle — adding a weight without a file, or a file without a face,
 * is exactly the kind of thing it exists to catch.
 */
export function shippedTypeface() {
  let css;
  try {
    css = readFileSync(TYPEFACE, 'utf8');
  } catch {
    throw new Error('src/styles/foundations/typeface.css is missing: the app is '
      + 'expected to bundle its own face, and nothing declares one');
  }
  const families = [...css.matchAll(/@font-face\s*\{[^}]*?font-family:\s*(['"])(.+?)\1/gs)]
    .map((m) => m[2]);
  const family = families[0];
  if (!family) throw new Error('typeface.css declares no @font-face family');
  if (families.some((f) => f !== family)) {
    throw new Error(`typeface.css declares more than one family: ${[...new Set(families)].join(', ')}`);
  }
  const weights = [...new Set([...css.matchAll(/@font-face\s*\{[^}]*?font-weight:\s*(\d+)/gs)]
    .map((m) => Number(m[1])))].sort((a, b) => a - b);
  if (!weights.length) throw new Error('typeface.css declares no @font-face weights');
  return { family, weights };
}

/**
 * The app's own stack, read from source so this guard cannot drift from it.
 *
 * @font-face blocks are skipped deliberately. Their `font-family` is a
 * DESCRIPTOR — the name being defined — not a stack, and a naive "first
 * font-family in the file" read would return it and quietly measure one family
 * instead of the cascade. That is why the faces live in typeface.css and not
 * here, and this skip is the belt to that suspenders.
 */
export function appFontStack() {
  const css = readFileSync(PAGE, 'utf8').replace(/@font-face\s*\{[^}]*\}/gs, '');
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
export async function inspectRenderingFont(page, stack, face) {
  return page.evaluate(async ({ stack, face }) => {
    /* ask for every shipped weight before measuring: `check()` answers "can I
       use this right now", which is false for a declared-but-unloaded face, and
       a data-URI face on a design card is not loaded until something wants it */
    const loaded = {};
    for (const weight of face.weights) {
      const spec = `${weight} 100px "${face.family}"`;
      try { await document.fonts.load(spec, 'Hamburgefonstiv 0123456789'); } catch { /* reported below */ }
      loaded[weight] = document.fonts.check(spec);
    }
    await document.fonts.ready;
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
      shipped: widthOf(`"${face.family}"`),
      roboto: widthOf('Roboto'),
      systemUi: widthOf('system-ui'),
      // A family that cannot exist, to learn this browser's "not found" width.
      absent: widthOf('"__no_such_family_anywhere__"'),
      loaded,
    };
    probe.remove();
    return measured;
  }, { stack, face });
}

/**
 * The reason this rendering is not representative, or null when it is.
 * Platform is a parameter so the rule itself stays testable.
 */
export function unrepresentativeFont(measured, face, platform = process.platform) {
  const missing = face.weights.filter((w) => !measured.loaded[w]);
  if (missing.length) {
    return `the bundled face did not load: "${face.family}" is unavailable at `
      + `weight ${missing.join(', ')}. Check the @font-face src in `
      + 'src/styles/foundations/typeface.css and that the build inlined it.';
  }
  if (measured.shipped === measured.absent) {
    return `"${face.family}" measures the same as a family that does not exist, `
      + 'so nothing bound it — the page is rendering a fallback.';
  }
  if (measured.stack !== measured.shipped) {
    return `the app's stack does not resolve to "${face.family}": the stack `
      + `measures ${measured.stack}px where the face measures ${measured.shipped}px. `
      + 'Something earlier in the stack is winning, or the family name differs '
      + 'between page.css and typeface.css.';
  }
  // Everywhere but Linux the FALLBACK tail is a face the platform ships too.
  if (platform !== 'linux') return null;
  if (measured.roboto === measured.absent) {
    return 'the bundled face binds, but Roboto is not installed, so anything '
      + 'the bundle does not cover (ja/ko, and design/build.mjs\'s springboard '
      + 'mock) falls to whatever fontconfig ranks first. Install '
      + 'fonts-roboto-unhinted.';
  }
  return null;
}

/**
 * One call for a suite: measure, and hand back the detail to publish plus the
 * problem to report. Geometry assertions downstream are only meaningful when
 * `problem` is null.
 */
export async function checkRenderingFont(page) {
  let face;
  try {
    face = shippedTypeface();
  } catch (error) {
    return { stack: null, face: null, measured: null, problem: error.message };
  }
  const stack = appFontStack();
  const measured = await inspectRenderingFont(page, stack, face);
  return { stack, face, measured, problem: unrepresentativeFont(measured, face) };
}
