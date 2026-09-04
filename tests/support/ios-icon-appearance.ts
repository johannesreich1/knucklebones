/* WHAT THE THREE RENDERED APPEARANCES MUST LOOK LIKE.
 *
 * Split out of ios-shell-contract.ts, which owns the shell: the plist, the
 * plugins, the synced payload. This owns pixels — the light, dark and tinted
 * icons as images. One reason to change each, and the shell file was over its
 * size budget with both.
 */
import { existsSync } from 'node:fs';
import {
  colorBounds,
  colorRowBounds,
  colorSpread,
  pixelAt,
  readPngPixels,
  rgbDistance,
} from './png-pixels.ts';
import {
  LEFT_CELLS, RIGHT_CELLS, SPLIT_PIP_CELLS, pipPoint, platePoint, seamPoint,
} from './split-die-geometry.ts';
import { SPLIT_ICON_PAD } from '../../tools/appicon.mjs';
import { sameBytes } from './ios-artifacts.ts';

type Check = (ok: boolean, message: string, detail?: unknown) => void;

export function verifyIosIconAppearances(
  check: Check,
  nativeAssets: readonly { readonly path: string }[],
): void {
  /* Light and dark were byte-identical before the light ground existed;
     requiring identity now would forbid the light appearance outright. */
  check(!sameBytes(nativeAssets[0]!.path, nativeAssets[1]!.path),
    'the iOS Light and Dark app icons are identical, so light mode lost its light ground');

  const lightPixels = readPngPixels(nativeAssets[0].path);
  const darkPixels = readPngPixels(nativeAssets[1].path);
  const tintedPixels = existsSync(nativeAssets[2].path) ? readPngPixels(nativeAssets[2].path) : null;
  check(lightPixels.colorType === 2 && !lightPixels.hasTransparency,
    'the iOS Any/light app icon must remain an opaque RGB PNG');
  check(darkPixels.colorType === 2 && !darkPixels.hasTransparency,
    'the iOS Dark app icon must remain an opaque RGB PNG');
  check(tintedPixels?.colorType === 6 && tintedPixels.hasTransparency,
    'the iOS Tinted app icon must carry a transparent grayscale die for system tinting');
  /* Anchored to the die's authored box, not a restated number: the mark plus
     its light fills most of the tile. SPLIT_ICON_PAD went .1 -> .15 on
     2026-09-04 and the icon stopped clipping the glow at the die, so a fixed
     88-94% described art that no longer exists. Measured after: .8516 light,
     .8154 dark, against a 70% box. */
  const dieBox = 1 - 2 * SPLIT_ICON_PAD;
  for (const [appearance, pixels] of [['Any/light', lightPixels], ['Dark', darkPixels]] as const) {
    const inkBounds = colorBounds(pixels);
    const inkWidth = inkBounds ? (inkBounds.right - inkBounds.left + 1) / pixels.width : 0;
    check(inkBounds !== null && inkWidth >= dieBox + .08 && inkWidth <= dieBox + .20,
      `the iOS ${appearance} split die should occupy about ${((dieBox + .14) * 100).toFixed(0)}% `
      + `of the icon including its glow, found ${inkWidth}`);
    const topInk = colorRowBounds(pixels, .4);
    const bottomInk = colorRowBounds(pixels, .6);
    const topCenter = topInk ? (topInk.left + topInk.right) / (2 * pixels.width) : 0;
    const bottomCenter = bottomInk ? (bottomInk.left + bottomInk.right) / (2 * pixels.width) : 0;
    /* APP_ICON_TILT_DEG has not moved; this reads ROW INK, which now includes an
       unclipped glow, so the same 7deg measures wider. Still one-sided — top row
       right of bottom row is what "clockwise" means — band re-taken at .0434. */
    check(topInk !== null && bottomInk !== null
      && topCenter - bottomCenter >= .02 && topCenter - bottomCenter <= .055,
      `the iOS ${appearance} die should have a subtle clockwise tilt, found row centers ${topCenter} and ${bottomCenter}`);
    /* THE SPLIT ITSELF. The left pip column wears "your colour" and the right
       wears the opponent's, in both appearances: an icon whose columns are one
       hue is the single-die mark this replaced. Pips are white-cored, so the
       hue shows as the direction of the cast rather than a saturated pixel. */
    for (const cell of LEFT_CELLS) {
      const [x, y] = pipPoint(cell);
      const pip = pixelAt(pixels, x, y);
      check(pip.alpha === 255 && pip.green >= 240 && pip.blue >= 250 && pip.blue - pip.red >= 25,
        `the iOS ${appearance} pip at cell ${cell} must be lit and cast toward the p1 hue`);
    }
    for (const cell of RIGHT_CELLS) {
      const [x, y] = pipPoint(cell);
      const pip = pixelAt(pixels, x, y);
      check(pip.alpha === 255 && pip.red >= 250 && pip.red - pip.green >= 55 && pip.blue <= 235,
        `the iOS ${appearance} pip at cell ${cell} must be lit and cast toward the p2 hue`);
    }
    const [lx, ly] = platePoint('left');
    const [rx, ry] = platePoint('right');
    const leftPlate = pixelAt(pixels, lx, ly);
    const rightPlate = pixelAt(pixels, rx, ry);
    check(leftPlate.green - leftPlate.red >= 80 && leftPlate.blue - leftPlate.red >= 90,
      `the iOS ${appearance} left half must stand on the p1 plate`);
    check(rightPlate.red - rightPlate.green >= 80 && rightPlate.red - rightPlate.blue >= 30,
      `the iOS ${appearance} right half must stand on the p2 plate`);
    const [sx, sy] = seamPoint();
    const seam = pixelAt(pixels, sx, sy);
    check(seam.alpha === 255 && Math.min(seam.red, seam.green, seam.blue) >= 230
      && colorSpread(seam) <= 20,
    `the iOS ${appearance} die lost the white seam between its two halves`);
  }

  /* the two grounds: near-white for Any/light, charcoal for Dark */
  const lightGroundTop = pixelAt(lightPixels, .04, .04);
  const lightGroundBottom = pixelAt(lightPixels, .04, .96);
  check(Math.min(lightGroundTop.red, lightGroundTop.green, lightGroundTop.blue) >= 245
    && colorSpread(lightGroundTop) <= 6,
  'the iOS Any/light icon must sit on the system light gradient, not the charcoal one');
  check(rgbDistance(lightGroundTop, lightGroundBottom) >= 20,
    'the iOS Any/light ground lost its gradient');
  const darkGroundTop = pixelAt(darkPixels, .04, .04);
  const darkGroundBottom = pixelAt(darkPixels, .04, .96);
  check(rgbDistance(darkGroundTop, darkGroundBottom) >= 20
    && Math.max(darkGroundTop.red, darkGroundTop.green, darkGroundTop.blue) <= 55
    && Math.max(darkGroundBottom.red, darkGroundBottom.green, darkGroundBottom.blue) <= 40,
  'the iOS Dark icon must preserve the charcoal system-style gradient');
  if (tintedPixels) {
    /* the OS tints this one flat, so hue carries nothing: the seam has to be a
       cutout like the pips, or a tinted icon is an unmarked die */
    const [bx, by] = platePoint('left');
    const tintedBody = pixelAt(tintedPixels, bx, by);
    check(tintedBody.alpha >= 220 && colorSpread(tintedBody) <= 1,
      'the iOS authored Tinted icon must be a solid grayscale die');
    for (const cell of SPLIT_PIP_CELLS) {
      const [x, y] = pipPoint(cell);
      check(pixelAt(tintedPixels, x, y).alpha <= 32,
        `the iOS Tinted pip at cell ${cell} must remain a transparent cutout`);
    }
    for (const fy of [.3, .5, .7]) {
      const [x, y] = seamPoint(fy);
      check(pixelAt(tintedPixels, x, y).alpha <= 32,
        `the iOS Tinted die must cut its seam at ${fy} of its height`);
    }
  }
}
