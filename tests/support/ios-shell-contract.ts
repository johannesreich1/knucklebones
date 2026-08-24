import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  APP_ID,
  APPLE_OAUTH_REDIRECT_URL,
  APPLE_SERVICE_ID,
  NATIVE_APP_NAME,
} from '../../src/config.ts';
import { sameBytes } from './ios-artifacts.ts';

type Check = (ok: boolean, message: string) => void;

const PODFILE = 'native/ios/App/Podfile';
const CONFIG = 'native/capacitor.config.json';
const XCODE = 'native/ios/App/App.xcodeproj/project.pbxproj';
const INFO = 'native/ios/App/App/Info.plist';
const APP_DELEGATE = 'native/ios/App/App/AppDelegate.swift';
const SCENE_DELEGATE = 'native/ios/App/App/SceneDelegate.swift';
const LAUNCH_SCREEN = 'native/ios/App/App/Base.lproj/LaunchScreen.storyboard';
const APP_ICON_CATALOG = 'native/ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json';
const SPLASH_CATALOG = 'native/ios/App/App/Assets.xcassets/Splash.imageset/Contents.json';
const GC_PODSPEC = 'native/plugins/gamecenter/KnucklebonesGameCenter.podspec';
const BROWSER_IDENTITY = 'src/online/identity.ts';
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

  const xcode = readFileSync(XCODE, 'utf8');
  const xcodeIds = [...xcode.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\s]+)\s*;/g)]
    .map((match) => match[1]);
  check(xcodeIds.length >= 2,
    `${XCODE} exposes ${xcodeIds.length} PRODUCT_BUNDLE_IDENTIFIER values; expected Debug and Release`);
  for (const id of xcodeIds) {
    check(id === APP_ID, `${XCODE} uses PRODUCT_BUNDLE_IDENTIFIER=${id}, expected ${APP_ID}`);
  }
  const info = readFileSync(INFO, 'utf8');
  check(info.includes('<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>'),
    `${INFO} must derive CFBundleIdentifier from Xcode's PRODUCT_BUNDLE_IDENTIFIER`);
  const displayName = (info.match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/) || [])[1] ?? null;
  check(displayName === NATIVE_APP_NAME,
    `${INFO} CFBundleDisplayName=${JSON.stringify(displayName)} differs from src/config.ts `
    + `NATIVE_APP_NAME=${JSON.stringify(NATIVE_APP_NAME)}`);

  const browserIdentity = readFileSync(BROWSER_IDENTITY, 'utf8');
  const browserConfigImport = (browserIdentity.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/config\.ts['"]/) || [])[1] ?? '';
  check(/\bAPPLE_OAUTH_REDIRECT_URL\b/.test(browserConfigImport)
    && /\bAPPLE_SERVICE_ID\b/.test(browserConfigImport)
    && /initialize\(\{\s*clientId:\s*APPLE_SERVICE_ID\s*\}\)/.test(browserIdentity)
    && /redirectUrl:\s*APPLE_OAUTH_REDIRECT_URL\b/.test(browserIdentity),
    `${BROWSER_IDENTITY} must use the canonical Services ID and Supabase callback for Android Apple sign-in`);
  check(APPLE_SERVICE_ID === `${APP_ID}.web`,
    `APPLE_SERVICE_ID=${APPLE_SERVICE_ID} must remain associated with APP_ID=${APP_ID}`);
  check(APPLE_OAUTH_REDIRECT_URL === 'https://euzjcejbkxvqfrttgaxu.supabase.co/auth/v1/callback',
    `APPLE_OAUTH_REDIRECT_URL=${APPLE_OAUTH_REDIRECT_URL} is not the registered Supabase callback`);
  check(/available:\s*\(\)\s*=>\s*!!plugins\(\)\.GameCenter/.test(browserIdentity)
    && /const gameCenter\s*=\s*plugins\(\)\.GameCenter/.test(browserIdentity)
    && /await gameCenter\.signIn\(\)/.test(browserIdentity),
    `${BROWSER_IDENTITY} must expose Game Center from bridge capability alone and let signIn authenticate; `
    + `checking GKLocalPlayer authentication before rendering would deadlock a fresh-device flow`);

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
  for (const name of ['splash-2732x2732-2.png', 'splash-2732x2732-1.png', 'splash-2732x2732.png']) {
    check(splashNames.has(name), `${SPLASH_CATALOG} does not reference ${name}`);
  }
  check(!sameBytes(nativeAssets[0].path, nativeAssets[1].path),
    'the iOS light and dark app-icon appearances must remain distinct');
  const launchScreen = readFileSync(LAUNCH_SCREEN, 'utf8');
  check(/image="Splash"/.test(launchScreen) && /contentMode="scaleAspectFill"/.test(launchScreen)
    && /<image name="Splash" width="2732" height="2732"\/>/.test(launchScreen),
    `${LAUNCH_SCREEN} must render the full-bleed branded Splash imageset`);

  return { xcodeIds, gcBundle };
}
