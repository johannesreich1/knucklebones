import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { APP_ID } from '../../src/config.ts';
import {
  DEFAULT_AVATAR,
  PROFILE_AVATARS,
  appIconIdForAvatar,
  parseAvatar,
} from '../../src/profile-avatar.ts';
import { diePipCells } from '../../src/ui/die-markup.ts';
import { filesUnder } from './ios-artifacts.ts';
import { pixelAt, readPngPixels, rgbDistance } from './png-pixels.ts';

type Check = (ok: boolean, message: string) => void;
type Json = Record<string, any>;

export interface AndroidProfileIconSpec {
  readonly avatar: string;
  readonly face: number;
  readonly hue: string;
  readonly icon: string;
  readonly primary: boolean;
  readonly androidAlias: string;
  readonly androidResource: string;
}

/* A new profile avatar must create a native expectation automatically; tests
   never maintain a seventh face/hue registry beside the product owner. */
const unorderedSpecs: readonly AndroidProfileIconSpec[] = PROFILE_AVATARS.map((avatar) => {
  const { face, hue } = parseAvatar(avatar);
  const primary = avatar === DEFAULT_AVATAR;
  const icon = appIconIdForAvatar(avatar);
  const titleHue = hue[0]!.toUpperCase() + hue.slice(1);
  return {
    avatar, face, hue, icon, primary,
    androidAlias: `${APP_ID}.launcher.${primary ? 'Primary' : `Die${face}${titleHue}`}`,
    androidResource: primary ? 'ic_launcher' : `ic_profile_${icon.replaceAll('-', '_')}`,
  };
});
const primarySpec = unorderedSpecs.find(({ primary }) => primary)!;
export const ANDROID_PROFILE_ICON_SPECS: readonly AndroidProfileIconSpec[] = Object.freeze([
  primarySpec,
  ...unorderedSpecs.filter(({ primary }) => !primary),
]);
const ALTERNATES = ANDROID_PROFILE_ICON_SPECS.filter(({ primary }) => !primary);
const DENSITIES: ReadonlyArray<readonly [string, number]> = [
  ['ldpi', 36], ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96],
  ['xxhdpi', 144], ['xxxhdpi', 192],
];

const attr = (source: string, name: string): string | null =>
  new RegExp(`\\bandroid:${name}=["']([^"']+)["']`).exec(source)?.[1] ?? null;
const legacyFile = (res: string, spec: AndroidProfileIconSpec, density: string) =>
  `${res}/mipmap-${density}/${spec.androidResource}.png`;
const foregroundFile = (res: string, spec: AndroidProfileIconSpec, density: string) =>
  `${res}/mipmap-${density}/${spec.androidResource}_foreground.png`;
const monochromeFile = (res: string, face: number, density: string) =>
  `${res}/mipmap-${density}/ic_profile_face_${face}_monochrome.png`;
const adaptiveFile = (res: string, spec: AndroidProfileIconSpec, api: 26 | 33) =>
  `${res}/mipmap-anydpi-v${api}/${spec.androidResource}.xml`;

function pngInfo(file: string): { width: number; height: number; colorType: number } | null {
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  if (bytes.length < 26 || bytes.subarray(1, 4).toString('ascii') !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25]! };
}

function ignored(file: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', file]);
    return true;
  } catch { return false; }
}

function pipPoint(cell: number): readonly [number, number] {
  const positions = [.26, .5, .74];
  const x = .15 + positions[cell % 3]! * .7;
  const y = .15 + positions[Math.floor(cell / 3)]! * .7;
  const angle = 7 * Math.PI / 180;
  const dx = x - .5;
  const dy = y - .5;
  return [
    .5 + Math.cos(angle) * dx - Math.sin(angle) * dy,
    .5 + Math.sin(angle) * dx + Math.cos(angle) * dy,
  ];
}

