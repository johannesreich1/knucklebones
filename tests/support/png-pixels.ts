import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export type RgbaPixel = Readonly<{ red: number; green: number; blue: number; alpha: number }>;

export type DecodedPng = Readonly<{
  width: number;
  height: number;
  colorType: number;
  hasTransparency: boolean;
  pixel: (x: number, y: number) => RgbaPixel;
}>;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

/* Checked-in launcher art is deterministic Chromium/Capacitor output:
   non-interlaced, eight-bit RGB or RGBA PNG. Decode that small, explicit
   format so native contracts can assert visible pixels without a platform-only
   image utility or another production dependency. */
export function readPngPixels(file: string): DecodedPng {
  const png = readFileSync(file);
  if (!png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new Error(`${file} is not a PNG`);
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let compression = -1;
  let filterMethod = -1;
  let interlace = -1;
  let hasTransparencyChunk = false;
  const data: Buffer[] = [];
  for (let offset = SIGNATURE.length; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8]!;
      colorType = body[9]!;
      compression = body[10]!;
      filterMethod = body[11]!;
      interlace = body[12]!;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'tRNS') {
      hasTransparencyChunk = true;
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType)
    || compression !== 0 || filterMethod !== 0 || interlace !== 0 || !data.length) {
    throw new Error(`${file} must be a non-interlaced eight-bit RGB/RGBA PNG; found `
      + JSON.stringify({ width, height, bitDepth, colorType, compression, filterMethod, interlace }));
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(data));
  if (inflated.length !== height * (stride + 1)) {
    throw new Error(`${file} has ${inflated.length} inflated bytes, expected ${height * (stride + 1)}`);
  }

  const pixels = Buffer.alloc(height * stride);
  let sourceOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[sourceOffset++]!;
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x++) {
      const encoded = inflated[sourceOffset++]!;
      const left = x >= channels ? pixels[rowOffset + x - channels]! : 0;
      const up = y > 0 ? pixels[rowOffset - stride + x]! : 0;
      const upperLeft = y > 0 && x >= channels
        ? pixels[rowOffset - stride + x - channels]!
        : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
        : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2)
        : filter === 4 ? paeth(left, up, upperLeft)
        : -1;
      if (predictor < 0) throw new Error(`${file} uses unsupported PNG filter ${filter}`);
      pixels[rowOffset + x] = (encoded + predictor) & 0xff;
    }
  }

  return {
    width,
    height,
    colorType,
    hasTransparency: colorType === 6 || hasTransparencyChunk,
    pixel(x, y) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
        throw new Error(`${file}: pixel ${x},${y} is outside ${width}x${height}`);
      }
      const offset = (y * width + x) * channels;
      return {
        red: pixels[offset]!,
        green: pixels[offset + 1]!,
        blue: pixels[offset + 2]!,
        alpha: channels === 4 ? pixels[offset + 3]! : 255,
      };
    },
  };
}

export function pixelAt(png: DecodedPng, x: number, y: number): RgbaPixel {
  return png.pixel(
    Math.min(png.width - 1, Math.max(0, Math.round(x * (png.width - 1)))),
    Math.min(png.height - 1, Math.max(0, Math.round(y * (png.height - 1)))),
  );
}

export function rgbDistance(a: RgbaPixel, b: RgbaPixel): number {
  return Math.hypot(a.red - b.red, a.green - b.green, a.blue - b.blue);
}

export function colorSpread(pixel: RgbaPixel): number {
  return Math.max(pixel.red, pixel.green, pixel.blue) - Math.min(pixel.red, pixel.green, pixel.blue);
}

export function alphaBounds(png: DecodedPng, threshold = 127): Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}> | null {
  let left = png.width;
  let top = png.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.pixel(x, y).alpha <= threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left ? null : { left, top, right, bottom };
}

export function alphaRowBounds(
  png: DecodedPng,
  normalizedY: number,
  threshold = 127,
): Readonly<{ left: number; right: number }> | null {
  const y = Math.min(png.height - 1, Math.max(0, Math.round(normalizedY * (png.height - 1))));
  let left = png.width;
  let right = -1;
  for (let x = 0; x < png.width; x++) {
    if (png.pixel(x, y).alpha <= threshold) continue;
    left = Math.min(left, x);
    right = Math.max(right, x);
  }
  return right < left ? null : { left, right };
}

export function colorBounds(png: DecodedPng, minimumSpread = 40): Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}> | null {
  let left = png.width;
  let top = png.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (colorSpread(png.pixel(x, y)) < minimumSpread) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left ? null : { left, top, right, bottom };
}

export function colorRowBounds(
  png: DecodedPng,
  normalizedY: number,
  minimumSpread = 40,
): Readonly<{ left: number; right: number }> | null {
  const y = Math.min(png.height - 1, Math.max(0, Math.round(normalizedY * (png.height - 1))));
  let left = png.width;
  let right = -1;
  for (let x = 0; x < png.width; x++) {
    if (colorSpread(png.pixel(x, y)) < minimumSpread) continue;
    left = Math.min(left, x);
    right = Math.max(right, x);
  }
  return right < left ? null : { left, right };
}
