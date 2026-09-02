// Deterministic native expansion of the split-die launcher (appicon.mjs owns
// the renderer and primary files). This module owns the 42-way colour-pair
// registry, iOS alternates, Android aliases/resources and the provenance
// manifest. It deliberately receives render functions from appicon.mjs so
// importing either module never triggers a circular build.
//
// Every ordered pair of distinct duel hues is a launcher: the primary is the
// fixed cyan-and-magenta die, the 41 others exist so a device that opts into
// "app icon in my colours" (Settings) can be handed a pre-bundled icon —
// iOS and Android cannot render one at runtime.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ID } from '../src/config.ts';
import {
  DEFAULT_ICON_PAIR,
  ICON_PAIRS,
  appIconIdForPair,
  pairIconName,
} from '../src/app-icon-registry.ts';
import { inlineCssGraph } from './css-graph.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MANIFEST_FILE = 'native/profile-app-icons.manifest.json';
const IOS_CATALOG_ROOT = 'native/ios/App/App/Assets.xcassets';
const ANDROID_MANIFEST = 'native/android/app/src/main/AndroidManifest.xml';
const ALIAS_START = '        <!-- BEGIN GENERATED PROFILE APP ICON ALIASES -->';
const ALIAS_END = '        <!-- END GENERATED PROFILE APP ICON ALIASES -->';
const ANDROID_DENSITIES = Object.freeze([
  ['ldpi', 36],
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]);
const HOME_DIE_GRAPH = inlineCssGraph(['src/styles/main.css'], { rootDir: ROOT });

const absolute = (file) => resolve(ROOT, file);
const write = (file, contents) => {
  const destination = absolute(file);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
};
const hash = (file) => createHash('sha256').update(readFileSync(absolute(file))).digest('hex');
const title = (hue) => hue[0].toUpperCase() + hue.slice(1);

/* One spec per ordered pair. The alias/resource names are derived from the
   icon id so a pair added to the roster names itself everywhere at once. */
function pairIconSpec(pair) {
  const icon = appIconIdForPair(pair);
  const primary = icon === 'primary';
  return Object.freeze({
    pair: pairIconName(pair),
    p1: pair.p1,
    p2: pair.p2,
    icon,
    primary,
    iosCatalog: primary ? 'AppIcon' : icon,
    androidAlias: `${APP_ID}.launcher.${primary ? 'Primary' : `Split${title(pair.p1)}${title(pair.p2)}`}`,
    androidResource: primary ? 'ic_launcher' : `ic_${icon.replaceAll('-', '_')}`,
  });
}

const registrySpecs = ICON_PAIRS.map(pairIconSpec);
export const PRIMARY_PAIR_ICON = registrySpecs.find(({ primary }) => primary);
export const ALTERNATE_PAIR_ICONS = Object.freeze(registrySpecs.filter(({ primary }) => !primary));
export const PAIR_ICON_SPECS = Object.freeze([
  PRIMARY_PAIR_ICON,
  ...ALTERNATE_PAIR_ICONS,
]);

if (!PRIMARY_PAIR_ICON || PAIR_ICON_SPECS.length !== 42 || ALTERNATE_PAIR_ICONS.length !== 41) {
  throw new Error('launcher icon registry must contain one primary and 41 alternates');
}

const iosCatalogPath = (spec) => `${IOS_CATALOG_ROOT}/${spec.iosCatalog}.appiconset`;
const iosLightFile = (spec) => `${iosCatalogPath(spec)}/AppIcon-512@2x.png`;
const iosDarkFile = (spec) => `${iosCatalogPath(spec)}/AppIcon-Dark-512@2x.png`;
const iosTintedFile = (spec) => `${iosCatalogPath(spec)}/AppIcon-Tinted-512@2x.png`;
const iosContentsFile = (spec) => `${iosCatalogPath(spec)}/Contents.json`;
const IOS_CONTENTS = `${JSON.stringify({
  images: [
    {
      filename: 'AppIcon-512@2x.png',
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    },
    {
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      filename: 'AppIcon-Dark-512@2x.png',
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    },
    {
      appearances: [{ appearance: 'luminosity', value: 'tinted' }],
      filename: 'AppIcon-Tinted-512@2x.png',
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    },
  ],
  info: { author: 'xcode', version: 1 },
}, null, 2)}\n`;

const androidLegacyFile = (spec, density) =>
  `native/android/app/src/main/res/mipmap-${density}/${spec.androidResource}.png`;
const androidForegroundFile = (spec, density) =>
  `native/android/app/src/main/res/mipmap-${density}/${spec.androidResource}_foreground.png`;
