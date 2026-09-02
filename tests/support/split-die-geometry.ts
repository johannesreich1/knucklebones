/* WHERE THE SPLIT DIE'S PARTS LAND, and what "still the split die" means.
   Six contracts sample the launcher art — iOS light/dark/tinted, the Android
   adaptive/legacy/themed layers, the PWA maskable icon — and every one needs
   the same answers: which fraction of the canvas holds a pip, the seam or a
   plate, and whether a rendition still shows two hues either side of a white
   cut. Deriving it once here means a padding or tilt change in the generator
   moves every probe with it, instead of leaving six hand-typed grids behind.

   The die is authored in a 120-unit square that fills the canvas, with the
   96-unit die inset by 12 — so the die box is the canvas inset by `pad` — and
   the whole mark is rotated APP_ICON_TILT_DEG clockwise about the centre. */
import { readFileSync } from 'node:fs';
import { HUE_IDS } from '../../src/state.ts';
import { diePipCells } from '../../src/ui/die-markup.ts';
import { ICON_PAIRS, type IconPair } from '../../src/app-icon-registry.ts';
import {
  colorBounds,
  colorRowBounds,
  colorSpread,
  pixelAt,
  readPngPixels,
  rgbDistance,
  type RgbaPixel,
} from './png-pixels.ts';

type Check = (ok: boolean, message: string) => void;
type Png = ReturnType<typeof readPngPixels>;
const APP_ICON_GENERATOR = 'tools/appicon.mjs';
const DIE_STYLES = 'src/styles/game/dice.css';
const HUE_TOKENS = 'src/styles/foundations/tokens.css';

/* ======================= SPLIT-DIE GEOMETRY ======================= */
/* Shared by every launcher contract (iOS shell, Android resources, the
   registry expansions). The numbers come from the generator and the app's
   die CSS, never from a second hand-written copy: a pad or tilt change in
   tools/appicon.mjs moves every sample point here with it, and the asset it
   was rendered into either agrees or fails by name. */
const appIconGeneratorSource = readFileSync(APP_ICON_GENERATOR, 'utf8');
function generatorNumber(name: string): number {
  const match = new RegExp(`^export const ${name} = (\\.?\\d+(?:\\.\\d+)?);`, 'm')
    .exec(appIconGeneratorSource);
  if (!match) {
    throw new Error(`${APP_ICON_GENERATOR} no longer exports ${name}; the split-die contracts have no geometry`);
  }
  return Number(match[1]);
}
/** The die box as a fraction of the launcher canvas: 1 - 2 * pad (80%). */
export const SPLIT_ICON_PAD = generatorNumber('SPLIT_ICON_PAD');
/** Maskable PWA icons pad a fifth because unknown launcher shapes crop it. */
export const MASKABLE_ICON_PAD = generatorNumber('MASKABLE_ICON_PAD');
export const SPLIT_ICON_TILT_DEG = generatorNumber('APP_ICON_TILT_DEG');
export const SPLIT_ICON_FACE = generatorNumber('SPLIT_ICON_FACE');
/** The lit cells of the six face: two full outer columns, nothing on the seam. */
export const SPLIT_PIP_CELLS: readonly number[] = diePipCells(SPLIT_ICON_FACE);
/* The card's corner (min(--r 14px, 25.5px) of a 96px die) and the CSS pip
   grid (padding .155 of the die, three equal tracks) are the same drawing the
   app renders, read from the same stylesheet the generator inlines. */
const DIE_CORNER = 14 / 96;
const dieStyles = readFileSync(DIE_STYLES, 'utf8');
const diePadding = Number((/\.die\{[^}]*padding:calc\(var\(--cell\)\*(\.\d+)\)/.exec(dieStyles) ?? [])[1]);
if (!Number.isFinite(diePadding)) {
  throw new Error(`${DIE_STYLES} no longer states the die's grid padding; the pip centres are unknown`);
}
const PIP_TRACKS: readonly number[] = [0, 1, 2].map((track) =>
  diePadding + ((1 - diePadding * 2) / 3) * (track + .5));

/** A point given in die-box fractions, tilted the shipped 7° about the canvas centre. */
export function splitDiePoint(u: number, v: number, pad = SPLIT_ICON_PAD): readonly [number, number] {
  const box = 1 - pad * 2;
  const angle = SPLIT_ICON_TILT_DEG * Math.PI / 180;
  const dx = pad + u * box - .5;
  const dy = pad + v * box - .5;
  return [
    .5 + Math.cos(angle) * dx - Math.sin(angle) * dy,
    .5 + Math.sin(angle) * dx + Math.cos(angle) * dy,
  ];
}

export function splitPipCentre(cell: number, pad = SPLIT_ICON_PAD): readonly [number, number] {
  return splitDiePoint(PIP_TRACKS[cell % 3]!, PIP_TRACKS[Math.floor(cell / 3)]!, pad);
}

