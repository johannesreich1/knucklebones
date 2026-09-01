import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  APP_ID,
  GAME_NAME,
  NATIVE_APP_NAME,
  NATIVE_STORE_NAME,
} from '../../src/config.ts';
import { LOCALE_REGISTRY } from '../../src/i18n/locale.ts';
import { sameBytes } from './ios-artifacts.ts';
import { alphaBounds, colorSpread, pixelAt, readPngPixels, rgbDistance } from './png-pixels.ts';

type Check = (ok: boolean, message: string) => void;

const PODFILE = 'native/ios/App/Podfile';
const CONFIG = 'native/capacitor.config.json';
const XCODE = 'native/ios/App/App.xcodeproj/project.pbxproj';
const INFO = 'native/ios/App/App/Info.plist';
const ENTITLEMENTS = 'native/ios/App/App/App.entitlements';
const APP_DELEGATE = 'native/ios/App/App/AppDelegate.swift';
const SCENE_DELEGATE = 'native/ios/App/App/SceneDelegate.swift';
const LAUNCH_SCREEN = 'native/ios/App/App/Base.lproj/LaunchScreen.storyboard';
const APP_ICON_CATALOG = 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json';
const SPLASH_CATALOG = 'native/ios/App/App/Assets.xcassets/Splash.imageset/Contents.json';
const GC_PODSPEC = 'native/plugins/gamecenter/KnucklebonesGameCenter.podspec';
const APPLE_IDENTITY = 'src/online/identity/apple-identity.ts';
const GAME_CENTER_COORDINATOR = 'src/native/game-center.ts';
const GC_AUTH = 'supabase/functions/gc-auth/index.ts';

