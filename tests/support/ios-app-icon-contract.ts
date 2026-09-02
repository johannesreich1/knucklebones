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
  DEFAULT_ICON_PAIR,
  ICON_PAIRS,
  appIconIdForPair,
  pairIconName,
  type IconPair,
} from '../../src/app-icon-registry.ts';
import { HUE_IDS } from '../../src/state.ts';
import { diePipCells } from '../../src/ui/die-markup.ts';
import {
  colorBounds,
  colorRowBounds,
  colorSpread,
  pixelAt,
  readPngPixels,
  rgbDistance,
  type RgbaPixel,
} from './png-pixels.ts';
import {
  HUE_ROTATION_PAIRS,
  MASKABLE_ICON_PAD,
  SPLIT_ICON_FACE,
  SPLIT_ICON_PAD,
  SPLIT_ICON_TILT_DEG,
  SPLIT_PIP_CELLS,
  hueRgb,
  splitDieBodyExtent,
  splitDieInkWidth,
  splitDiePoint,
  splitDieTilt,
  splitPipCentre,
  verifySplitDieCutouts,
  verifySplitDieGlass,
  verifySplitDiePips,
} from './split-die-geometry.ts';

type Check = (ok: boolean, message: string) => void;
type Png = ReturnType<typeof readPngPixels>;
type ManifestEntry = Readonly<{
  path?: string;
  bytes?: number;
  sha256?: string;
  missing?: boolean;
}>;

const appIconGeneratorSource = readFileSync('tools/appicon.mjs', 'utf8');
const XCODE = 'native/ios/App/App.xcodeproj/project.pbxproj';
const CATALOG_ROOT = 'native/ios/App/App/Assets.xcassets';
const MANIFEST_FILE = 'native/profile-app-icons.manifest.json';
const PROFILE_GENERATOR = 'tools/profile-app-icons.mjs';
const APP_ICON_GENERATOR = 'tools/appicon.mjs';
const DIE_STYLES = 'src/styles/game/dice.css';
const HUE_TOKENS = 'src/styles/foundations/tokens.css';
const LIGHT_FILE = 'AppIcon-512@2x.png';
const DARK_FILE = 'AppIcon-Dark-512@2x.png';
const TINTED_FILE = 'AppIcon-Tinted-512@2x.png';
const CONTENTS_FILE = 'Contents.json';

/* ======================= THE REGISTRY EXPANSION ======================= */
const iconSpecs = ICON_PAIRS.map((pair) => {
  const icon = appIconIdForPair(pair);
  return {
    pair: pairIconName(pair),
    p1: pair.p1,
    p2: pair.p2,
    icon,
    iosCatalog: icon === 'primary' ? 'AppIcon' : icon,
  };
});
const primary = iconSpecs.find(({ icon }) => icon === 'primary');
const alternates = iconSpecs.filter(({ icon }) => icon !== 'primary');
const json = (value: unknown): string => JSON.stringify(value);
const sha256 = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');
const catalogFile = (catalog: string, file: string): string =>
  `${CATALOG_ROOT}/${catalog}.appiconset/${file}`;
const catalogFor = (pair: IconPair): string => {
  const icon = appIconIdForPair(pair);
  return icon === 'primary' ? 'AppIcon' : icon;
};

function xcodeStringList(body: string, setting: string): string[] | null {
  const match = body.match(new RegExp(`${setting}\\s*=\\s*\\(([\\s\\S]*?)\\);`));
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]+)"|([A-Za-z0-9_.-]+)/g)]
    .map((item) => item[1] ?? item[2]);
}

function verifyPngHeader(check: Check, file: string, expectedColorType: 2 | 6): void {
  check(existsSync(file), `${file} is absent; regenerate the launcher app-icon catalogs`);
  if (!existsSync(file)) return;
  // Read only IHDR for all 126 renditions. The representative visual checks
  // below decode seven catalogs instead of repeatedly scanning the whole set.
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
  verifyPngHeader(check, catalogFile(catalog, DARK_FILE), 2);
  verifyPngHeader(check, catalogFile(catalog, TINTED_FILE), 6);
  const lightFile = catalogFile(catalog, LIGHT_FILE);
  const darkFile = catalogFile(catalog, DARK_FILE);
  if (existsSync(lightFile) && existsSync(darkFile)) {
    check(sha256(lightFile) !== sha256(darkFile),
      `${darkFile} must be the charcoal rendition, not a copy of the system-light ${LIGHT_FILE}`);
  }
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
      `${XCODE} App ${config.name} alternate names must exactly equal the 41 registry-derived pair ids; `
      + `found ${json(actualAlternates)}`);
  }
}

