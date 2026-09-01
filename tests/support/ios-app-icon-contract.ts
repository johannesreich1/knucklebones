import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs';
import { APP_ID } from '../../src/config.ts';
import {
  DEFAULT_AVATAR,
  PROFILE_AVATARS,
  appIconIdForAvatar,
  parseAvatar,
} from '../../src/profile-avatar.ts';
import { colorSpread, pixelAt, readPngPixels, rgbDistance } from './png-pixels.ts';

type Check = (ok: boolean, message: string) => void;
type ManifestEntry = Readonly<{
  path?: string;
  bytes?: number;
  sha256?: string;
  missing?: boolean;
}>;

const XCODE = 'native/ios/App/App.xcodeproj/project.pbxproj';
const CATALOG_ROOT = 'native/ios/App/App/Assets.xcassets';
const MANIFEST_FILE = 'native/profile-app-icons.manifest.json';
const PROFILE_GENERATOR = 'tools/profile-app-icons.mjs';
const APP_ICON_GENERATOR = 'tools/appicon.mjs';
const LIGHT_FILE = 'AppIcon-512@2x.png';
const DARK_FILE = 'AppIcon-Dark-512@2x.png';
const TINTED_FILE = 'AppIcon-Tinted-512@2x.png';
const CONTENTS_FILE = 'Contents.json';

const iconSpecs = PROFILE_AVATARS.map((avatar) => {
  const { face, hue } = parseAvatar(avatar);
  const canonicalAlternate = `die-${face}-${hue}` as const;
  const icon = appIconIdForAvatar(avatar);
  return {
    avatar,
    face,
    hue,
    icon,
    iosCatalog: icon === 'primary' ? 'AppIcon' : canonicalAlternate,
  };
});
const primary = iconSpecs.find(({ icon }) => icon === 'primary');
const alternates = iconSpecs.filter(({ icon }) => icon !== 'primary');

const json = (value: unknown): string => JSON.stringify(value);
const sha256 = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');
const catalogFile = (catalog: string, file: string): string =>
  `${CATALOG_ROOT}/${catalog}.appiconset/${file}`;

function xcodeStringList(body: string, setting: string): string[] | null {
  const match = body.match(new RegExp(`${setting}\\s*=\\s*\\(([\\s\\S]*?)\\);`));
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]+)"|([A-Za-z0-9_.-]+)/g)]
    .map((item) => item[1] ?? item[2]);
}