const androidAdaptiveFile = (spec, api) =>
  `native/android/app/src/main/res/mipmap-anydpi-v${api}/${spec.androidResource}.xml`;

/* The themed (monochrome) layer is pair-independent — the OS tints it — so
   every alternate shares the primary's ic_launcher_monochrome. */
const adaptiveIconXML = (spec, api, adaptiveInset) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground>
        <inset android:drawable="@mipmap/${spec.androidResource}_foreground" android:inset="${adaptiveInset}" />
    </foreground>
${api >= 33 ? `    <monochrome>
        <inset android:drawable="@mipmap/ic_launcher_monochrome" android:inset="${adaptiveInset}" />
    </monochrome>
` : ''}</adaptive-icon>
`;

function writeAndroidAdaptiveResources(adaptiveInset) {
  for (const spec of ALTERNATE_PAIR_ICONS) {
    for (const api of [26, 33]) {
      write(androidAdaptiveFile(spec, api), adaptiveIconXML(spec, api, adaptiveInset));
    }
  }
}

const launcherFilter = `            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>`;

function aliasXML(spec) {
  return `        <activity-alias
            android:name="${spec.androidAlias.slice(APP_ID.length)}"
            android:enabled="${spec.primary}"
            android:exported="true"
            android:icon="@mipmap/${spec.androidResource}"
            android:label="@string/app_name"
            android:targetActivity=".MainActivity">
            <meta-data
                android:name="knucklebones.profileIcon"
                android:value="${spec.icon}" />
