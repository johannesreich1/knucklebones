import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from '../../../native/node_modules/sharp/lib/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [config, manifest] = await Promise.all([
  readFile(path.join(here, 'app-store-connect.json'), 'utf8').then(JSON.parse),
  readFile(path.join(here, 'manifest.json'), 'utf8').then(JSON.parse),
]);

if (config.schemaVersion !== 2 || manifest.schemaVersion !== 2) {
  throw new Error('Localized App Store exports require config and manifest schemaVersion 2');
}

const slideStem = (slide) => `${String(slide.index).padStart(2, '0')}-${slide.slug}`;
const manifestTargets = new Map(manifest.targets.map((target) => [target.id, target]));
const summaries = [];

async function sourcePng(rawDir, target, stem, variant) {
  const sourcePath = path.join(rawDir, `${stem}-${variant}.png`);
  const metadata = await sharp(sourcePath).metadata();
  if (metadata.width !== target.width || metadata.height !== target.height) {
    throw new Error(`${sourcePath} is ${metadata.width}x${metadata.height}; expected ${target.width}x${target.height}`);
  }
  return readFile(sourcePath);
}

async function chronologicalComposite(rawDir, target, slide, stem) {
  const spec = slide.composite;
  if (spec.kind !== 'chronological-horizontal-feather') {
    throw new Error(`${stem} has unsupported composite kind ${spec.kind}`);
  }
  const opaqueThrough = Math.round(target.height * Number(spec.overlayOpaqueThroughRatio));
  const transparentFrom = Math.round(target.height * Number(spec.overlayTransparentFromRatio));
  if (!Number.isInteger(opaqueThrough) || !Number.isInteger(transparentFrom)
      || opaqueThrough < 0 || transparentFrom > target.height || opaqueThrough >= transparentFrom) {
    throw new Error(`${stem} has invalid composite transition ${opaqueThrough}..${transparentFrom}`);
  }

  const [base, overlay] = await Promise.all([
    sourcePng(rawDir, target, stem, spec.baseVariant),
    sourcePng(rawDir, target, stem, spec.overlayVariant),
  ]);
  const rgba = await sharp(overlay).ensureAlpha().raw().toBuffer();
  const feather = transparentFrom - opaqueThrough;
  for (let y = 0; y < target.height; y++) {
    const alpha = y <= opaqueThrough ? 255
      : y >= transparentFrom ? 0
        : Math.round(255 * (transparentFrom - y) / feather);
    const rowStart = y * target.width * 4;
    for (let x = 0; x < target.width; x++) rgba[rowStart + x * 4 + 3] = alpha;
  }

  return sharp(base)
    .composite([{ input: rgba, raw: { width: target.width, height: target.height, channels: 4 } }])
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer();
}

for (const locale of config.locales) {
  if (!manifest.localizations[locale.appStoreLocale]) {
    throw new Error(`Manifest has no screenshot localization for ${locale.appStoreLocale}`);
  }

  for (const configuredTarget of config.screenshotTargets) {
    const target = manifestTargets.get(configuredTarget.id);
    if (!target || target.width !== configuredTarget.width || target.height !== configuredTarget.height
        || target.displayType !== configuredTarget.displayType) {
      throw new Error(`Config/manifest target mismatch for ${configuredTarget.id}`);
    }

    const rawDir = path.join(here, 'raw', locale.appStoreLocale, target.id);
    const exportDir = path.join(
      here,
      locale.screenshotExportRoot,
      configuredTarget.exportDirectory,
    );
    await mkdir(exportDir, { recursive: true });

    const outputs = [];
    for (const slide of manifest.slides) {
      const stem = slideStem(slide);
      const outputPath = path.join(exportDir, `${stem}.png`);
      const final = slide.composite
        ? await chronologicalComposite(rawDir, target, slide, stem)
        : await sharp(await sourcePng(rawDir, target, stem, 'hero'))
          .removeAlpha()
          .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
          .toBuffer();
      await writeFile(outputPath, final);

      const outputMeta = await sharp(outputPath).metadata();
      if (outputMeta.width !== target.width || outputMeta.height !== target.height || outputMeta.hasAlpha) {
        throw new Error(`${stem} final export failed size/alpha validation: ${JSON.stringify(outputMeta)}`);
      }
      outputs.push({ slide, stem, outputPath });
    }

    const thumbWidth = target.id === 'iphone-6.9' ? 330 : 344;
    const thumbHeight = Math.round(thumbWidth * target.height / target.width);
    const gap = 28;
    const outer = 34;
    const cols = 3;
    const rows = Math.ceil(outputs.length / cols);
    const sheetWidth = outer * 2 + cols * thumbWidth + (cols - 1) * gap;
    const sheetHeight = outer * 2 + rows * thumbHeight + (rows - 1) * gap;
    const thumbs = await Promise.all(outputs.map(async (output, index) => ({
      input: await sharp(output.outputPath)
        .resize(thumbWidth, thumbHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
        .toBuffer(),
      left: outer + (index % cols) * (thumbWidth + gap),
      top: outer + Math.floor(index / cols) * (thumbHeight + gap),
    })));
    const contactDir = path.join(here, 'contact-sheets');
    await mkdir(contactDir, { recursive: true });
    const contactSheet = path.join(contactDir, `${locale.appStoreLocale}-${target.id}.jpg`);
    await sharp({
      create: { width: sheetWidth, height: sheetHeight, channels: 3, background: '#090a12' },
    })
      .composite(thumbs)
      .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
      .toFile(contactSheet);

    const checksums = await Promise.all(outputs.map(async (output) => {
      const digest = createHash('sha256').update(await readFile(output.outputPath)).digest('hex');
      return `${digest}  ${path.basename(output.outputPath)}`;
    }));
    const checksumPath = path.join(exportDir, 'checksums.txt');
    await writeFile(checksumPath, `${checksums.join('\n')}\n`);

    const rawNames = new Set();
    for (const slide of manifest.slides) {
      const stem = slideStem(slide);
      const variants = slide.composite
        ? [slide.composite.baseVariant, slide.composite.overlayVariant]
        : ['hero'];
      for (const variant of variants) rawNames.add(`${stem}-${variant}.png`);
    }
    const rawChecksums = await Promise.all([...rawNames].sort().map(async (name) => {
      const digest = createHash('sha256').update(await readFile(path.join(rawDir, name))).digest('hex');
      return `${digest}  ${name}`;
    }));
    const rawChecksumPath = path.join(rawDir, 'checksums.txt');
    await writeFile(rawChecksumPath, `${rawChecksums.join('\n')}\n`);

    summaries.push({
      locale: locale.appStoreLocale,
      target: target.id,
      displayType: target.displayType,
      exports: outputs.length,
      contactSheet,
      checksums: checksumPath,
      sourceChecksums: rawChecksumPath,
      dimensions: `${target.width}x${target.height}`,
      alpha: false,
    });
  }
}

console.log(JSON.stringify({ sets: summaries }, null, 2));