function verifyPngHeader(check: Check, file: string, expectedColorType: 2 | 6): void {
  check(existsSync(file), `${file} is absent; regenerate the profile app-icon catalogs`);
  if (!existsSync(file)) return;
  // Read only IHDR for all 126 renditions. The representative visual checks
  // below decode seven files instead of repeatedly scanning the whole set.
  const header = Buffer.alloc(29);
  const descriptor = openSync(file, 'r');
  let bytesRead = 0;
  try {
    bytesRead = readSync(descriptor, header, 0, header.length, 0);
  } finally {
    closeSync(descriptor);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const valid = bytesRead === header.length
    && header.subarray(0, signature.length).equals(signature)
    && header.subarray(12, 16).toString('ascii') === 'IHDR';
  check(valid, `${file} must be a PNG with an IHDR header`);
  if (!valid) return;
  check(header.readUInt32BE(16) === 1024 && header.readUInt32BE(20) === 1024,
    `${file} must be exactly 1024x1024, found ${header.readUInt32BE(16)}x${header.readUInt32BE(20)}`);
  check(header[24] === 8 && header[25] === expectedColorType
    && header[26] === 0 && header[27] === 0 && header[28] === 0,
  `${file} must be non-interlaced eight-bit ${expectedColorType === 2 ? 'opaque RGB' : 'transparent RGBA'} PNG art`);
  check(statSync(file).size > 4096, `${file} is suspiciously small for authored 1024px launcher art`);
}

function verifyCatalog(check: Check, catalog: string): void {
  const contentsFile = catalogFile(catalog, CONTENTS_FILE);
  check(existsSync(contentsFile), `${contentsFile} is absent; regenerate the iOS app-icon catalogs`);
  if (!existsSync(contentsFile)) return;
  const contents = JSON.parse(readFileSync(contentsFile, 'utf8'));
  const images = Array.isArray(contents.images) ? contents.images : [];
  const light = images.find((image: { filename?: string }) => image.filename === LIGHT_FILE);
  const dark = images.find((image: { filename?: string }) => image.filename === DARK_FILE);
  const tinted = images.find((image: { filename?: string }) => image.filename === TINTED_FILE);
  check(images.length === 3 && !!light && !!dark && !!tinted,
    `${contentsFile} must contain exactly the Any/light, Dark, and authored Tinted 1024px renditions`);
  check(json(light && Object.keys(light).sort()) === json(['filename', 'idiom', 'platform', 'size'])
    && light?.idiom === 'universal' && light?.platform === 'ios' && light?.size === '1024x1024',
  `${contentsFile} ${LIGHT_FILE} must be the unqualified universal iOS 1024x1024 rendition`);
  check(json(dark && Object.keys(dark).sort())
    === json(['appearances', 'filename', 'idiom', 'platform', 'size'])
    && dark?.idiom === 'universal' && dark?.platform === 'ios' && dark?.size === '1024x1024'
    && json(dark?.appearances) === json([{ appearance: 'luminosity', value: 'dark' }]),
  `${contentsFile} ${DARK_FILE} must be exactly the luminosity=dark universal iOS rendition`);
  check(json(tinted && Object.keys(tinted).sort())
    === json(['appearances', 'filename', 'idiom', 'platform', 'size'])
    && tinted?.idiom === 'universal' && tinted?.platform === 'ios' && tinted?.size === '1024x1024'
    && json(tinted?.appearances) === json([{ appearance: 'luminosity', value: 'tinted' }]),
  `${contentsFile} ${TINTED_FILE} must be exactly the luminosity=tinted universal iOS rendition`);
  check(json(contents.info) === json({ author: 'xcode', version: 1 }),
    `${contentsFile} must retain the deterministic Xcode catalog metadata`);
  verifyPngHeader(check, catalogFile(catalog, LIGHT_FILE), 2);
  verifyPngHeader(check, catalogFile(catalog, DARK_FILE), 6);
  verifyPngHeader(check, catalogFile(catalog, TINTED_FILE), 6);
}

function verifyBuildSettings(check: Check): void {
  const xcode = readFileSync(XCODE, 'utf8');
  const configs = [...xcode.matchAll(
    /\t\t[A-F0-9]{24} \/\* (Debug|Release) \*\/ = \{\n([\s\S]*?)\n\t\t\};/g,
  )]
    .map((match) => ({ name: match[1], body: match[2] }))
    .filter(({ body }) => new RegExp(
      `PRODUCT_BUNDLE_IDENTIFIER\\s*=\\s*${APP_ID.replaceAll('.', '\\.')}\\s*;`,
    ).test(body));
  check(json(configs.map(({ name }) => name).sort()) === json(['Debug', 'Release']),
    `${XCODE} must expose exactly the App Debug and Release configurations`);
  const expectedAlternates = alternates.map(({ icon }) => icon);
  for (const config of configs) {
    const primaryNames = [...config.body.matchAll(
      /ASSETCATALOG_COMPILER_APPICON_NAME\s*=\s*([^;\s]+)\s*;/g,
    )].map((match) => match[1]);
    check(json(primaryNames) === json(['AppIcon']),
      `${XCODE} App ${config.name} must compile AppIcon as its one primary catalog`);
    const actualAlternates = xcodeStringList(
      config.body,
      'ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES',
    );
    check(json(actualAlternates) === json(expectedAlternates),
      `${XCODE} App ${config.name} alternate names must exactly equal the 41 registry-derived IDs; `
      + `found ${json(actualAlternates)}`);
  }
}

function verifyProvenance(check: Check): Map<string, ManifestEntry> {
  check(existsSync(MANIFEST_FILE),
    `${MANIFEST_FILE} is absent; run the profile app-icon generators before shipping`);
  if (!existsSync(MANIFEST_FILE)) return new Map();
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
  const registryHash = createHash('sha256').update(json(PROFILE_AVATARS)).digest('hex');
  check(manifest.schemaVersion === 1 && manifest.generatedBy === 'tools/appicon.mjs'
    && !Object.hasOwn(manifest, 'generatedAt'),
  `${MANIFEST_FILE} must be deterministic schema 1 provenance without a timestamp`);
  check(manifest.commands?.webAndIos === 'mise exec -- node tools/appicon.mjs'
    && manifest.commands?.android === 'mise exec -- npm run native:assets:android',
  `${MANIFEST_FILE} must document both canonical regeneration commands`);
  check(manifest.registry?.primaryAvatar === DEFAULT_AVATAR
    && manifest.registry?.primaryIcon === 'primary'
    && manifest.registry?.count === 42
    && manifest.registry?.sha256 === registryHash,
  `${MANIFEST_FILE} registry identity/hash must match the imported 42-avatar registry`);
  check(json(manifest.design?.iosAuthoredAppearances) === json(['light', 'dark', 'tinted'])
    && json(manifest.design?.iosSystemDerivedAppearances) === json(['clear']),
  `${MANIFEST_FILE} must distinguish authored Light/Dark/Tinted from system-derived Clear`);

  const manifestOrder = primary ? [primary, ...alternates] : alternates;
  const expectedVariants = manifestOrder.map(({ avatar, icon, iosCatalog }) => ({
    avatar, icon, iosCatalog,
  }));
  const actualVariants = Array.isArray(manifest.variants)
    ? manifest.variants.map((variant: { avatar?: string; icon?: string; iosCatalog?: string }) => ({
      avatar: variant.avatar,
      icon: variant.icon,
      iosCatalog: variant.iosCatalog,
    }))
    : [];
  check(json(actualVariants) === json(expectedVariants),
    `${MANIFEST_FILE} must map the primary plus all 41 alternates to their exact iOS catalogs`);

  const provenance = [
    ...(Array.isArray(manifest.sourceComponents) ? manifest.sourceComponents : []),
    ...(Array.isArray(manifest.nativeContracts) ? manifest.nativeContracts : []),
  ] as ManifestEntry[];
  for (const entry of provenance) {
    const file = entry.path ?? '';
    check(!!file && existsSync(file) && entry.bytes === statSync(file).size && entry.sha256 === sha256(file),
      `${MANIFEST_FILE} provenance for ${file || '<missing path>'} must match the current source bytes`);
  }
  for (const required of [
    'tools/appicon.mjs',
    'tools/profile-app-icons.mjs',
    'src/profile-avatar.ts',
    'src/ui/die-markup.ts',
    XCODE,
    'native/plugins/appicon/ios/Sources/AppIconPlugin/AppIconPlugin.swift',
  ]) {
    check(provenance.some(({ path }) => path === required),
      `${MANIFEST_FILE} does not record required generator/native input ${required}`);
  }

  const assets = (Array.isArray(manifest.assets) ? manifest.assets : []) as ManifestEntry[];
  const assetMap = new Map(assets.map((entry) => [entry.path ?? '', entry]));
  const expectedIosAssets = iconSpecs.flatMap(({ iosCatalog }) => [
    catalogFile(iosCatalog, CONTENTS_FILE),
    catalogFile(iosCatalog, LIGHT_FILE),
    catalogFile(iosCatalog, DARK_FILE),
    catalogFile(iosCatalog, TINTED_FILE),
  ]).sort();
  const actualIosAssets = assets.map(({ path }) => path ?? '')
    .filter((path) => path.startsWith(`${CATALOG_ROOT}/`) && path.includes('.appiconset/'))
    .sort();
  check(json(actualIosAssets) === json(expectedIosAssets),
    `${MANIFEST_FILE} must cover exactly all 168 files in the 42 iOS app-icon catalogs`);
  for (const file of expectedIosAssets) {
    const entry = assetMap.get(file);
    check(entry?.missing !== true && typeof entry?.bytes === 'number'
      && /^[a-f0-9]{64}$/.test(entry?.sha256 ?? ''),
    `${MANIFEST_FILE} must contain size and SHA-256 provenance for ${file}`);
    if (file.endsWith(`/${CONTENTS_FILE}`) && entry && existsSync(file)) {
      check(entry.bytes === statSync(file).size && entry.sha256 === sha256(file),
        `${MANIFEST_FILE} hash for ${file} must match the generated catalog metadata`);
    }
  }
  return assetMap;
}

function verifyRepresentativePixels(check: Check, assetMap: Map<string, ManifestEntry>): void {
  const samples = [
    [1, 'blue'], [2, 'mg'], [3, 'gold'], [4, 'green'],
    [5, 'violet'], [6, 'orange'], [1, 'cy'],
  ] as const;
  const grid = [
    ['tl', .354, .313], ['tm', .52, .333], ['tr', .687, .354],
    ['ml', .333, .48], ['c', .5, .5], ['mr', .667, .52],
    ['bl', .313, .646], ['bm', .48, .667], ['br', .646, .687],
  ] as const;
  const pips: Readonly<Record<number, readonly string[]>> = {
    1: ['c'],
    2: ['tl', 'br'],
    3: ['tl', 'c', 'br'],
    4: ['tl', 'tr', 'bl', 'br'],
    5: ['tl', 'tr', 'c', 'bl', 'br'],
    6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
  };
  const frames: Array<Readonly<{ hue: string; pixel: ReturnType<typeof pixelAt> }>> = [];
  for (const [face, hue] of samples) {
    const catalog = `die-${face}-${hue}`;
    const file = catalogFile(catalog, DARK_FILE);
    if (!existsSync(file)) continue;
    const png = readPngPixels(file);
    check(png.colorType === 6 && png.hasTransparency && pixelAt(png, .03, .03).alpha <= 32,
      `${file} must preserve the transparent Dark-appearance cutout around the neon die`);
    check(pixelAt(png, .12, .12).alpha <= 4,
      `${file} must not wash the system-provided Dark background with an oversized transparent halo`);
    const expectedPips = new Set(pips[face]);
    const actualPips = grid
      .filter(([, x, y]) => pixelAt(png, x, y).alpha >= 200)
      .map(([name]) => name);
    check(json(actualPips) === json([...expectedPips]),
      `${file} must show exactly ${face} luminous pips with unused pip cells cut out; found ${json(actualPips)}`);
    for (const [name, x, y] of grid) {
      if (expectedPips.has(name)) continue;
      check(pixelAt(png, x, y).alpha < 100,
        `${file} unused ${name} pip cell must stay cut out rather than becoming another pip`);
    }
    const frame = pixelAt(png, .5, .15);
    frames.push({ hue, pixel: frame });
    check(frame.alpha >= 140 && colorSpread(frame) >= 75,
      `${file} must retain a strongly hue-colored neon frame`);
    const manifestEntry = assetMap.get(file);
    if (manifestEntry) {
      check(manifestEntry.bytes === statSync(file).size && manifestEntry.sha256 === sha256(file),
        `${MANIFEST_FILE} representative asset hash must match ${file}`);
    }

    const tintedFile = catalogFile(catalog, TINTED_FILE);
    if (!existsSync(tintedFile)) continue;
    const tinted = readPngPixels(tintedFile);
    check(tinted.colorType === 6 && tinted.hasTransparency && pixelAt(tinted, .03, .03).alpha === 0,
      `${tintedFile} must be a transparent grayscale source for iOS Tinted and Clear rendering`);
    for (const [name, x, y] of grid) {
      const pixel = pixelAt(tinted, x, y);
      if (expectedPips.has(name)) {
        check(pixel.alpha <= 32,
          `${tintedFile} selected ${name} pip must remain a cutout in the tinted die`);
      } else {
        check(pixel.alpha >= 220 && colorSpread(pixel) <= 1,
          `${tintedFile} unused ${name} cell must remain inside the solid grayscale die`);
      }
    }
  }
  check(frames.length === samples.length,
    'representative iOS pixel coverage requires all six faces and all seven hues');
  for (let left = 0; left < frames.length; left++) {
    for (let right = left + 1; right < frames.length; right++) {
      check(rgbDistance(frames[left].pixel, frames[right].pixel) >= 60,
        `representative ${frames[left].hue} and ${frames[right].hue} iOS frames must remain visibly distinct`);
    }
  }
}

export function verifyIosAppIconContract(check: Check): void {
  const expectedHues = ['cy', 'mg', 'gold', 'green', 'violet', 'orange', 'blue'];
  const actualFaces = [...new Set(iconSpecs.map(({ face }) => face))];
  const actualHues = [...new Set(iconSpecs.map(({ hue }) => hue))];
  check(DEFAULT_AVATAR === 'die:5:cy' && primary?.avatar === DEFAULT_AVATAR
    && primary?.iosCatalog === 'AppIcon',
  'src/profile-avatar.ts must map exactly die:5:cy to the compiled AppIcon primary');
  check(json(actualFaces) === json([1, 2, 3, 4, 5, 6]) && json(actualHues) === json(expectedHues)
    && iconSpecs.length === 42 && alternates.length === 41
    && new Set(alternates.map(({ icon }) => icon)).size === 41,
  'the imported profile registry must derive six faces, seven canonical hues, and 41 unique alternates');
  for (const spec of iconSpecs) {
    const expected = spec.avatar === DEFAULT_AVATAR ? 'primary' : `die-${spec.face}-${spec.hue}`;
    check(spec.icon === expected, `${spec.avatar} maps to ${spec.icon}, expected ${expected}`);
  }

  verifyBuildSettings(check);
  const actualCatalogs = readdirSync(CATALOG_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.appiconset'))
    .map(({ name }) => name.slice(0, -'.appiconset'.length))
    .sort();
  const expectedCatalogs = iconSpecs.map(({ iosCatalog }) => iosCatalog).sort();
  check(json(actualCatalogs) === json(expectedCatalogs),
    `${CATALOG_ROOT} must contain exactly AppIcon plus the 41 registry-derived alternate catalogs`);
  for (const catalog of expectedCatalogs) verifyCatalog(check, catalog);

  const profileGenerator = readFileSync(PROFILE_GENERATOR, 'utf8');
  const appIconGenerator = readFileSync(APP_ICON_GENERATOR, 'utf8');
  check(/PROFILE_AVATARS\.map\(profileIconSpec\)/.test(profileGenerator)
    && /for \(const spec of PROFILE_ICON_SPECS\) write\(iosContentsFile/.test(profileGenerator)
    && /for \(const spec of ALTERNATE_PROFILE_ICONS\)/.test(profileGenerator)
    && /writeProvenanceManifest/.test(profileGenerator),
  `${PROFILE_GENERATOR} must derive catalogs and provenance from the shared profile registry`);
  check(/profileIcons\.generateIosProfileIcons\(shared\)/.test(appIconGenerator),
    `${APP_ICON_GENERATOR} must invoke the complete iOS profile-icon expansion`);
  verifyRepresentativePixels(check, verifyProvenance(check));
}
