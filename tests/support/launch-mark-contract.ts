/* THE LAUNCH MARK, read back off the rendered pixels.
 *
 * This is the artwork tools/splash.mjs generates and both native shells show
 * before a line of the app runs. It used to be asserted twice — once inside
 * ios-shell-contract.ts and again inside android-resource-contract.ts — with
 * five hardcoded pip coordinates each. That was two copies of one argument in
 * two files, and both failed for the same reason the day the mark changed.
 *
 * WHAT THIS FILE GUARDS is the one property that makes a single launch image
 * correct for every player: IT CLAIMS NO HUE. The launcher tile ships in 42
 * ordered pairs; the launch screen cannot, because iOS names one image in
 * Info.plist and compiles it in — there is no alternate-launch-image API to
 * match CFBundleAlternateIcons, and Android's cold-start window is fixed the
 * same way. A coloured launch frame therefore contradicts every player who
 * chose anything but the default: violet-and-green tile, cyan-and-magenta
 * launch, violet-and-green app. Desaturating it removes the contradiction
 * instead of pretending it away, and the colour arrives a moment later when
 * the webview paints the player's own pair.
 *
 * So: neutral, dark, and legible. If someone re-colours this artwork, the
 * neutrality assertions fail and this comment is why.
 *
 * What stays with each platform is what is genuinely platform-shaped: iOS
 * scans bands of clear air for a clipped glow, Android compares its 26
 * renditions and its normal/night pair. Those are not this file's business.
 */
import type { DecodedPng, RgbaPixel } from './png-pixels.ts';
import { colorSpread, pixelAt } from './png-pixels.ts';

/** Rec.601 luma. The mark is separated from its ground by lightness alone now,
 *  so colorBounds — which finds ink by CHANNEL SPREAD — is blind here and
 *  returns null on a grey image. That is the point, not a defect. */
const luma = (pixel: RgbaPixel): number =>
  (pixel.red * 299 + pixel.green * 587 + pixel.blue * 114) / 1000;

/** A launch frame that claims a hue is the failure this file exists to catch.
 *  Generated output measures 0.0 spread; 6 leaves room for PNG resampling on
 *  the smaller Android renditions without admitting a real tint. */
const NEUTRAL_SPREAD = 6;

export interface LaunchMarkGeometry {
  /** Names the platform in every failure line. */
  readonly platform: string;
  /** How wide the mark's ink may be, and what it is measured against: iOS
   *  divides by the canvas width (square), Android by its source height. */
  readonly inkSpan: {
    readonly min: number;
    readonly max: number;
    readonly by: 'width' | 'height';
    readonly label: string;
  };
  /** Points inside the die that must be lit and colourless. */
  readonly markSamples: readonly (readonly [number, number])[];
  /** Ceiling for the ground's luma at the corners: the frame is the app's
   *  night, and the webview boots onto the same darkness. */
  readonly groundCeiling: number;
}

export function verifyLaunchMarkContract(
  pixels: DecodedPng,
  geometry: LaunchMarkGeometry,
  check: (condition: boolean, message: string) => void,
): void {
  const { platform } = geometry;

  /* THE GROUND. Dark, and colourless like everything else here. The corners are
     not identical — the frame wears the app's own --aurora, which seats a glow
     just outside two OPPOSITE corners — so this bounds them rather than
     equating them, and it reads ALL FOUR. It read only the two on the left
     until 2026-09-04, which left the brightest corner of the image, the
     bottom-right one the aurora actually lights, unmeasured by both checks
     below. The ceiling is therefore a bound on the ground's brightest point
     rather than on a typical one: it moved 24 -> 30 when the sample widened to
     include that corner, which reads 26 under the approved aurora. That is the
     scope of the check changing, not a budget being relaxed to fit a render —
     the mark itself lands at 160, so the ground still has an order of magnitude
     of room before this could stop meaning "the app's night". */
  const corners = [
    pixelAt(pixels, .04, .04), pixelAt(pixels, .96, .04),
    pixelAt(pixels, .04, .96), pixelAt(pixels, .96, .96),
  ];
  check(corners.every((corner) => luma(corner) <= geometry.groundCeiling),
    `the ${platform} loading screen must keep the app's night behind the mark, found `
    + `${corners.map((corner) => luma(corner).toFixed(1)).join(' / ')}`);
  check(corners.every((corner) => colorSpread(corner) <= NEUTRAL_SPREAD),
    `the ${platform} loading screen's ground must claim no duel hue`);

  /* THE INK, measured by lightness against that ground — and the ground is
     measured at its BRIGHTEST corner, not at an arbitrary one. The frame is the
     app's own page background, whose aurora seats a glow just outside two
     OPPOSITE corners: the four read 17 / 8 / 8 / 28 at the time of writing, so
     picking corners[0] compares the lit corner against the unlit one and calls
     the ground's own glow "ink". That reported the mark as 59% of the frame
     instead of 18%, and it only started once --aurora was lifted .12 -> .15 and
     the gap crossed this threshold — a real launch image, a real budget, and a
     measurement taken against the wrong reference.
     THE BUDGET IS NOT THE THING TO MOVE HERE. Against the brightest corner the
     same frame measures 0.1812 against a declared 18.2%, which is the number
     the generator intends; widening the range to admit 0.59 would have made
     any mark, at any size, pass. */
  const groundLuma = Math.max(...corners.map(luma));
  let left = pixels.width;
  let right = -1;
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      if (luma(pixels.pixel(x, y)) - groundLuma < 12) continue;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  const divisor = geometry.inkSpan.by === 'width' ? pixels.width : pixels.height;
  const inkWidth = right < 0 ? 0 : (right - left + 1) / divisor;
  check(inkWidth >= geometry.inkSpan.min && inkWidth <= geometry.inkSpan.max,
    `the ${platform} loading-screen die should occupy about ${geometry.inkSpan.label} `
    + `of its ${geometry.inkSpan.by}, found ${inkWidth}`);

  /* NEUTRALITY, the claim the whole design rests on. Every sampled point in
     the mark must be lit above the ground and carry no hue: that is what lets
     ONE image stand in front of 42 different pairs without contradicting any
     of them. Re-colour the splash and these are what stop it. */
  let dimmest = Number.POSITIVE_INFINITY;
  for (const [x, y] of geometry.markSamples) {
    const sample = pixelAt(pixels, x, y);
    dimmest = Math.min(dimmest, luma(sample));
    check(luma(sample) > groundLuma + 12,
      `the ${platform} loading-screen mark must be lit at ${x},${y}`);
    check(colorSpread(sample) <= NEUTRAL_SPREAD,
      `the ${platform} loading-screen mark must claim no duel hue at ${x},${y} — `
      + `the launch frame is one image for all 42 pairs`);
  }

  /* THE SEAM. Dead centre, colourless, and the brightest thing in the mark:
     the cut is what survives desaturation, and it is the only part of the
     design that still reads once the two owners' hues are gone. */
  const seam = pixelAt(pixels, .5, .5);
  check(colorSpread(seam) <= NEUTRAL_SPREAD && luma(seam) > dimmest,
    `the ${platform} loading screen must keep a lit, colourless seam through the die`);
}