function hueRgb(hue: string) {
  const tokens = readFileSync('src/styles/foundations/tokens.css', 'utf8');
  const match = new RegExp(`--${hue}:#([0-9a-f]{6})`, 'i').exec(tokens);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return { red: value >> 16, green: (value >> 8) & 0xff, blue: value & 0xff, alpha: 255 };
}

function minimumOpaqueDistance(
  png: ReturnType<typeof readPngPixels>,
  target: NonNullable<ReturnType<typeof hueRgb>>,
): number {
  let closest = Infinity;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const pixel = png.pixel(x, y);
      if (pixel.alpha >= 160) closest = Math.min(closest, rgbDistance(pixel, target));
    }
  }
  return closest;
}

export function verifyAndroidProfileIconResources(check: Check, res: string): void {
  check(ANDROID_PROFILE_ICON_SPECS.length === 42 && ALTERNATES.length === 41
    && ANDROID_PROFILE_ICON_SPECS.filter(({ primary }) => primary).length === 1,
  'Android must derive one primary and 41 alternates from the 42 profile avatars');
  const expected = [
    ...ALTERNATES.flatMap((spec) => DENSITIES.flatMap(([density]) => [
      legacyFile(res, spec, density), foregroundFile(res, spec, density),
    ])),
    ...[1, 2, 3, 4, 5, 6].flatMap((face) => DENSITIES.map(([density]) =>
      monochromeFile(res, face, density))),
    ...ALTERNATES.flatMap((spec) => ([26, 33] as const).map((api) => adaptiveFile(res, spec, api))),
  ].map((file) => file.slice(res.length + 1)).sort();
  const actual = filesUnder(res).filter((file) =>
    /^mipmap-[^/]+\/ic_profile_(?:die_|face_)/.test(file)).sort();
  check(JSON.stringify(actual) === JSON.stringify(expected),
    `Android profile-icon matrix expected ${expected.length} resources, found ${actual.length}`);

  for (const [density, size] of DENSITIES) {
    for (const spec of ALTERNATES) {
      const legacy = pngInfo(legacyFile(res, spec, density));
      const foreground = pngInfo(foregroundFile(res, spec, density));
      check(legacy?.width === size && legacy.height === size && legacy.colorType === 2,
        `${legacyFile(res, spec, density)} must be an opaque ${size}px RGB legacy icon`);
      check(foreground?.width === size && foreground.height === size && foreground.colorType === 6,
        `${foregroundFile(res, spec, density)} must be a transparent ${size}px RGBA foreground`);
    }
    for (let face = 1; face <= 6; face++) {
      const info = pngInfo(monochromeFile(res, face, density));
      check(info?.width === size && info.height === size && info.colorType === 6,
        `${monochromeFile(res, face, density)} must be a transparent ${size}px themed cutout`);
    }
  }
  for (const spec of ALTERNATES) {
    for (const api of [26, 33] as const) {
      const file = adaptiveFile(res, spec, api);
      const xml = existsSync(file) ? readFileSync(file, 'utf8') : '';
      check(xml.includes('<background android:drawable="@drawable/ic_launcher_background" />')
        && xml.includes(`@mipmap/${spec.androidResource}_foreground`),
      `${file} must combine the shared gradient with its exact foreground`);
      check(api === 33
        ? xml.includes('<monochrome>') && xml.includes(`@mipmap/ic_profile_face_${spec.face}_monochrome`)
        : !xml.includes('<monochrome>'),
      `${file} must ${api === 33 ? 'include face monochrome' : 'contain no monochrome layer'}`);
    }
  }

  const colourProbes = [1, 2, 3, 4, 5, 6].map((face) => face === 5
    ? `${res}/mipmap-xxxhdpi/ic_launcher_foreground.png`
    : foregroundFile(res, ALTERNATES.find((spec) => spec.face === face && spec.hue === 'cy')!, 'xxxhdpi'));
  const monoProbes = [1, 2, 3, 4, 5, 6].map((face) => monochromeFile(res, face, 'xxxhdpi'));
  if ([...colourProbes, ...monoProbes].every(existsSync)) {
    for (let face = 1; face <= 6; face++) {
      const colour = readPngPixels(colourProbes[face - 1]!);
      const mono = readPngPixels(monoProbes[face - 1]!);
      const cells = new Set(diePipCells(face));
      let lit = 0;
      let cut = 0;
      for (let cell = 0; cell < 9; cell++) {
        const [x, y] = pipPoint(cell);
        const colourPixel = pixelAt(colour, x, y);
        const monoPixel = pixelAt(mono, x, y);
        if (colourPixel.alpha >= 200) lit++;
        if (monoPixel.alpha <= 8) cut++;
        check(cells.has(cell)
          ? colourPixel.alpha >= 200 && monoPixel.alpha <= 8
          : colourPixel.alpha <= 96 && monoPixel.alpha >= 240,
        `Android face ${face} cell ${cell} lost its luminous-pip/cutout anatomy`);
      }
      check(lit === face && cut === face,
        `Android face ${face} needs ${face} visible pips/cutouts, found ${lit}/${cut}`);
      check(pixelAt(colour, .03, .03).alpha <= 32 && pixelAt(mono, .03, .03).alpha === 0,
        `Android face ${face} layers must retain transparent outer corners`);
    }
  }
  const hueProbes = ALTERNATES.filter(({ face }) => face === 1);
  if (hueProbes.length === 7
    && hueProbes.every((spec) => existsSync(foregroundFile(res, spec, 'xxxhdpi')))) {
    for (const spec of hueProbes) {
      const target = hueRgb(spec.hue);
      const png = readPngPixels(foregroundFile(res, spec, 'xxxhdpi'));
      const distance = target ? minimumOpaqueDistance(png, target) : Infinity;
      check(target !== null && distance <= 18,
        `Android ${spec.icon} lacks its ${spec.hue} pixels; nearest RGB distance ${distance}`);
    }
  }

  const provenanceFile = 'native/profile-app-icons.manifest.json';
  const provenance: Json | null = existsSync(provenanceFile)
    ? JSON.parse(readFileSync(provenanceFile, 'utf8')) : null;
  check(provenance !== null && !ignored(provenanceFile),
    `${provenanceFile} must be a tracked source-to-native record`);
  if (!provenance) return;
  const variants = provenance.variants?.map((variant: Json) => ({
    avatar: variant.avatar, icon: variant.icon,
    androidAlias: variant.androidAlias, androidResource: variant.androidResource,
  }));
  const expectedVariants = ANDROID_PROFILE_ICON_SPECS.map((spec) => ({
    avatar: spec.avatar, icon: spec.icon,
    androidAlias: spec.androidAlias, androidResource: spec.androidResource,
  }));
  check(provenance.schemaVersion === 1 && provenance.generatedBy === 'tools/appicon.mjs'
    && provenance.commands?.android === 'mise exec -- npm run native:assets:android'
    && provenance.registry?.primaryAvatar === DEFAULT_AVATAR
    && provenance.registry?.primaryIcon === 'primary' && provenance.registry?.count === 42
    && provenance.registry?.sha256 === createHash('sha256')
      .update(JSON.stringify(PROFILE_AVATARS)).digest('hex'),
  `${provenanceFile} must pin the generator and exact 42-avatar registry`);
  check(JSON.stringify(variants) === JSON.stringify(expectedVariants),
    `${provenanceFile} must map every avatar to its Android alias/resource`);
  const sources = new Set(provenance.sourceComponents?.map((entry: Json) => entry.path));
  const contracts = new Set(provenance.nativeContracts?.map((entry: Json) => entry.path));
  check(['tools/appicon.mjs', 'tools/profile-app-icons.mjs', 'src/profile-avatar.ts', 'src/ui/die-markup.ts']
    .every((file) => sources.has(file))
    && ['native/android/app/src/main/AndroidManifest.xml',
      'native/plugins/appicon/android/src/main/java/com/appavaria/knucklebones/appicon/AppIconPlugin.java']
      .every((file) => contracts.has(file)),
  `${provenanceFile} must bind renderer/profile sources to the Android manifest/bridge`);
  const assets = new Map(provenance.assets?.map((entry: Json) => [entry.path, entry]));
  const uncovered = expected.map((file) => `${res}/${file}`).filter((file) => {
    const entry = assets.get(file) as Json | undefined;
    return !entry || entry.missing || !entry.bytes || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '');
  });
  check(uncovered.length === 0,
    `${provenanceFile} lacks hashed coverage for ${uncovered.length} Android profile resources`);
}

