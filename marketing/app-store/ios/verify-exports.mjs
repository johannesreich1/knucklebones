import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from '../../../native/node_modules/sharp/lib/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fail = (message) => { throw new Error(message); };
const requireFact = (ok, message) => { if (!ok) fail(message); };
const sorted = (values) => [...values].sort();

const germanDiaeresisCrops = new Map([
  ['iphone-6.9/01-ranked-row-multiply.png', { left: 790, top: 300, width: 100, height: 42 }],
  ['iphone-6.9/04-sunder-overload.png', { left: 490, top: 300, width: 100, height: 42 }],
  ['ipad-13/01-ranked-row-multiply.png', { left: 870, top: 260, width: 110, height: 42 }],
  ['ipad-13/04-sunder-overload.png', { left: 500, top: 260, width: 120, height: 42 }],
]);

async function assertGermanDiaeresisPainted(imagePath, targetId, name) {
  const crop = germanDiaeresisCrops.get(`${targetId}/${name}`);
  if (!crop) return;
  const { data, info } = await sharp(imagePath)
    .extract(crop)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ink = new Uint8Array(info.width * info.height);
  for (let index = 0; index < ink.length; index++) {
    const offset = index * info.channels;
    ink[index] = data[offset] + data[offset + 1] + data[offset + 2] > 300 ? 1 : 0;
  }

  const seen = new Uint8Array(ink.length);
  const components = [];
  for (let index = 0; index < ink.length; index++) {
    if (!ink[index] || seen[index]) continue;
    const stack = [index];
    seen[index] = 1;
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    let pixels = 0;
    while (stack.length) {
      const current = stack.pop();
      const x = current % info.width;
      const y = Math.floor(current / info.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixels++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= info.width || nextY < 0 || nextY >= info.height) continue;
          const next = nextY * info.width + nextX;
          if (ink[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    if (pixels >= 40) {
      components.push({
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        pixels,
      });
    }
  }

  const dots = components.filter((component) => component.width >= 16 && component.width <= 32);
  requireFact(dots.length === 2 && dots.every((dot) => dot.height >= 16),
    `de-DE/${targetId}/${name} clips the painted umlaut dots: ${JSON.stringify(dots)}`);
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
requireFact(nodeMajor === 24,
  `App Store screenshot verification requires Node 24; running ${process.version}`);

const [config, manifest, metadata, provenance] = await Promise.all([
  readFile(path.join(here, 'app-store-connect.json'), 'utf8').then(JSON.parse),
  readFile(path.join(here, 'manifest.json'), 'utf8').then(JSON.parse),
  readFile(path.join(here, 'metadata.json'), 'utf8').then(JSON.parse),
  readFile(path.join(here, 'capture-provenance.json'), 'utf8').then(JSON.parse),
]);

requireFact(config.schemaVersion === 2, 'app-store-connect.json schemaVersion must be 2');
requireFact(manifest.schemaVersion === 2, 'manifest.json schemaVersion must be 2');
requireFact(metadata.schemaVersion === 1, 'metadata.json schemaVersion must be 1');
requireFact(provenance.schemaVersion === 1, 'capture-provenance.json schemaVersion must be 1');
requireFact(provenance.generator === 'marketing/app-store/ios/capture.mjs',
  'capture provenance must name the repository generator');
requireFact(/^[a-f0-9]{8}$/.test(provenance.runtimeBuild),
  `capture provenance has invalid runtime build ${JSON.stringify(provenance.runtimeBuild)}`);
requireFact(/^\d{10}$/.test(config.appleAppId),
  `appleAppId must be the ten-digit App Store Connect id, found ${JSON.stringify(config.appleAppId)}`);
requireFact(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/.test(config.bundleId),
  `bundleId is not reverse-DNS syntax: ${JSON.stringify(config.bundleId)}`);
requireFact(/^\d+\.\d+(?:\.\d+)?$/.test(config.appVersion),
  `appVersion is invalid: ${JSON.stringify(config.appVersion)}`);
requireFact(config.platform === 'IOS', `platform must be IOS, found ${JSON.stringify(config.platform)}`);
requireFact(config.draftSyncApproved === true,
  'draftSyncApproved must be true for this owner-approved App Store Connect draft synchronization');
requireFact(config.reviewSubmissionApproved === false,
  'reviewSubmissionApproved must remain false; this workflow never submits a version for review');
requireFact(manifest.status === 'approved for draft App Store Connect synchronization',
  `draftSyncApproved requires the reviewed draft-sync manifest status; found ${JSON.stringify(manifest.status)}`);

const expectedLocales = ['de-DE', 'en-GB', 'es-ES', 'fr-FR', 'id', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'tr'];
const actualLocales = config.locales.map((locale) => locale.appStoreLocale);
requireFact(JSON.stringify(sorted(actualLocales)) === JSON.stringify(expectedLocales),
  `config locales must be exactly ${expectedLocales.join(', ')}`);
requireFact(new Set(actualLocales).size === actualLocales.length, 'config contains duplicate locales');
requireFact(JSON.stringify(sorted(Object.keys(manifest.localizations))) === JSON.stringify(expectedLocales),
  'manifest screenshot localizations must exactly match config locales');
requireFact(JSON.stringify(sorted(Object.keys(metadata.localizations))) === JSON.stringify(expectedLocales),
  'metadata localizations must exactly match config locales');

const runtimeLocales = new Map(config.locales.map((locale) => [locale.appStoreLocale, locale.runtimeLocale]));
for (const locale of expectedLocales) {
  requireFact(['en', 'pt', 'es', 'de', 'fr', 'it', 'pl', 'tr', 'id', 'ja', 'ko']
    .includes(runtimeLocales.get(locale)),
    `${locale} has unsupported runtime locale ${JSON.stringify(runtimeLocales.get(locale))}`);
  requireFact(manifest.localizations[locale].runtimeLocale === runtimeLocales.get(locale),
    `${locale} runtime locale differs between config and manifest`);
}

const expectedTargets = new Map([
  ['iphone-6.9', { displayType: 'APP_IPHONE_67', width: 1320, height: 2868 }],
  ['ipad-13', { displayType: 'APP_IPAD_PRO_3GEN_129', width: 2064, height: 2752 }],
]);
requireFact(config.screenshotTargets.length === expectedTargets.size,
  `config must contain ${expectedTargets.size} screenshot targets`);
requireFact(manifest.targets.length === expectedTargets.size,
  `manifest must contain ${expectedTargets.size} screenshot targets`);
const manifestTargetById = new Map(manifest.targets.map((target) => [target.id, target]));
for (const target of config.screenshotTargets) {
  const expected = expectedTargets.get(target.id);
  const manifestTarget = manifestTargetById.get(target.id);
  requireFact(expected !== undefined, `unexpected screenshot target ${JSON.stringify(target.id)}`);
  requireFact(target.displayType === expected.displayType
      && target.width === expected.width && target.height === expected.height,
  `${target.id} must be ${expected.displayType} at ${expected.width}x${expected.height}`);
  requireFact(manifestTarget?.displayType === target.displayType
      && manifestTarget?.width === target.width && manifestTarget?.height === target.height,
  `${target.id} differs between config and manifest`);
  requireFact(manifestTarget?.format === 'png' && manifestTarget?.alpha === false,
    `${target.id} manifest target must be opaque PNG`);
  requireFact(Number.isInteger(manifestTarget?.runtimeViewport?.width)
      && Number.isInteger(manifestTarget?.runtimeViewport?.height),
    `${target.id} must declare a real runtime viewport`);
}

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
const expectedRawNames = manifest.slides.flatMap((slide) => {
  const stem = `${String(slide.index).padStart(2, '0')}-${slide.slug}`;
  const variants = slide.composite
    ? [...new Set(['hero', slide.composite.baseVariant, slide.composite.overlayVariant])]
    : ['hero'];
  return variants.map((variant) => `${stem}-${variant}.png`);
});
for (const locale of expectedLocales) {
  const slideCopy = manifest.localizations[locale].slides;
  requireFact(JSON.stringify(sorted(Object.keys(slideCopy)))
      === JSON.stringify(sorted(manifest.slides.map((slide) => slide.slug))),
    `${locale} screenshot copy must cover every slide exactly once`);
  for (const slide of manifest.slides) {
    const copy = slideCopy[slide.slug];
    requireFact(typeof copy.eyebrow === 'string' && copy.eyebrow.trim(),
      `${locale}/${slide.slug} has no eyebrow`);
    requireFact(Array.isArray(copy.headlineLines) && copy.headlineLines.length === 2
        && copy.headlineLines.every((line) => typeof line === 'string' && line.trim()),
      `${locale}/${slide.slug} must have exactly two headline lines`);
    requireFact(typeof copy.subhead === 'string' && copy.subhead.trim(),
      `${locale}/${slide.slug} has no subhead`);
  }
}

const ownedFields = ['description', 'keywords', 'name', 'promotionalText', 'subtitle'];
requireFact(JSON.stringify(sorted(metadata.ownedFields)) === JSON.stringify(ownedFields),
  `metadata ownedFields must be exactly ${ownedFields.join(', ')}`);
for (const locale of expectedLocales) {
  const copy = metadata.localizations[locale];
  requireFact(JSON.stringify(sorted(Object.keys(copy))) === JSON.stringify(ownedFields),
    `${locale} metadata must contain only the owned fields`);
  requireFact([...copy.name].length <= 30 && [...copy.name].length > 0,
    `${locale} name exceeds Apple's 30-character limit`);
  requireFact([...copy.subtitle].length <= 30 && [...copy.subtitle].length > 0,
    `${locale} subtitle exceeds Apple's 30-character limit`);
  requireFact([...copy.promotionalText].length <= 170,
    `${locale} promotional text exceeds Apple's 170-character limit`);
  requireFact([...copy.description].length <= 4000 && copy.description.length > 0,
    `${locale} description exceeds Apple's 4,000-character limit`);
  requireFact(Buffer.byteLength(copy.keywords, 'utf8') <= 100,
    `${locale} keywords exceed Apple's 100-byte limit`);
  requireFact(!/(supportUrl|privacyPolicyUrl|privacyChoicesUrl|marketingUrl|whatsNew)/.test(JSON.stringify(copy)),
    `${locale} metadata owns a release-blocked URL or first-version update field`);
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const summaries = [];
const expectedProvenanceFiles = [];
for (const locale of config.locales) {
  for (const target of config.screenshotTargets) {
    const exportDir = path.resolve(here, locale.screenshotExportRoot, target.exportDirectory);
    requireFact(exportDir.startsWith(`${here}${path.sep}`),
      `export directory must stay inside marketing/app-store/ios: ${exportDir}`);
    const directoryNames = await readdir(exportDir);
    const actualNames = directoryNames.filter((name) => name.endsWith('.png')).sort();
    requireFact(JSON.stringify(actualNames) === JSON.stringify(sorted(expectedNames)),
      `${locale.appStoreLocale}/${target.id} PNGs differ from the manifest`);

    const checksumText = await readFile(path.join(exportDir, 'checksums.txt'), 'utf8');
    const checksumLines = checksumText.trim().split('\n');
    requireFact(checksumLines.length === expectedNames.length,
      `${locale.appStoreLocale}/${target.id} checksums.txt has ${checksumLines.length} entries`);
    const expectedChecksums = new Map();
    for (const line of checksumLines) {
      const match = line.match(/^([a-f0-9]{64})  ([^/]+\.png)$/);
      requireFact(match !== null, `invalid checksums.txt line: ${JSON.stringify(line)}`);
      requireFact(!expectedChecksums.has(match[2]), `duplicate checksum entry for ${match[2]}`);
      expectedChecksums.set(match[2], match[1]);
    }
    requireFact(JSON.stringify(sorted(expectedChecksums.keys())) === JSON.stringify(sorted(expectedNames)),
      `${locale.appStoreLocale}/${target.id} checksum filenames differ from manifest`);

    const md5s = new Set();
    for (const name of expectedNames) {
      const imagePath = path.join(exportDir, name);
      const bytes = await readFile(imagePath);
      requireFact(bytes.length >= 33 && bytes.subarray(0, 8).equals(pngSignature), `${name} is not a PNG`);
      requireFact(bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString('ascii') === 'IHDR',
        `${name} does not begin with a valid IHDR chunk`);
      requireFact(bytes.readUInt32BE(16) === target.width && bytes.readUInt32BE(20) === target.height,
        `${locale.appStoreLocale}/${target.id}/${name} has wrong dimensions`);
      const bitDepth = bytes[24];
      const colorType = bytes[25];
      requireFact(bitDepth === 8 && colorType === 2,
        `${locale.appStoreLocale}/${target.id}/${name} must be opaque 8-bit RGB PNG`);
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
      requireFact(hasEnd && !transparentPalette, `${name} contains invalid transparency or no IEND`);
      const digest = createHash('sha256').update(bytes).digest('hex');
      requireFact(digest === expectedChecksums.get(name), `${name} differs from its committed SHA-256`);
      md5s.add(createHash('md5').update(bytes).digest('hex'));
      if (locale.appStoreLocale === 'de-DE') {
        await assertGermanDiaeresisPainted(imagePath, target.id, name);
      }
    }
    requireFact(md5s.size === expectedNames.length,
      `${locale.appStoreLocale}/${target.id} contains duplicate screenshot images`);

    const rawDir = path.join(here, 'raw', locale.appStoreLocale, target.id);
    const rawDirectoryNames = await readdir(rawDir);
    const actualRawNames = rawDirectoryNames.filter((name) => name.endsWith('.png')).sort();
    requireFact(JSON.stringify(actualRawNames) === JSON.stringify(sorted(expectedRawNames)),
      `${locale.appStoreLocale}/${target.id} raw PNGs differ from the manifest`);
    const rawChecksumText = await readFile(path.join(rawDir, 'checksums.txt'), 'utf8');
    const rawChecksumLines = rawChecksumText.trim().split('\n');
    requireFact(rawChecksumLines.length === expectedRawNames.length,
      `${locale.appStoreLocale}/${target.id} raw checksums have the wrong count`);
    const rawChecksums = new Map();
    for (const line of rawChecksumLines) {
      const match = line.match(/^([a-f0-9]{64})  ([^/]+\.png)$/);
      requireFact(match !== null, `invalid raw checksums.txt line: ${JSON.stringify(line)}`);
      rawChecksums.set(match[2], match[1]);
    }
    requireFact(JSON.stringify(sorted(rawChecksums.keys())) === JSON.stringify(sorted(expectedRawNames)),
      `${locale.appStoreLocale}/${target.id} raw checksum filenames differ from manifest`);
    for (const name of expectedRawNames) {
      const rawPath = path.join(rawDir, name);
      const bytes = await readFile(rawPath);
      requireFact(bytes.subarray(0, 8).equals(pngSignature), `${rawPath} is not a PNG`);
      requireFact(bytes.readUInt32BE(16) === target.width && bytes.readUInt32BE(20) === target.height,
        `${rawPath} has wrong dimensions`);
      requireFact(createHash('sha256').update(bytes).digest('hex') === rawChecksums.get(name),
        `${rawPath} differs from its committed SHA-256`);
      expectedProvenanceFiles.push(path.relative(path.resolve(here, '../../..'), rawPath));
    }

    const contactSheet = path.join(here, 'contact-sheets', `${locale.appStoreLocale}-${target.id}.jpg`);
    requireFact((await stat(contactSheet)).size > 0,
      `${locale.appStoreLocale}/${target.id} contact sheet is missing or empty`);
    summaries.push({
      locale: locale.appStoreLocale,
      target: target.id,
      displayType: target.displayType,
      screenshots: expectedNames.length,
      dimensions: `${target.width}x${target.height}`,
    });
  }
}

requireFact(provenance.captures === expectedProvenanceFiles.length,
  `capture provenance records ${provenance.captures} files; expected ${expectedProvenanceFiles.length}`);
requireFact(JSON.stringify(provenance.files) === JSON.stringify(expectedProvenanceFiles),
  'capture provenance file order or membership differs from the manifest matrix');
requireFact(JSON.stringify(provenance.locales) === JSON.stringify(Object.keys(manifest.localizations)),
  'capture provenance locales differ from the manifest');
requireFact(JSON.stringify(provenance.targets) === JSON.stringify(manifest.targets.map((target) => ({
  id: target.id,
  width: target.width,
  height: target.height,
  runtimeViewport: target.runtimeViewport,
}))), 'capture provenance targets differ from the manifest');

console.log(JSON.stringify({
  app: config.storeName,
  appleAppId: config.appleAppId,
  bundleId: config.bundleId,
  version: config.appVersion,
  draftSyncApproved: config.draftSyncApproved,
  reviewSubmissionApproved: config.reviewSubmissionApproved,
  sets: summaries,
}, null, 2));