/** Horizontal extent of the tilted, rounded die box as a canvas fraction. */
export function splitDieBodyExtent(pad = SPLIT_ICON_PAD): number {
  const box = 1 - pad * 2;
  const radius = box * DIE_CORNER;
  const angle = SPLIT_ICON_TILT_DEG * Math.PI / 180;
  return 2 * ((box / 2 - radius) * (Math.cos(angle) + Math.sin(angle)) + radius);
}

/** The die's coloured horizontal extent as a canvas fraction. */
export function splitDieInkWidth(png: Png, minimumSpread: number): number | null {
  const bounds = colorBounds(png, minimumSpread);
  return bounds ? (bounds.right - bounds.left + 1) / png.width : null;
}

/** Tilt read from the die's coloured extent on two rows: a clockwise 7° puts
 * the upper row's centre right of the lower row's by 2-3% of the canvas. */
export function splitDieTilt(png: Png, minimumSpread: number): number | null {
  const upper = colorRowBounds(png, .4, minimumSpread);
  const lower = colorRowBounds(png, .6, minimumSpread);
  if (!upper || !lower) return null;
  return (upper.left + upper.right) / (2 * png.width) - (lower.left + lower.right) / (2 * png.width);
}

export function hueRgb(hue: string): RgbaPixel | null {
  const tokens = readFileSync(HUE_TOKENS, 'utf8');
  const match = new RegExp(`--${hue}:#([0-9a-f]{6})`, 'i').exec(tokens);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return { red: value >> 16, green: (value >> 8) & 0xff, blue: value & 0xff, alpha: 255 };
}

export type Channel = 'red' | 'green' | 'blue';
export function lowestChannel(pixel: Readonly<{ red: number; green: number; blue: number }>): Channel {
  if (pixel.red <= pixel.green && pixel.red <= pixel.blue) return 'red';
  return pixel.green <= pixel.blue ? 'green' : 'blue';
}

/* A pip is a white core with its hue at the rim (radial-gradient from #fff at
   35%/30% to --dc at 78%), so the hue is read where the gradient has reached
   it: a small lattice across the pip's lower-right quadrant, the side away
   from the highlight. The nearest sample wins, which makes the read immune to
   the sub-pixel drift of a 7° rotation at 192px. */
const RIM_LATTICE: readonly number[] = [.02, .04, .06, .08];
export function pipRimDistance(
  png: Png,
  cell: number,
  pad: number,
  hue: RgbaPixel,
  minimumAlpha = 200,
): number {
  let nearest = Infinity;
  const column = PIP_TRACKS[cell % 3]!;
  const row = PIP_TRACKS[Math.floor(cell / 3)]!;
  for (const du of RIM_LATTICE) {
    for (const dv of RIM_LATTICE) {
      const [x, y] = splitDiePoint(column + du, row + dv, pad);
      const pixel = pixelAt(png, x, y);
      if (pixel.alpha < minimumAlpha) continue;
      nearest = Math.min(nearest, rgbDistance(pixel, hue));
    }
  }
  return nearest;
}

const pipSide = (cell: number): 'left' | 'right' => (cell % 3 === 0 ? 'left' : 'right');
const pipHue = (pair: IconPair, cell: number): string => (pipSide(cell) === 'left' ? pair.p1 : pair.p2);
const otherHue = (pair: IconPair, cell: number): string => (pipSide(cell) === 'left' ? pair.p2 : pair.p1);

/** The six lit pips of a split die: every core filled and white, tinted toward
 * its column's hue, and every rim nearer that hue than the partner's. */
export function verifySplitDiePips(
  check: Check,
  png: Png,
  file: string,
  pair: IconPair,
  pad: number,
  options: Readonly<{ coreAlpha?: number; coreMinChannel?: number }> = {},
): void {
  const coreAlpha = options.coreAlpha ?? 255;
  const coreMinChannel = options.coreMinChannel ?? 150;
  let lit = 0;
  for (const cell of SPLIT_PIP_CELLS) {
    const own = hueRgb(pipHue(pair, cell));
    const partner = hueRgb(otherHue(pair, cell));
    const [x, y] = splitPipCentre(cell, pad);
    const core = pixelAt(png, x, y);
    const brightest = Math.max(core.red, core.green, core.blue);
    const dimmest = Math.min(core.red, core.green, core.blue);
    const filled = core.alpha >= coreAlpha && brightest >= 240 && dimmest >= coreMinChannel;
    if (filled) lit++;
    check(filled,
      `${file} ${pipSide(cell)} pip ${cell} at ${x.toFixed(3)},${y.toFixed(3)} must be a filled white-cored pip; `
      + `found rgba(${core.red},${core.green},${core.blue},${core.alpha})`);
    check(own !== null && partner !== null,
      `${HUE_TOKENS} must define --${pipHue(pair, cell)} and --${otherHue(pair, cell)} for ${file}`);
    if (!own || !partner) continue;
    check(lowestChannel(core) === lowestChannel(own),
      `${file} ${pipSide(cell)} pip ${cell} core must tint toward ${pipHue(pair, cell)}; `
      + `found rgb(${core.red},${core.green},${core.blue})`);
    const ownDistance = pipRimDistance(png, cell, pad, own);
    const partnerDistance = pipRimDistance(png, cell, pad, partner);
    check(ownDistance <= 30 && ownDistance < partnerDistance,
      `${file} ${pipSide(cell)} pip ${cell} rim must read as ${pipHue(pair, cell)} `
      + `(nearest ${ownDistance.toFixed(1)}) rather than ${otherHue(pair, cell)} (${partnerDistance.toFixed(1)})`);
  }
  check(lit === SPLIT_PIP_CELLS.length,
    `${file} must show all ${SPLIT_PIP_CELLS.length} split-die pips, found ${lit}`);
}

