import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { APP_ID } from '../../src/config.ts';
import {
  DEFAULT_ICON_PAIR,
  ICON_PAIRS,
  appIconIdForPair,
  pairIconName,
} from '../../src/app-icon-registry.ts';
import { HUE_IDS } from '../../src/state.ts';
import {
  HUE_ROTATION_PAIRS,
  SPLIT_ICON_PAD,
  verifySplitDieCutouts,
  verifySplitDiePips,
} from './split-die-geometry.ts';
import { filesUnder } from './ios-artifacts.ts';
import { pixelAt, readPngPixels } from './png-pixels.ts';

type Check = (ok: boolean, message: string) => void;
type Json = Record<string, any>;

export interface AndroidPairIconSpec {
  readonly pair: string;
  readonly p1: string;
  readonly p2: string;
  readonly icon: string;
  readonly primary: boolean;
  readonly androidAlias: string;
  readonly androidResource: string;
}

/* A new duel hue must create its native expectations automatically; tests
   never maintain a second pair registry beside src/app-icon-registry.ts. */
const title = (hue: string): string => hue[0]!.toUpperCase() + hue.slice(1);
const unorderedSpecs: readonly AndroidPairIconSpec[] = ICON_PAIRS.map((pair) => {
  const icon = appIconIdForPair(pair);
  const primary = icon === 'primary';
  return {
    pair: pairIconName(pair),
    p1: pair.p1,
    p2: pair.p2,
    icon,
    primary,
    androidAlias: `${APP_ID}.launcher.${primary ? 'Primary' : `Split${title(pair.p1)}${title(pair.p2)}`}`,
    androidResource: primary ? 'ic_launcher' : `ic_${icon.replaceAll('-', '_')}`,
  };
});
const primarySpec = unorderedSpecs.find(({ primary }) => primary)!;
export const ANDROID_PAIR_ICON_SPECS: readonly AndroidPairIconSpec[] = Object.freeze([
  primarySpec,
  ...unorderedSpecs.filter(({ primary }) => !primary),
]);
const ALTERNATES = ANDROID_PAIR_ICON_SPECS.filter(({ primary }) => !primary);
const DENSITIES: ReadonlyArray<readonly [string, number]> = [
  ['ldpi', 36], ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96],
  ['xxhdpi', 144], ['xxxhdpi', 192],
];
/* One shared themed layer: the OS tints it, so no pair needs its own. */
const MONOCHROME_RESOURCE = 'ic_launcher_monochrome';

const attr = (source: string, name: string): string | null =>
  new RegExp(`\\bandroid:${name}=["']([^"']+)["']`).exec(source)?.[1] ?? null;
const legacyFile = (res: string, spec: AndroidPairIconSpec, density: string) =>
  `${res}/mipmap-${density}/${spec.androidResource}.png`;
const foregroundFile = (res: string, spec: AndroidPairIconSpec, density: string) =>
  `${res}/mipmap-${density}/${spec.androidResource}_foreground.png`;
const adaptiveFile = (res: string, spec: AndroidPairIconSpec, api: 26 | 33) =>
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

