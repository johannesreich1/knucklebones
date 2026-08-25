import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fail = (message) => { throw new Error(message); };
const requireFact = (ok, message) => { if (!ok) fail(message); };

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
requireFact(nodeMajor === 24,
  `App Store screenshot verification requires Node 24; running ${process.version}`);

const [config, manifest] = await Promise.all([
  readFile(path.join(here, 'app-store-connect.json'), 'utf8').then(JSON.parse),
  readFile(path.join(here, 'manifest.json'), 'utf8').then(JSON.parse),
]);

requireFact(config.schemaVersion === 1, 'app-store-connect.json schemaVersion must be 1');
requireFact(/^\d{10}$/.test(config.appleAppId),
  `appleAppId must be the ten-digit App Store Connect id, found ${JSON.stringify(config.appleAppId)}`);
requireFact(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/.test(config.bundleId),
  `bundleId is not reverse-DNS syntax: ${JSON.stringify(config.bundleId)}`);
requireFact(/^\d+\.\d+(?:\.\d+)?$/.test(config.appVersion),
  `appVersion is invalid: ${JSON.stringify(config.appVersion)}`);
requireFact(config.platform === 'IOS', `platform must be IOS, found ${JSON.stringify(config.platform)}`);
requireFact(config.screenshotDisplayType === 'APP_IPHONE_67',
  `1320x2868 exports must target APP_IPHONE_67, found ${JSON.stringify(config.screenshotDisplayType)}`);
requireFact(typeof config.uploadApproved === 'boolean', 'uploadApproved must be a boolean');
requireFact(!config.uploadApproved || manifest.status === 'approved for App Store Connect upload',
  `uploadApproved requires manifest status "approved for App Store Connect upload"; `
  + `found ${JSON.stringify(manifest.status)}`);
requireFact(manifest.target?.format === 'png' && manifest.target?.alpha === false,
  'manifest target must be opaque PNG');
requireFact(Number.isInteger(manifest.target?.width) && Number.isInteger(manifest.target?.height),
  'manifest target must declare integer width and height');
requireFact(Array.isArray(manifest.slides) && manifest.slides.length > 0 && manifest.slides.length <= 10,
  `manifest must contain 1–10 screenshots, found ${manifest.slides?.length ?? 'none'}`);

const expectedNames = manifest.slides.map((slide, position) => {
  requireFact(slide.index === position + 1,
    `slide at position ${position + 1} has index ${JSON.stringify(slide.index)}`);
  requireFact(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slide.slug),
    `slide ${slide.index} has unsafe slug ${JSON.stringify(slide.slug)}`);
  return `${String(slide.index).padStart(2, '0')}-${slide.slug}.png`;
});
requireFact(new Set(expectedNames).size === expectedNames.length,
  'manifest produces duplicate screenshot filenames');

const exportDir = path.resolve(here, config.exportDirectory);
requireFact(exportDir.startsWith(`${here}${path.sep}`),
  `exportDirectory must stay inside marketing/app-store/ios: ${config.exportDirectory}`);
const directoryNames = await readdir(exportDir);
const actualNames = directoryNames.filter((name) => name.endsWith('.png')).sort();
requireFact(JSON.stringify(actualNames) === JSON.stringify([...expectedNames].sort()),
  `export PNGs differ from the manifest; expected ${JSON.stringify(expectedNames)}, `
  + `found ${JSON.stringify(actualNames)}`);

const checksumText = await readFile(path.join(exportDir, 'checksums.txt'), 'utf8');
const checksumLines = checksumText.trim().split('\n');
requireFact(checksumLines.length === expectedNames.length,
  `checksums.txt has ${checksumLines.length} entries for ${expectedNames.length} screenshots`);
const expectedChecksums = new Map();
for (const line of checksumLines) {
  const match = line.match(/^([a-f0-9]{64})  ([^/]+\.png)$/);
  requireFact(match !== null, `invalid checksums.txt line: ${JSON.stringify(line)}`);
  requireFact(!expectedChecksums.has(match[2]), `duplicate checksum entry for ${match[2]}`);
  expectedChecksums.set(match[2], match[1]);
}
requireFact(JSON.stringify([...expectedChecksums.keys()].sort()) === JSON.stringify([...expectedNames].sort()),
  'checksums.txt filenames differ from the manifest');

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const name of expectedNames) {
  const bytes = await readFile(path.join(exportDir, name));
  requireFact(bytes.length >= 33 && bytes.subarray(0, 8).equals(pngSignature),
    `${name} is not a valid PNG`);
  requireFact(bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString('ascii') === 'IHDR',
    `${name} does not begin with a valid IHDR chunk`);
  requireFact(bytes.readUInt32BE(16) === manifest.target.width
      && bytes.readUInt32BE(20) === manifest.target.height,
    `${name} is ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}; expected `
      + `${manifest.target.width}x${manifest.target.height}`);

  const bitDepth = bytes[24];
  const colorType = bytes[25];
  requireFact(bitDepth === 8 && colorType === 2,
    `${name} must be an opaque 8-bit RGB PNG; found bit depth ${bitDepth}, color type ${colorType}`);
  let offset = 8;
  let transparentPalette = false;
  let hasEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    requireFact(end <= bytes.length, `${name} has a truncated PNG chunk`);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'tRNS') transparentPalette = true;
    if (type === 'IEND') { hasEnd = true; break; }
    offset = end;
  }
  requireFact(hasEnd, `${name} has no IEND chunk`);
  requireFact(!transparentPalette, `${name} contains a tRNS transparency chunk`);

  const digest = createHash('sha256').update(bytes).digest('hex');
  requireFact(digest === expectedChecksums.get(name),
    `${name} differs from its committed SHA-256 checksum`);
}

console.log(JSON.stringify({
  app: config.storeName,
  appleAppId: config.appleAppId,
  bundleId: config.bundleId,
  version: config.appVersion,
  language: manifest.locale,
  displayType: config.screenshotDisplayType,
  uploadApproved: config.uploadApproved,
  screenshots: expectedNames.length,
  dimensions: `${manifest.target.width}x${manifest.target.height}`,
  alpha: false,
}, null, 2));