/** The glass over each hue plate stays dark: sampled between the pips and the
 * seam, well below the pip cores, and tinted toward the plate's own hue. */
export function verifySplitDieGlass(check: Check, png: Png, file: string, pair: IconPair, pad: number): void {
  for (const [u, v, hue] of [[.385, .385, pair.p1], [.615, .615, pair.p2]] as const) {
    const [x, y] = splitDiePoint(u, v, pad);
    const glass = pixelAt(png, x, y);
    const target = hueRgb(hue);
    check(glass.alpha === 255 && Math.max(glass.red, glass.green, glass.blue) <= 170
      && target !== null && lowestChannel(glass) === lowestChannel(target),
    `${file} glass at die ${u},${v} must stay a dark ${hue} plate rather than a washed-out slab; `
      + `found rgba(${glass.red},${glass.green},${glass.blue},${glass.alpha})`);
  }
}

/** The pair-independent cutout drawing (iOS Tinted, Android themed): a solid
 * grayscale die with the six pips and the seam cut through it. */
export function verifySplitDieCutouts(check: Check, png: Png, file: string, pad = SPLIT_ICON_PAD): void {
  check(png.colorType === 6 && png.hasTransparency && pixelAt(png, .03, .03).alpha === 0,
    `${file} must be a transparent grayscale source for system tinting`);
  let cut = 0;
  for (const cell of SPLIT_PIP_CELLS) {
    const [x, y] = splitPipCentre(cell, pad);
    let opaque = 0;
    for (const dx of [-.018, 0, .018]) {
      for (const dy of [-.018, 0, .018]) {
        opaque = Math.max(opaque, pixelAt(png, x + dx, y + dy).alpha);
      }
    }
    if (opaque <= 8) cut++;
    check(opaque <= 8,
      `${file} pip ${cell} around ${x.toFixed(3)},${y.toFixed(3)} must be a substantial transparent cutout`);
  }
  check(cut === SPLIT_PIP_CELLS.length,
    `${file} must cut all ${SPLIT_PIP_CELLS.length} pips out of the tinted die, found ${cut}`);
  for (const v of [.2, .38, .5, .62, .8]) {
    const [x, y] = splitDiePoint(.5, v, pad);
    check(pixelAt(png, x, y).alpha <= 8,
      `${file} seam at die height ${v} must be cut through the tinted die`);
  }
  for (const [u, v] of [[.385, .385], [.615, .615], [.385, .5], [.615, .5]] as const) {
    const [x, y] = splitDiePoint(u, v, pad);
    const body = pixelAt(png, x, y);
    check(body.alpha >= 240 && colorSpread(body) <= 1,
      `${file} body at die ${u},${v} must remain inside the solid grayscale die`);
  }
}

/** Seven pairs that put every hue once on the left and once on the right. */
export const HUE_ROTATION_PAIRS: readonly IconPair[] = HUE_IDS.map((p1, index) => ({
  p1, p2: HUE_IDS[(index + 1) % HUE_IDS.length]!,
}));

/* The three names the shell/resource contracts read the split through. Same
   geometry, said the way those probes ask for it. */
export const LEFT_CELLS = SPLIT_PIP_CELLS.filter((cell) => cell % 3 === 0);
export const RIGHT_CELLS = SPLIT_PIP_CELLS.filter((cell) => cell % 3 === 2);
export const pipPoint = splitPipCentre;
export const seamPoint = (fy = .5, pad = SPLIT_ICON_PAD): readonly [number, number] =>
  splitDiePoint(.5, fy, pad);
/** A point on one owner's plate: inside the die, clear of every pip and the
    seam, so it reads that half's hue rather than a pip's white core. */
export const platePoint = (
  side: 'left' | 'right',
  pad = SPLIT_ICON_PAD,
): readonly [number, number] => splitDiePoint(side === 'left' ? .26 : .74, .38, pad);
