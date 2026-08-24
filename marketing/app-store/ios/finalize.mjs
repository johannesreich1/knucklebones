import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from '../../../native/node_modules/sharp/lib/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(here, 'raw');
const exportDir = path.join(here, 'exports', 'iphone-6.9');
const manifest = JSON.parse(await readFile(path.join(here, 'manifest.json'), 'utf8'));

const WIDTH = manifest.target.width;
const HEIGHT = manifest.target.height;
const TOP_HEIGHT = 2107;
const BOTTOM_HEIGHT = HEIGHT - TOP_HEIGHT;

await mkdir(exportDir, { recursive: true });

const outputs = [];
for (const slide of manifest.slides) {
  const stem = `${String(slide.index).padStart(2, '0')}-${slide.slug}`;
  const topPath = path.join(rawDir, `${stem}-top.jpg`);
  const bottomPath = path.join(rawDir, `${stem}-bottom.jpg`);
  const outputPath = path.join(exportDir, `${stem}.png`);

  const [topMeta, bottomMeta] = await Promise.all([
    sharp(topPath).metadata(),
    sharp(bottomPath).metadata(),
  ]);
  for (const [label, meta] of [['top', topMeta], ['bottom', bottomMeta]]) {
    if (meta.width !== WIDTH || meta.height !== TOP_HEIGHT) {
      throw new Error(`${stem} ${label} segment is ${meta.width}x${meta.height}; expected ${WIDTH}x${TOP_HEIGHT}`);
    }
  }

  const lower = await sharp(bottomPath)
    .extract({ left: 0, top: 0, width: WIDTH, height: BOTTOM_HEIGHT })
    .removeAlpha()
    .toBuffer();

  await sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#05060e' },
  })
    .composite([
      { input: topPath, left: 0, top: 0 },
      { input: lower, left: 0, top: TOP_HEIGHT },
    ])
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toFile(outputPath);

  const outputMeta = await sharp(outputPath).metadata();
  if (outputMeta.width !== WIDTH || outputMeta.height !== HEIGHT || outputMeta.hasAlpha) {
    throw new Error(`${stem} final export failed size/alpha validation: ${JSON.stringify(outputMeta)}`);
  }
  outputs.push({ ...slide, stem, outputPath });
}

const thumbWidth = 330;
const thumbHeight = Math.round(thumbWidth * HEIGHT / WIDTH);
const gap = 28;
const outer = 34;
const cols = 3;
const rows = 2;
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

const contactSheet = path.join(here, 'contact-sheet.jpg');
await sharp({
  create: { width: sheetWidth, height: sheetHeight, channels: 3, background: '#090a12' },
})
  .composite(thumbs)
  .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
  .toFile(contactSheet);

const checksums = await Promise.all(outputs.map(async (output) => {
  const digest = createHash('sha256')
    .update(await readFile(output.outputPath))
    .digest('hex');
  return `${digest}  ${path.basename(output.outputPath)}`;
}));
await writeFile(path.join(exportDir, 'checksums.txt'), `${checksums.join('\n')}\n`);

console.log(JSON.stringify({
  exports: outputs.map((output) => output.outputPath),
  contactSheet,
  dimensions: `${WIDTH}x${HEIGHT}`,
  alpha: false,
}, null, 2));