export function verifyAndroidProfileIconResources(check: Check, res: string): void {
  check(ANDROID_PAIR_ICON_SPECS.length === 42 && ALTERNATES.length === 41
    && ANDROID_PAIR_ICON_SPECS.filter(({ primary }) => primary).length === 1
    && primarySpec.pair === pairIconName(DEFAULT_ICON_PAIR),
  'Android must derive one primary and 41 alternates from the 42 ordered colour pairs');
  for (const spec of ALTERNATES) {
    check(spec.androidAlias === `${APP_ID}.launcher.Split${title(spec.p1)}${title(spec.p2)}`
      && spec.androidResource === `ic_split_${spec.p1}_${spec.p2}`,
    `${spec.icon} must name its Android alias Split<P1><P2> and its resource ic_split_<p1>_<p2>`);
  }
  const expected = [
    ...ALTERNATES.flatMap((spec) => DENSITIES.flatMap(([density]) => [
      legacyFile(res, spec, density), foregroundFile(res, spec, density),
    ])),
    ...ALTERNATES.flatMap((spec) => ([26, 33] as const).map((api) => adaptiveFile(res, spec, api))),
  ].map((file) => file.slice(res.length + 1)).sort();
  const resources = filesUnder(res);
  const actual = resources.filter((file) => /^mipmap-[^/]+\/ic_(?:split_|profile_)/.test(file)).sort();
  check(JSON.stringify(actual) === JSON.stringify(expected),
    `Android pair-icon matrix expected ${expected.length} resources (41 pairs x 6 densities x legacy+foreground `
    + `+ 41 x 2 adaptive XML), found ${actual.length}`);
  check(!resources.some((file) => file.includes('ic_profile_')),
    'the retired per-avatar ic_profile_* launcher resources must be gone');

  for (const [density, size] of DENSITIES) {
    for (const spec of ALTERNATES) {
      const legacy = pngInfo(legacyFile(res, spec, density));
      const foreground = pngInfo(foregroundFile(res, spec, density));
      check(legacy?.width === size && legacy.height === size && legacy.colorType === 2,
        `${legacyFile(res, spec, density)} must be an opaque ${size}px RGB legacy icon`);
      check(foreground?.width === size && foreground.height === size && foreground.colorType === 6,
        `${foregroundFile(res, spec, density)} must be a transparent ${size}px RGBA foreground`);
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
        ? xml.includes('<monochrome>') && xml.includes(`@mipmap/${MONOCHROME_RESOURCE}`)
        : !xml.includes('<monochrome>'),
      `${file} must ${api === 33 ? `reference the shared @mipmap/${MONOCHROME_RESOURCE}` : 'contain no monochrome layer'}`);
    }
  }

  /* The primary launcher: six lit pips, cyan on the left, magenta on the
     right, and the shared themed layer cut through all six plus the seam. */
  const primaryForeground = `${res}/mipmap-xxxhdpi/ic_launcher_foreground.png`;
  const monochrome = `${res}/mipmap-xxxhdpi/${MONOCHROME_RESOURCE}.png`;
  if (existsSync(primaryForeground) && existsSync(monochrome)) {
    const foreground = readPngPixels(primaryForeground);
    verifySplitDiePips(check, foreground, primaryForeground, DEFAULT_ICON_PAIR, SPLIT_ICON_PAD, { coreAlpha: 250 });
    check(pixelAt(foreground, .03, .03).alpha <= 32,
      `${primaryForeground} must retain transparent outer corners`);
    verifySplitDieCutouts(check, readPngPixels(monochrome), monochrome, SPLIT_ICON_PAD);
  }
  /* A few alternates: each hue once per column across the rotation. */
  const hueProbes = HUE_ROTATION_PAIRS
    .map((pair) => ALTERNATES.find((spec) => spec.p1 === pair.p1 && spec.p2 === pair.p2))
    .filter((spec): spec is AndroidPairIconSpec => spec !== undefined);
  check(hueProbes.length === HUE_ROTATION_PAIRS.length - 1,
    'the hue-rotation probes must cover every alternate pair in the rotation');
  for (const spec of hueProbes) {
    const file = foregroundFile(res, spec, 'xxxhdpi');
    if (!existsSync(file)) continue;
    verifySplitDiePips(check, readPngPixels(file), file, { p1: spec.p1, p2: spec.p2 } as never,
      SPLIT_ICON_PAD, { coreAlpha: 250 });
  }

  const provenanceFile = 'native/profile-app-icons.manifest.json';
  const provenance: Json | null = existsSync(provenanceFile)
    ? JSON.parse(readFileSync(provenanceFile, 'utf8')) : null;
  check(provenance !== null && !ignored(provenanceFile),
    `${provenanceFile} must be a tracked source-to-native record`);
  if (!provenance) return;
  const variants = provenance.variants?.map((variant: Json) => ({
    pair: variant.pair, icon: variant.icon,
    androidAlias: variant.androidAlias, androidResource: variant.androidResource,
  }));
  const expectedVariants = ANDROID_PAIR_ICON_SPECS.map((spec) => ({
    pair: spec.pair, icon: spec.icon,
    androidAlias: spec.androidAlias, androidResource: spec.androidResource,
  }));
  check(provenance.schemaVersion === 2 && provenance.generatedBy === 'tools/appicon.mjs'
    && provenance.commands?.android === 'mise exec -- npm run native:assets:android'
    && provenance.registry?.primaryPair === pairIconName(DEFAULT_ICON_PAIR)
    && provenance.registry?.primaryIcon === 'primary' && provenance.registry?.count === 42
    && provenance.registry?.sha256 === createHash('sha256')
      .update(JSON.stringify(ICON_PAIRS)).digest('hex'),
  `${provenanceFile} must pin the generator and exact 42-pair registry`);
  check(JSON.stringify(variants) === JSON.stringify(expectedVariants),
    `${provenanceFile} must map every pair to its Android alias/resource`);
  const sources = new Set(provenance.sourceComponents?.map((entry: Json) => entry.path));
  const contracts = new Set(provenance.nativeContracts?.map((entry: Json) => entry.path));
  check(['tools/appicon.mjs', 'tools/profile-app-icons.mjs', 'src/app-icon-registry.ts', 'src/ui/die-markup.ts']
    .every((file) => sources.has(file))
    && ['native/android/app/src/main/AndroidManifest.xml',
      'native/plugins/appicon/android/src/main/java/com/appavaria/knucklebones/appicon/AppIconPlugin.java']
      .every((file) => contracts.has(file)),
  `${provenanceFile} must bind renderer/registry sources to the Android manifest/bridge`);
  const assets = new Map(provenance.assets?.map((entry: Json) => [entry.path, entry]));
  const uncovered = expected.map((file) => `${res}/${file}`).filter((file) => {
    const entry = assets.get(file) as Json | undefined;
    return !entry || entry.missing || !entry.bytes || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '');
  });
  check(uncovered.length === 0,
    `${provenanceFile} lacks hashed coverage for ${uncovered.length} Android pair-icon resources`);
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
  const hueAlternation = HUE_IDS.join('|');
  const hardCodedPairId = new RegExp(`split-(?:${hueAlternation})-(?:${hueAlternation})`);
  check(/@CapacitorPlugin\(name\s*=\s*["']AppIcon["']\)/.test(java)
    && /public void getState\(PluginCall call\)/.test(java)
    && /public void setIcon\(PluginCall call\)/.test(java)
    && ['supported', 'icon', 'changed'].every((key) => java.includes(`result.put("${key}"`)),
  `${javaFile} must expose the shared AppIcon bridge result`);
  check(java.includes('knucklebones.profileIcon') && java.includes('GET_ACTIVITIES')
    && java.includes('GET_META_DATA') && java.includes('MATCH_DISABLED_COMPONENTS')
    && java.includes('activity.targetActivity == null') && java.includes('putIfAbsent(icon, alias)')
    && !hardCodedPairId.test(java),
  `${javaFile} must discover the manifest registry rather than hard-code pair ids`);
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
    `Android manifest must contain 42 uniquely named launcher aliases, found ${aliases.length}`);
  const byIcon = new Map(aliases.map((block) => {
    const metadata = [...block.matchAll(/<meta-data\b[\s\S]*?\/>/g)]
      .map((match) => match[0]).filter((entry) => attr(entry, 'name') === 'knucklebones.profileIcon');
    return [metadata.length === 1 ? attr(metadata[0]!, 'value') : null, block];
  }));
  check(byIcon.size === 42
    && JSON.stringify([...byIcon.keys()].sort())
      === JSON.stringify(ANDROID_PAIR_ICON_SPECS.map(({ icon }) => icon).sort()),
  'Android alias metadata must contain every canonical launcher icon id exactly once');
  for (const spec of ANDROID_PAIR_ICON_SPECS) {
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