function verifyProvenance(check: Check): Map<string, ManifestEntry> {
  check(existsSync(MANIFEST_FILE),
    `${MANIFEST_FILE} is absent; run the launcher app-icon generators before shipping`);
  if (!existsSync(MANIFEST_FILE)) return new Map();
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
  const registryHash = createHash('sha256').update(json(ICON_PAIRS)).digest('hex');
  check(manifest.schemaVersion === 2 && manifest.generatedBy === 'tools/appicon.mjs'
    && !Object.hasOwn(manifest, 'generatedAt'),
  `${MANIFEST_FILE} must be deterministic schema 2 provenance without a timestamp`);
  check(manifest.commands?.webAndIos === 'mise exec -- node tools/appicon.mjs'
    && manifest.commands?.android === 'mise exec -- npm run native:assets:android',
  `${MANIFEST_FILE} must document both canonical regeneration commands`);
  check(manifest.registry?.primaryPair === pairIconName(DEFAULT_ICON_PAIR)
    && manifest.registry?.primaryIcon === 'primary'
    && manifest.registry?.count === 42
    && manifest.registry?.sha256 === registryHash,
  `${MANIFEST_FILE} registry identity/hash must match the imported 42-pair registry`);
  check(manifest.design?.mark
      === 'split die: one six-face die, left pip column in p1, right column in p2, cut on a seam'
    && manifest.design?.launcherTiltDegrees === SPLIT_ICON_TILT_DEG
    && manifest.design?.androidAdaptiveInset === '10%'
    && json(manifest.design?.darkGradient) === json({ top: '#313131', bottom: '#141414' })
    && json(manifest.design?.iosAuthoredAppearances) === json(['light', 'dark', 'tinted'])
    && manifest.design?.iosLightDarkArtwork
      === 'light appearance on the system light gradient, dark appearance on the charcoal gradient; one split die'
    && json(manifest.design?.iosSystemDerivedAppearances) === json(['clear'])
    && manifest.design?.androidMonochrome
      === 'system-tinted six-face cutout with the seam; hue and glow intentionally omitted',
  `${MANIFEST_FILE} must document the split die, its light/dark grounds, the tinted cutout and system-derived Clear`);

  const manifestOrder = primary ? [primary, ...alternates] : alternates;
  const expectedVariants = manifestOrder.map(({ pair, icon, iosCatalog }) => ({
    pair, icon, iosCatalog,
  }));
  const actualVariants = Array.isArray(manifest.variants)
    ? manifest.variants.map((variant: { pair?: string; icon?: string; iosCatalog?: string }) => ({
      pair: variant.pair,
      icon: variant.icon,
      iosCatalog: variant.iosCatalog,
    }))
    : [];
  check(json(actualVariants) === json(expectedVariants),
    `${MANIFEST_FILE} must map the primary plus all 41 alternate pairs to their exact iOS catalogs`);

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
    APP_ICON_GENERATOR,
    PROFILE_GENERATOR,
    'src/app-icon-registry.ts',
    'src/state.ts',
    'src/ui/die-markup.ts',
    DIE_STYLES,
    HUE_TOKENS,
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
  let covered = 0;
  for (const pair of HUE_ROTATION_PAIRS) {
    const catalog = catalogFor(pair);
    const lightFile = catalogFile(catalog, LIGHT_FILE);
    const darkFile = catalogFile(catalog, DARK_FILE);
    const tintedFile = catalogFile(catalog, TINTED_FILE);
    if (!existsSync(lightFile) || !existsSync(darkFile) || !existsSync(tintedFile)) continue;
    covered++;
    for (const [appearance, file] of [['light', lightFile], ['dark', darkFile]] as const) {
      const png = readPngPixels(file);
      check(png.colorType === 2 && !png.hasTransparency,
        `${file} must be an opaque rendition on its ${appearance} launcher ground`);
      const corner = pixelAt(png, .04, .04);
      const brightest = Math.max(corner.red, corner.green, corner.blue);
      check(colorSpread(corner) <= 6 && (appearance === 'light' ? brightest >= 235 : brightest <= 55),
        `${file} must stand on the ${appearance === 'light' ? 'system light' : 'charcoal'} ground; `
        + `found rgb(${corner.red},${corner.green},${corner.blue}) at its top-left corner`);
      verifySplitDiePips(check, png, file, pair, SPLIT_ICON_PAD);
      verifySplitDieGlass(check, png, file, pair, SPLIT_ICON_PAD);
      const manifestEntry = assetMap.get(file);
      if (manifestEntry) {
        check(manifestEntry.bytes === statSync(file).size && manifestEntry.sha256 === sha256(file),
          `${MANIFEST_FILE} representative asset hash must match ${file}`);
      }
    }
    verifySplitDieCutouts(check, readPngPixels(tintedFile), tintedFile, SPLIT_ICON_PAD);
  }
  check(covered === HUE_ROTATION_PAIRS.length,
    `representative iOS pixel coverage requires all ${HUE_ROTATION_PAIRS.length} hue-rotation catalogs`);
}