${launcherFilter}
        </activity-alias>`;
}

function writeAndroidLauncherAliases() {
  const file = absolute(ANDROID_MANIFEST);
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf(ALIAS_START);
  const end = source.indexOf(ALIAS_END);
  if (start < 0 || end < start) {
    throw new Error(`${ANDROID_MANIFEST} is missing its generated profile-icon alias markers`);
  }
  const block = `${ALIAS_START}\n${PAIR_ICON_SPECS.map(aliasXML).join('\n\n')}\n${ALIAS_END}`;
  writeFileSync(file, source.slice(0, start) + block + source.slice(end + ALIAS_END.length));
}

function expectedGeneratedFiles() {
  const web = [
    'public/icon-180.png',
    'public/icon-192.png',
    'public/icon-512.png',
    'public/icon-maskable-512.png',
  ];
  const ios = PAIR_ICON_SPECS.flatMap((spec) => [
    iosContentsFile(spec),
    iosLightFile(spec),
    iosDarkFile(spec),
    iosTintedFile(spec),
  ]);
  const androidPrimary = [
    'native/assets/icon-only.png',
    'native/assets/icon-foreground.png',
    'native/assets/icon-background.png',
    'native/assets/icon-monochrome.png',
    'native/android/app/src/main/res/drawable/ic_launcher_background.xml',
    ...ANDROID_DENSITIES.map(([density]) =>
      `native/android/app/src/main/res/mipmap-${density}/ic_launcher_monochrome.png`),
    ...[26, 33].flatMap((api) => ['ic_launcher', 'ic_launcher_round'].map((name) =>
      `native/android/app/src/main/res/mipmap-anydpi-v${api}/${name}.xml`)),
  ];
  const androidAlternates = [
    ...ALTERNATE_PAIR_ICONS.flatMap((spec) => ANDROID_DENSITIES.flatMap(([density]) => [
      androidLegacyFile(spec, density),
      androidForegroundFile(spec, density),
    ])),
    ...ALTERNATE_PAIR_ICONS.flatMap((spec) => [26, 33].map((api) =>
      androidAdaptiveFile(spec, api))),
  ];
  return [...web, ...ios, ...androidPrimary, ...androidAlternates].sort();
}

function manifestEntry(file) {
  if (!existsSync(absolute(file))) return { path: file, missing: true };
  return { path: file, bytes: statSync(absolute(file)).size, sha256: hash(file) };
}

function writeProvenanceManifest({ appIconPad, appIconTiltDeg, adaptiveInset, darkGradient }) {
  const sourcePaths = [
    'tools/appicon.mjs',
    'tools/profile-app-icons.mjs',
    'src/config.ts',
    'src/app-icon-registry.ts',
    'src/state.ts',
    'src/ui/die-markup.ts',
    ...HOME_DIE_GRAPH.files.map((file) => relative(ROOT, file).split(sep).join('/')),
  ];
  const contractPaths = [
    'native/ios/App/App.xcodeproj/project.pbxproj',
    'native/ios/App/App/Info.plist',
    'native/plugins/appicon/ios/Sources/AppIconPlugin/AppIconPlugin.swift',
    ANDROID_MANIFEST,
    'native/plugins/appicon/android/src/main/java/com/appavaria/knucklebones/appicon/AppIconPlugin.java',
  ];
  const manifest = {
    schemaVersion: 2,
    generatedBy: 'tools/appicon.mjs',
    commands: {
      webAndIos: 'mise exec -- node tools/appicon.mjs',
      android: 'mise exec -- npm run native:assets:android',
    },
    sourceComponents: [...new Set(sourcePaths)].sort().map(manifestEntry),
    nativeContracts: contractPaths.map(manifestEntry),
    design: {
      mark: 'split die: one six-face die, left pip column in p1, right column in p2, cut on a seam',
      launcherDiePadding: appIconPad,
      launcherTiltDegrees: appIconTiltDeg,
      androidAdaptiveInset: adaptiveInset,
      darkGradient,
      iosAuthoredAppearances: ['light', 'dark', 'tinted'],
      iosLightDarkArtwork: 'light appearance on the system light gradient, dark appearance on the charcoal gradient; one split die',
      iosSystemDerivedAppearances: ['clear'],
      androidMonochrome: 'system-tinted six-face cutout with the seam; hue and glow intentionally omitted',
    },
    registry: {
      primaryPair: pairIconName(DEFAULT_ICON_PAIR),
      primaryIcon: 'primary',
      count: PAIR_ICON_SPECS.length,
      sha256: createHash('sha256').update(JSON.stringify(ICON_PAIRS)).digest('hex'),
    },
    variants: PAIR_ICON_SPECS.map((spec) => ({
      pair: spec.pair,
      icon: spec.icon,
      iosCatalog: spec.iosCatalog,
      androidAlias: spec.androidAlias,
      androidResource: spec.androidResource,
    })),
    assets: expectedGeneratedFiles().map(manifestEntry),
  };
  write(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function generateIosPairIcons({
  shot,
  splitDieIconSVG,
  monochromeIconSVG,
  appIconPad,
  appIconTiltDeg,
  adaptiveInset,
  darkGradient,
}) {
  for (const spec of PAIR_ICON_SPECS) write(iosContentsFile(spec), IOS_CONTENTS);
  /* the tinted drawing is pair-independent: render it once, copy it 41 times */
  const tinted = await shot(monochromeIconSVG(1024, appIconPad), 1024, true);
  for (const spec of ALTERNATE_PAIR_ICONS) {
    const pair = { p1: spec.p1, p2: spec.p2 };
    write(iosLightFile(spec), await shot(splitDieIconSVG(1024, appIconPad, 'light', false, pair), 1024, false));
    write(iosDarkFile(spec), await shot(splitDieIconSVG(1024, appIconPad, 'dark', false, pair), 1024, false));
    write(iosTintedFile(spec), tinted);
  }
  writeAndroidLauncherAliases();
  writeProvenanceManifest({ appIconPad, appIconTiltDeg, adaptiveInset, darkGradient });
  console.log(`generated ${ALTERNATE_PAIR_ICONS.length} iOS alternate app-icon catalogs`);
}

export async function generateAndroidPairIcons({
  shot,
  splitDieIconSVG,
  adaptiveForegroundSVG,
  appIconPad,
  appIconTiltDeg,
  adaptiveInset,
  darkGradient,
}) {
  for (const spec of ALTERNATE_PAIR_ICONS) {
    const pair = { p1: spec.p1, p2: spec.p2 };
    for (const [density, size] of ANDROID_DENSITIES) {
      const legacy = await shot(splitDieIconSVG(size, appIconPad, 'dark', false, pair), size, false);
      write(androidLegacyFile(spec, density), legacy);
      const foreground = await shot(adaptiveForegroundSVG(size, pair), size, true);
      write(androidForegroundFile(spec, density), foreground);
    }
  }
  writeAndroidAdaptiveResources(adaptiveInset);
  writeAndroidLauncherAliases();
  writeProvenanceManifest({ appIconPad, appIconTiltDeg, adaptiveInset, darkGradient });
  console.log(`generated ${ALTERNATE_PAIR_ICONS.length} Android alternate launcher resources`);
}

export function finalizeAndroidPairIcons({
  appIconPad,
  appIconTiltDeg,
  adaptiveInset,
  darkGradient,
}) {
  writeAndroidAdaptiveResources(adaptiveInset);
  writeAndroidLauncherAliases();
  writeProvenanceManifest({ appIconPad, appIconTiltDeg, adaptiveInset, darkGradient });
  console.log('finalized Android launcher aliases, adaptive XML and provenance');
}