export function verifyAndroidProfileIconShell(
  check: Check,
  nativePackage: Json,
  nativeLock: Json,
  manifest: string,
  mainActivity: string,
): void {
  const root = 'native/plugins/appicon';
  const packageFile = `${root}/package.json`;
  const pluginPackage = JSON.parse(readFileSync(packageFile, 'utf8'));
  const packageName = 'knucklebones-app-icon';
  check(nativePackage.dependencies?.[packageName] === 'file:plugins/appicon'
    && nativeLock.packages?.['']?.dependencies?.[packageName] === 'file:plugins/appicon'
    && nativeLock.packages?.[`node_modules/${packageName}`]?.resolved === 'plugins/appicon'
    && nativeLock.packages?.[`node_modules/${packageName}`]?.link === true
    && nativeLock.packages?.['plugins/appicon']?.name === packageName
    && nativeLock.packages?.['plugins/appicon']?.version === pluginPackage.version,
  'native package and lock must install the tracked local AppIcon plugin exactly');
  check(pluginPackage.name === packageName && pluginPackage.capacitorPlugin === true
    && pluginPackage.capacitor?.android?.src === 'android' && pluginPackage.files?.includes('android'),
  `${packageFile} must expose its Android Capacitor source`);
  const gradle = readFileSync(`${root}/android/build.gradle`, 'utf8');
  const libraryManifest = readFileSync(`${root}/android/src/main/AndroidManifest.xml`, 'utf8');
  check(/com\.android\.library/.test(gradle) && /com\.appavaria\.knucklebones\.appicon/.test(gradle)
    && /compileSdk[^\n]*36/.test(gradle) && /minSdkVersion[^\n]*24/.test(gradle)
    && /targetSdkVersion[^\n]*36/.test(gradle)
    && (gradle.match(/JavaVersion\.VERSION_21/g) ?? []).length === 2
    && /implementation project\(['"]:capacitor-android['"]\)/.test(gradle),
  'AppIcon Android library must preserve the shell SDK/Java/Capacitor contract');
  check(/<manifest\b/.test(libraryManifest)
    && !/<(?:application|activity|service|receiver|provider|uses-permission)\b/.test(libraryManifest),
  'AppIcon library manifest must remain empty');

  const javaFile = `${root}/android/src/main/java/`
    + 'com/appavaria/knucklebones/appicon/AppIconPlugin.java';
  const java = readFileSync(javaFile, 'utf8');
  const enable = java.indexOf('setComponentState(selected, selectedState(selected))');
  const disable = java.indexOf('for (Alias alias : aliases.values())', enable);
  check(/@CapacitorPlugin\(name\s*=\s*["']AppIcon["']\)/.test(java)
    && /public void getState\(PluginCall call\)/.test(java)
    && /public void setIcon\(PluginCall call\)/.test(java)
    && ['supported', 'icon', 'changed'].every((key) => java.includes(`result.put("${key}"`)),
  `${javaFile} must expose the shared AppIcon bridge result`);
  check(java.includes('knucklebones.profileIcon') && java.includes('GET_ACTIVITIES')
    && java.includes('GET_META_DATA') && java.includes('MATCH_DISABLED_COMPONENTS')
    && java.includes('activity.targetActivity == null') && java.includes('putIfAbsent(icon, alias)')
    && !/die-[1-6]-(?:cy|mg|gold|green|violet|orange|blue)/.test(java),
  `${javaFile} must discover the manifest registry rather than hard-code it`);
  check((java.match(/synchronized \(COMPONENT_STATE_LOCK\)/g) ?? []).length >= 2
    && java.includes('Build.VERSION_CODES.TIRAMISU') && java.includes('setComponentEnabledSettings(settings)')
    && java.includes('PackageManager.ComponentEnabledSetting') && java.includes('DONT_KILL_APP')
    && /@TargetApi\(Build\.VERSION_CODES\.TIRAMISU\)\s+private void applyAtomicSelection/.test(java)
    && enable >= 0 && disable > enable && java.includes('COMPONENT_ENABLED_STATE_DISABLED')
    && java.includes('isSoleSelected(aliases, selected)'),
  `${javaFile} must annotate, serialize, and verify atomic API-33 and enable-first legacy changes`);
  for (const code of ['INVALID_ICON', 'ICON_CONFIGURATION_INVALID', 'ICON_STATE_INVALID', 'ICON_UPDATE_FAILED']) {
    check(java.includes(`"${code}"`), `${javaFile} is missing stable rejection code ${code}`);
  }
  check(/AppIconPlugin/.test(mainActivity)
    && mainActivity.indexOf('registerPlugin(AppIconPlugin.class)') >= 0
    && mainActivity.indexOf('super.onCreate(savedInstanceState)')
      > mainActivity.indexOf('registerPlugin(AppIconPlugin.class)'),
  'MainActivity must register AppIconPlugin before Capacitor creates its bridge');

  const aliases = [...manifest.matchAll(/<activity-alias\b[\s\S]*?<\/activity-alias>/g)]
    .map((match) => match[0]);
  const main = [...manifest.matchAll(/<activity(?!-alias)\b(?:[^>]*?\/>|[\s\S]*?<\/activity>)/g)]
    .map((match) => match[0]).find((block) => attr(block, 'name') === '.MainActivity');
  check(!!main && manifest.indexOf(main) < manifest.indexOf(aliases[0] ?? '')
    && !main.includes('android.intent.action.MAIN') && !main.includes('android.intent.category.LAUNCHER'),
  'MainActivity must be declared before its aliases and delegate every launcher filter to them');
  check(aliases.length === 42 && new Set(aliases.map((block) => attr(block, 'name'))).size === 42,
    `Android manifest must contain 42 uniquely named profile aliases, found ${aliases.length}`);
  const byIcon = new Map(aliases.map((block) => {
    const metadata = [...block.matchAll(/<meta-data\b[\s\S]*?\/>/g)]
      .map((match) => match[0]).filter((entry) => attr(entry, 'name') === 'knucklebones.profileIcon');
    return [metadata.length === 1 ? attr(metadata[0]!, 'value') : null, block];
  }));
  check(byIcon.size === 42
    && JSON.stringify([...byIcon.keys()].sort())
      === JSON.stringify(ANDROID_PROFILE_ICON_SPECS.map(({ icon }) => icon).sort()),
  'Android alias metadata must contain every canonical profile icon exactly once');
  for (const spec of ANDROID_PROFILE_ICON_SPECS) {
    const block = byIcon.get(spec.icon) ?? '';
    check(attr(block, 'name') === spec.androidAlias.slice(APP_ID.length)
      && attr(block, 'enabled') === String(spec.primary)
      && attr(block, 'exported') === 'true'
      && attr(block, 'icon') === `@mipmap/${spec.androidResource}`
      && attr(block, 'label') === '@string/app_name'
      && attr(block, 'targetActivity') === '.MainActivity'
      && (block.match(/android\.intent\.action\.MAIN/g) ?? []).length === 1
      && (block.match(/android\.intent\.category\.LAUNCHER/g) ?? []).length === 1,
    `Android alias ${spec.icon} does not match its derived component/resource/default contract`);
  }
  check((manifest.match(/android\.intent\.action\.MAIN/g) ?? []).length === 42
    && (manifest.match(/android\.intent\.category\.LAUNCHER/g) ?? []).length === 42,
  'Android manifest must expose no launcher filters beyond the 42 metadata aliases');
}