export function verifyIosShellContract(check: Check): {
  xcodeIds: string[];
  gcBundle: string | null;
} {
  const capacitor = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const podfile = readFileSync(PODFILE, 'utf8');

  /* TypeScript is the canonical source. Capacitor and Xcode cannot import it,
     and gc-auth is deployed as an isolated Deno bundle, so those unavoidable
     copies are a strict contract rather than trusted literals. */
  check(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/.test(APP_ID),
    `src/config.ts APP_ID=${JSON.stringify(APP_ID)} is not a shippable reverse-DNS id`);
  check(capacitor.appId === APP_ID,
    `${CONFIG} appId=${JSON.stringify(capacitor.appId)} differs from src/config.ts APP_ID=${APP_ID}`);
  check(capacitor.appName === NATIVE_APP_NAME,
    `${CONFIG} appName=${JSON.stringify(capacitor.appName)} differs from src/config.ts `
    + `NATIVE_APP_NAME=${JSON.stringify(NATIVE_APP_NAME)}`);
  check(NATIVE_APP_NAME === GAME_NAME && NATIVE_STORE_NAME === 'Knucklebones Neon',
    'installed native label must stay Knucklebones while the store listing stays Knucklebones Neon');

  const xcode = readFileSync(XCODE, 'utf8');
  const xcodeIds = [...xcode.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\s]+)\s*;/g)]
    .map((match) => match[1]);
  check(xcodeIds.length >= 2,
    `${XCODE} exposes ${xcodeIds.length} PRODUCT_BUNDLE_IDENTIFIER values; expected Debug and Release`);
  for (const id of xcodeIds) {
    check(id === APP_ID, `${XCODE} uses PRODUCT_BUNDLE_IDENTIFIER=${id}, expected ${APP_ID}`);
  }
  const appBuildConfigurations = [...xcode.matchAll(
    /\t\t[A-F0-9]{24} \/\* (Debug|Release) \*\/ = \{\n([\s\S]*?)\n\t\t\};/g,
  )]
    .map((match) => ({ name: match[1], body: match[2] }))
    .filter(({ body }) => new RegExp(
      `PRODUCT_BUNDLE_IDENTIFIER\\s*=\\s*${APP_ID.replaceAll('.', '\\.')}\\s*;`,
    ).test(body));
  check(JSON.stringify(appBuildConfigurations.map(({ name }) => name).sort()) === JSON.stringify(['Debug', 'Release']),
    `${XCODE} must expose exactly one App-target Debug and Release build configuration`);
  for (const configuration of appBuildConfigurations) {
    const signingEntitlements = [...configuration.body.matchAll(
      /CODE_SIGN_ENTITLEMENTS\s*=\s*([^;\s]+)\s*;/g,
    )].map((match) => match[1]);
    check(JSON.stringify(signingEntitlements) === JSON.stringify(['App/App.entitlements']),
      `${XCODE} App ${configuration.name} must reference App/App.entitlements exactly once; `
      + `found ${JSON.stringify(signingEntitlements)}`);
    check(/CODE_SIGN_STYLE\s*=\s*Automatic\s*;/.test(configuration.body)
      && /DEVELOPMENT_TEAM\s*=\s*4RKFC79X48\s*;/.test(configuration.body),
      `${XCODE} App ${configuration.name} must retain automatic signing on team 4RKFC79X48`);
  }
  const allSigningEntitlements = [...xcode.matchAll(/CODE_SIGN_ENTITLEMENTS\s*=\s*([^;\s]+)\s*;/g)]
    .map((match) => match[1]);
  check(allSigningEntitlements.length === 2,
    `${XCODE} must not attach signing entitlements outside the App target Debug and Release configurations`);
  for (const capability of ['com.apple.GameCenter', 'com.apple.SignInWithApple']) {
    const declarations = [...xcode.matchAll(new RegExp(
      `${capability.replaceAll('.', '\\.')}\\s*=\\s*\\{\\s*enabled\\s*=\\s*1;\\s*\\};`,
      'g',
    ))];
    check(declarations.length === 1,
      `${XCODE} must declare ${capability} exactly once as an enabled App target SystemCapability`);
  }
  check(/lastKnownFileType\s*=\s*text\.plist\.entitlements;\s*path\s*=\s*App\.entitlements;/.test(xcode),
    `${XCODE} must expose App.entitlements as the target's entitlements file reference`);

  const entitlements = readFileSync(ENTITLEMENTS, 'utf8');
  const entitlementDictionary = (entitlements.match(/<dict>([\s\S]*?)<\/dict>/) || [])[1] ?? '';
  const normalizedEntitlementPayload = entitlementDictionary
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, '');
  const expectedEntitlementPayload = '<key>com.apple.developer.applesignin</key>'
    + '<array><string>Default</string></array>'
    + '<key>com.apple.developer.game-center</key><true/>';
  check(normalizedEntitlementPayload === expectedEntitlementPayload,
    `${ENTITLEMENTS} must contain only default Sign in with Apple and enabled Game Center; `
    + `found ${normalizedEntitlementPayload}`);

  const info = readFileSync(INFO, 'utf8');
  check(info.includes('<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>'),
    `${INFO} must derive CFBundleIdentifier from Xcode's PRODUCT_BUNDLE_IDENTIFIER`);
  const displayName = (info.match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/) || [])[1] ?? null;
  check(displayName === NATIVE_APP_NAME,
    `${INFO} CFBundleDisplayName=${JSON.stringify(displayName)} differs from src/config.ts `
    + `NATIVE_APP_NAME=${JSON.stringify(NATIVE_APP_NAME)}`);
  const localizationBlock = (info.match(/<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/) || [])[1] ?? '';
  const localizations = [...localizationBlock.matchAll(/<string>([^<]+)<\/string>/g)]
    .map((match) => match[1]);
  const expectedLocalizations = LOCALE_REGISTRY.map(({ languageTag }) => languageTag);
  check(JSON.stringify(localizations) === JSON.stringify(expectedLocalizations),
    `${INFO} must declare the registry-owned runtime language tags `
    + `${expectedLocalizations.join(', ')} in registry order; `
    + `found ${JSON.stringify(localizations)}`);

  const appleIdentity = readFileSync(APPLE_IDENTITY, 'utf8');
  check(/getPlatform\(\)\s*!==\s*['"]ios['"]/.test(appleIdentity)
    && /scopes:\s*\[['"]EMAIL['"]\]/.test(appleIdentity)
    && !/FULL_NAME/.test(appleIdentity.slice(appleIdentity.indexOf('function createAppleIdentity'))),
    `${APPLE_IDENTITY} must keep Apple account sign-in iOS-only and request only email`);
  const coordinator = readFileSync(GAME_CENTER_COORDINATOR, 'utf8');
  check(/initializeGameCenter/.test(coordinator)
    && /authStateChanged/.test(coordinator)
    && /fetchIdentityProof/.test(coordinator)
    && !/from\s+['"][^'"]*(?:client|identity)['"]/.test(coordinator),
    `${GAME_CENTER_COORDINATOR} must own lifecycle Game Center state without owning Supabase sessions`);

  const gcAuth = readFileSync(GC_AUTH, 'utf8');
  const gcBundle = (gcAuth.match(/const\s+BUNDLE_ID\s*=\s*["']([^"']+)["']/) || [])[1] ?? null;
  check(gcBundle === APP_ID,
    `${GC_AUTH} verifies Game Center bundle ${JSON.stringify(gcBundle)}, expected ${APP_ID}`);

  const appDelegate = readFileSync(APP_DELEGATE, 'utf8');
  const sceneDelegate = existsSync(SCENE_DELEGATE) ? readFileSync(SCENE_DELEGATE, 'utf8') : '';
  check(/func application\(_ application: UIApplication,\s*configurationForConnecting connectingSceneSession: UISceneSession,\s*options: UIScene\.ConnectionOptions\) -> UISceneConfiguration/.test(appDelegate)
    && /UISceneConfiguration\(name: ["']Default Configuration["'],\s*sessionRole: connectingSceneSession\.role\)/.test(appDelegate)
    && /config\.delegateClass\s*=\s*SceneDelegate\.self/.test(appDelegate),
    `${APP_DELEGATE} must return the Default Configuration backed by SceneDelegate`);

  check(/class SceneDelegate:\s*UIResponder,\s*UIWindowSceneDelegate/.test(sceneDelegate)
    && /window\s*=\s*UIWindow\(windowScene:\s*windowScene\)/.test(sceneDelegate)
    && /window\?\.rootViewController\s*=\s*CAPBridgeViewController\(\)/.test(sceneDelegate)
    && /window\?\.makeKeyAndVisible\(\)/.test(sceneDelegate),
    `${SCENE_DELEGATE} must own the UIWindow and install Capacitor's bridge view controller`);
  check(/SceneDelegateProxy\.shared\.scene\(scene,\s*willConnectTo:\s*session,\s*options:\s*connectionOptions\)/.test(sceneDelegate)
    && /SceneDelegateProxy\.shared\.scene\(scene,\s*openURLContexts:\s*URLContexts\)/.test(sceneDelegate)
    && /SceneDelegateProxy\.shared\.scene\(scene,\s*continue:\s*userActivity\)/.test(sceneDelegate),
    `${SCENE_DELEGATE} must forward connection, URL, and universal-link callbacks to Capacitor 8.5`);

  check(/<key>UIApplicationSceneManifest<\/key>\s*<dict>[\s\S]*?<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\/>[\s\S]*?<key>UIWindowSceneSessionRoleApplication<\/key>[\s\S]*?<key>UISceneConfigurationName<\/key>\s*<string>Default Configuration<\/string>[\s\S]*?<key>UISceneDelegateClassName<\/key>\s*<string>\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate<\/string>[\s\S]*?<key>UISceneStoryboardFile<\/key>\s*<string>Main<\/string>/.test(info),
    `${INFO} must declare Capacitor 8.5's single-scene Default Configuration`);

  const sceneFileRef = (xcode.match(/([A-F0-9]{24}) \/\* SceneDelegate\.swift \*\/ = \{isa = PBXFileReference;[^}]*path = SceneDelegate\.swift;/) || [])[1] ?? null;
  const sceneBuildRef = (xcode.match(/([A-F0-9]{24}) \/\* SceneDelegate\.swift in Sources \*\/ = \{isa = PBXBuildFile;[^}]*SceneDelegate\.swift/) || [])[1] ?? null;
  const occurrences = (source: string, value: string | null) => value
    ? source.split(value).length - 1
    : 0;
  check(sceneFileRef !== null && occurrences(xcode, sceneFileRef) >= 3,
    `${XCODE} must register SceneDelegate.swift as a file reference and in the App group`);
  check(sceneBuildRef !== null && occurrences(xcode, sceneBuildRef) === 2,
    `${XCODE} must register SceneDelegate.swift exactly once in the App target Sources phase`);

  const podPlatform = (podfile.match(/^platform :ios, ['"]([^'"]+)['"]$/m) || [])[1] ?? null;
  const xcodeDeploymentTargets = [...xcode.matchAll(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*([^;\s]+)\s*;/g)]
    .map((match) => match[1]);
  const gcPodspec = readFileSync(GC_PODSPEC, 'utf8');
  const gcDeploymentTarget = (gcPodspec.match(/s\.ios\.deployment_target\s*=\s*['"]([^'"]+)['"]/) || [])[1] ?? null;
  check(podPlatform === '15.0', `${PODFILE} platform is iOS ${podPlatform}, expected 15.0`);
  check(xcodeDeploymentTargets.length >= 4 && xcodeDeploymentTargets.every((target) => target === '15.0'),
    `${XCODE} deployment targets must all be 15.0; found ${JSON.stringify(xcodeDeploymentTargets)}`);
  check(gcDeploymentTarget === '15.0',
    `${GC_PODSPEC} deployment target is ${gcDeploymentTarget}, expected 15.0`);

  const nativeAssets = [
    { path: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', width: 1024, height: 1024 },
    { path: 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-Dark-512@2x.png', width: 1024, height: 1024 },
    { path: 'native/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png', width: 2732, height: 2732 },
    { path: 'native/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png', width: 2732, height: 2732 },
    { path: 'native/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png', width: 2732, height: 2732 },
  ];
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const asset of nativeAssets) {
    check(existsSync(asset.path), `${asset.path} is absent; branded native assets must ship from a clean checkout`);
    if (!existsSync(asset.path)) continue;
    const bytes = readFileSync(asset.path);
    const validPng = bytes.length >= 24
      && bytes.subarray(0, 8).equals(pngSignature)
      && bytes.subarray(12, 16).toString('ascii') === 'IHDR';
    check(validPng, `${asset.path} is not a valid PNG with an IHDR header`);
    if (validPng) {
      check(bytes.readUInt32BE(16) === asset.width && bytes.readUInt32BE(20) === asset.height,
        `${asset.path} is ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}, `
        + `expected ${asset.width}x${asset.height}`);
      check(bytes.length > 4096, `${asset.path} is suspiciously small for a branded ${asset.width}px asset`);
    }
    const ignoreCheck = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', asset.path]);
    check(ignoreCheck.status === 1, `${asset.path} is still covered by a git ignore rule`);
  }

  const iconCatalog = JSON.parse(readFileSync(APP_ICON_CATALOG, 'utf8'));
  const splashCatalog = JSON.parse(readFileSync(SPLASH_CATALOG, 'utf8'));
  const iconNames = new Set<string>(iconCatalog.images?.map((image: { filename?: string }) => image.filename).filter(Boolean));
  const splashNames = new Set<string>(splashCatalog.images?.map((image: { filename?: string }) => image.filename).filter(Boolean));
  for (const name of ['AppIcon-512@2x.png', 'AppIcon-Dark-512@2x.png']) {
    check(iconNames.has(name), `${APP_ICON_CATALOG} does not reference ${name}`);
  }
  const anyIcon = iconCatalog.images?.find(
    (image: { filename?: string }) => image.filename === 'AppIcon-512@2x.png',
  );
  const darkIcon = iconCatalog.images?.find(
    (image: { filename?: string }) => image.filename === 'AppIcon-Dark-512@2x.png',
  );
  check(Array.isArray(anyIcon?.appearances) === false,
    `${APP_ICON_CATALOG} Any icon must remain the unqualified light/fallback rendition`);
  check(JSON.stringify(darkIcon?.appearances) === JSON.stringify([{ appearance: 'luminosity', value: 'dark' }]),
    `${APP_ICON_CATALOG} dark icon must be the luminosity=dark rendition`);
  for (const name of ['splash-2732x2732-2.png', 'splash-2732x2732-1.png', 'splash-2732x2732.png']) {
    check(splashNames.has(name), `${SPLASH_CATALOG} does not reference ${name}`);
  }
  check(!sameBytes(nativeAssets[0].path, nativeAssets[1].path),
    'the iOS light and dark app-icon appearances must remain distinct');

  const lightPixels = readPngPixels(nativeAssets[0].path);
  const darkPixels = readPngPixels(nativeAssets[1].path);
  check(lightPixels.colorType === 2 && !lightPixels.hasTransparency,
    'the iOS Any/light app icon must remain an opaque RGB PNG');
  check(darkPixels.colorType === 6 && darkPixels.hasTransparency,
    'the iOS Dark app icon must carry alpha so the system-provided background can show through');
  check(pixelAt(darkPixels, .03, .03).alpha === 0,
    'the iOS Dark app icon canvas must be transparent for Apple\'s System Dark background');

  const darkInkBounds = alphaBounds(darkPixels);
  const darkInkWidth = darkInkBounds
    ? (darkInkBounds.right - darkInkBounds.left + 1) / darkPixels.width
    : 0;
  check(darkInkBounds !== null && darkInkWidth >= .68 && darkInkWidth <= .72,
    `the iOS die should occupy about 70% of the icon after the requested size reduction, found ${darkInkWidth}`);
  for (const [x, y] of [[.332, .332], [.668, .332], [.5, .5], [.332, .668], [.668, .668]]) {
    for (const dx of [-.025, 0, .025]) {
      for (const dy of [-.025, 0, .025]) {
        check(pixelAt(darkPixels, x + dx, y + dy).alpha === 0,
          `the iOS Dark die pip around ${x},${y} must be a substantial transparent cutout`);
        const lightPip = pixelAt(lightPixels, x + dx, y + dy);
        const lightGround = pixelAt(lightPixels, .04, y + dy);
        check(rgbDistance(lightPip, lightGround) <= 3,
          `the iOS Any/light die pip around ${x},${y} must reveal its background gradient`);
      }
    }
  }
  const dieMagenta = pixelAt(darkPixels, .28, .2);
  const dieCyan = pixelAt(darkPixels, .72, .8);
  check(dieMagenta.red - dieMagenta.green >= 100
    && dieCyan.blue - dieCyan.red >= 100
    && rgbDistance(dieMagenta, dieCyan) >= 100,
  'the smaller iOS die must remain fully colored from its magenta edge to its cyan edge');
  const lightGroundTop = pixelAt(lightPixels, .04, .04);
  const lightGroundBottom = pixelAt(lightPixels, .04, .96);
  check(rgbDistance(lightGroundTop, lightGroundBottom) >= 10
    && Math.min(lightGroundTop.red, lightGroundTop.green, lightGroundTop.blue) >= 225
    && Math.min(lightGroundBottom.red, lightGroundBottom.green, lightGroundBottom.blue) >= 210,
  'the iOS Any/light icon must use a subtle light system-style gradient rather than a flat canvas');
  const splashPixels = readPngPixels(nativeAssets[2].path);
  const splashTop = pixelAt(splashPixels, .04, .04);
  const splashBottom = pixelAt(splashPixels, .04, .96);
  check(rgbDistance(splashTop, splashBottom) <= 3
    && rgbDistance(splashTop, { red: 5, green: 6, blue: 14, alpha: 255 }) <= 3,
  'the iOS loading screen must preserve the app\'s #05060e first-frame continuity');
  for (const [x, y] of [[.4714, .4714], [.5286, .4714], [.5, .5], [.4714, .5286], [.5286, .5286]]) {
    const splashPip = pixelAt(splashPixels, x, y);
    const splashGround = pixelAt(splashPixels, .04, y);
    check(rgbDistance(splashPip, splashGround) <= 3,
      `the iOS loading-screen pip at ${x},${y} must reveal its #05060e ground`);
  }
  check(colorSpread(pixelAt(splashPixels, .5, .445)) >= 80
    && colorSpread(pixelAt(splashPixels, .5, .555)) >= 80,
  'the iOS loading-screen die must use the same full-color artwork as the app icon');
  const launchScreen = readFileSync(LAUNCH_SCREEN, 'utf8');
  check(/image="Splash"/.test(launchScreen) && /contentMode="scaleAspectFill"/.test(launchScreen)
    && /<image name="Splash" width="2732" height="2732"\/>/.test(launchScreen),
    `${LAUNCH_SCREEN} must render the full-bleed branded Splash imageset`);

  return { xcodeIds, gcBundle };
}