export function verifyIosAppIconContract(check: Check): void {
  check(SPLIT_ICON_FACE === 6 && SPLIT_PIP_CELLS.length === 6
    && SPLIT_PIP_CELLS.every((cell) => cell % 3 !== 1),
  `${APP_ICON_GENERATOR} must render the six face, whose pips fill the two columns beside the seam`);
  check(json(DEFAULT_ICON_PAIR) === json({ p1: 'cy', p2: 'mg' })
    && primary?.pair === 'split-cy-mg' && primary?.iosCatalog === 'AppIcon',
  'src/app-icon-registry.ts must map exactly the cyan-magenta pair to the compiled AppIcon primary');
  check(iconSpecs.length === 42 && alternates.length === 41
    && new Set(alternates.map(({ icon }) => icon)).size === 41
    && iconSpecs.every(({ p1, p2 }) => p1 !== p2)
    && json([...new Set(iconSpecs.flatMap(({ p1, p2 }) => [p1, p2]))]) === json(HUE_IDS),
  'the imported launcher registry must derive every ordered pair of the seven duel hues: 41 unique alternates');
  for (const spec of iconSpecs) {
    const expected = spec.pair === 'split-cy-mg' ? 'primary' : spec.pair;
    check(spec.icon === expected && spec.pair === `split-${spec.p1}-${spec.p2}`,
      `${spec.pair} maps to ${spec.icon}, expected ${expected}`);
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
  check(/ICON_PAIRS\.map\(pairIconSpec\)/.test(profileGenerator)
    && /for \(const spec of PAIR_ICON_SPECS\) write\(iosContentsFile/.test(profileGenerator)
    && /for \(const spec of ALTERNATE_PAIR_ICONS\)/.test(profileGenerator)
    && /splitDieIconSVG\(1024, appIconPad, 'light', false, pair\)/.test(profileGenerator)
    && /splitDieIconSVG\(1024, appIconPad, 'dark', false, pair\)/.test(profileGenerator)
    && /monochromeIconSVG\(1024, appIconPad\)/.test(profileGenerator)
    && /writeProvenanceManifest/.test(profileGenerator),
  `${PROFILE_GENERATOR} must derive catalogs, both grounds and provenance from the shared pair registry`);
  check(/pairIcons\.generateIosPairIcons\(shared\)/.test(appIconGeneratorSource)
    && /export function splitDieIconSVG\(/.test(appIconGeneratorSource)
    && /export function monochromeIconSVG\(/.test(appIconGeneratorSource),
  `${APP_ICON_GENERATOR} must invoke the complete iOS pair-icon expansion from the split-die renderer`);
  verifyRepresentativePixels(check, verifyProvenance(check));
}
