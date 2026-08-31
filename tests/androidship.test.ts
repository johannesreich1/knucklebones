// Static Android release contract. The default gate needs no Android SDK;
// --require-synced verifies Capacitor's copied web/plugin payload, while
// --require-built verifies the compiler outputs produced by the Android CI job.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { APP_ID, GAME_NAME, NATIVE_APP_NAME, NATIVE_STORE_NAME } from '../src/config.ts';
import { verifyAndroidBuiltArtifacts } from './support/android-artifact-contract.ts';
import { verifyAndroidResourceContract } from './support/android-resource-contract.ts';
import { filesUnder, sameBytes } from './support/ios-artifacts.ts';
import { verifyNodeRuntimeContract } from './support/node-runtime-contract.ts';
import { emitReport } from './support/emit-report.mjs';

const problems: string[] = [];
const errs: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) problems.push(message);
};

const ROOT_PACKAGE = 'package.json';
const NATIVE_PACKAGE = 'native/package.json';
const NATIVE_LOCK = 'native/package-lock.json';
const CAP_CONFIG = 'native/capacitor.config.json';
const ANDROID = 'native/android';
const APP = `${ANDROID}/app`;
const MANIFEST = `${APP}/src/main/AndroidManifest.xml`;
const RES = `${APP}/src/main/res`;
const WEB = 'native/www';
const SYNCED_WEB = `${APP}/src/main/assets/public`;
const SYNCED_CONFIG = `${APP}/src/main/assets/capacitor.config.json`;
const SYNCED_PLUGINS = `${APP}/src/main/assets/capacitor.plugins.json`;
const AAB = `${APP}/build/outputs/bundle/release/app-release.aab`;
const DEBUG_APK = `${APP}/build/outputs/apk/debug/app-debug.apk`;
const REQUIRE_SYNCED = process.argv.includes('--require-synced');
const REQUIRE_BUILT = process.argv.includes('--require-built');

const read = (file: string) => readFileSync(file, 'utf8');
const json = (file: string) => JSON.parse(read(file));
const pkg = json(NATIVE_PACKAGE);
const lock = json(NATIVE_LOCK);
const rootPkg = json(ROOT_PACKAGE);
const cap = json(CAP_CONFIG);

const { nodePin, nodeRange } = verifyNodeRuntimeContract(check);
check(pkg.engines?.node === nodeRange && lock.packages?.['']?.engines?.node === nodeRange,
  `${NATIVE_PACKAGE} and ${NATIVE_LOCK} must preserve the root Node ${nodeRange} runtime contract`);

/* -------------------- package and workflow pins -------------------- */
const pins: Record<string, string> = {
  '@capacitor/android': '8.5.0',
  '@capacitor/core': '8.5.0',
  '@capacitor/ios': '8.5.0',
  '@capacitor/share': '8.0.1',
  '@capacitor/splash-screen': '8.0.2',
  '@capawesome/capacitor-apple-sign-in': '0.1.3',
  '@capacitor/assets': '3.0.5',
  '@capacitor/cli': '8.5.0',
};
for (const [name, version] of Object.entries(pins)) {
  const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  check(declared === version,
    `${NATIVE_PACKAGE} must pin ${name} exactly to ${version}, found ${JSON.stringify(declared)}`);
  check(lock.packages?.[`node_modules/${name}`]?.version === version,
    `${NATIVE_LOCK} must resolve the direct ${name} package to ${version}`);
}
check(rootPkg.scripts?.['native:sync:android']
  === 'npm run build && npm --prefix native run sync:android',
`${ROOT_PACKAGE} native:sync:android must build before syncing Android`);
check(rootPkg.scripts?.['native:verify:android']?.includes('--require-synced'),
  `${ROOT_PACKAGE} native:verify:android must require the copied Android payload`);
check(rootPkg.scripts?.['native:bundle:android']?.includes('native:sync:android')
  && rootPkg.scripts?.['native:bundle:android']?.includes('bundle:android'),
`${ROOT_PACKAGE} native:bundle:android must sync before the signed bundle command`);
check(rootPkg.scripts?.['native:assets:android']?.includes('tools/appicon.mjs --android')
  && rootPkg.scripts?.['native:assets:android']?.includes('tools/splash.mjs --android')
  && rootPkg.scripts?.['native:assets:android']?.includes('assets:android'),
`${ROOT_PACKAGE} must expose reproducible Android icon and splash generation`);

const workflow = read('.github/workflows/ci.yml');
check(/\n  android:\n/.test(workflow)
  && /java-version:\s*['"]21['"]/.test(workflow)
  && /platforms;android-36/.test(workflow)
  && /bundletool\/releases\/download\/\$\{BUNDLETOOL_VERSION\}/.test(workflow)
  && /BUNDLETOOL_VERSION:\s*['"]1\.18\.3['"]/.test(workflow)
  && /a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29/.test(workflow)
  && /sha256sum --check --strict/.test(workflow)
  && /npm ci --prefix native/.test(workflow)
  && /testDebugUnitTest lintDebug assembleDebug bundleRelease/.test(workflow)
  && /knucklebones-neon-unsigned-aab/.test(workflow),
'.github/workflows/ci.yml must install Node/native locks, Java 21 and SDK 36, run Android checks, and upload a clearly unsigned AAB');

/* -------------------- Capacitor and Android identity -------------------- */
check(cap.appId === APP_ID && cap.appName === NATIVE_APP_NAME && cap.webDir === 'www',
  `${CAP_CONFIG} must use canonical native identity ${APP_ID} / ${NATIVE_APP_NAME}`);
check(NATIVE_APP_NAME === GAME_NAME && NATIVE_STORE_NAME === 'Knucklebones Neon',
  'installed native label must stay Knucklebones while the store listing stays Knucklebones Neon');
check(!('url' in (cap.server ?? {})) && cap.server?.cleartext !== true,
  `${CAP_CONFIG} contains a live-reload URL or cleartext override`);
check(cap.plugins?.SplashScreen?.launchAutoHide === true
  && cap.plugins.SplashScreen.launchShowDuration === 5000
  && cap.plugins.SplashScreen.launchFadeOutDuration === 200
  && cap.plugins.SplashScreen.backgroundColor === '#05060eff'
  && cap.plugins.SplashScreen.showSpinner === false,
`${CAP_CONFIG} must configure the dark five-second splash watchdog and 200 ms fade`);

const appGradle = read(`${APP}/build.gradle`);
const variables = read(`${ANDROID}/variables.gradle`);
const rootGradle = read(`${ANDROID}/build.gradle`);
const wrapper = read(`${ANDROID}/gradle/wrapper/gradle-wrapper.properties`);
check(appGradle.includes(`namespace = "${APP_ID}"`)
  && appGradle.includes(`applicationId "${APP_ID}"`),
`${APP}/build.gradle must align namespace and applicationId with ${APP_ID}`);
check(/versionCode\s+1\b/.test(appGradle) && /versionName\s+["']1\.0["']/.test(appGradle),
  `${APP}/build.gradle must start at versionCode 1 / versionName 1.0`);
check((appGradle.match(/JavaVersion\.VERSION_21/g) ?? []).length >= 2,
  `${APP}/build.gradle must compile source and target with Java 21`);
check(/minSdkVersion\s*=\s*24\b/.test(variables)
  && /compileSdkVersion\s*=\s*36\b/.test(variables)
  && /targetSdkVersion\s*=\s*36\b/.test(variables),
`${ANDROID}/variables.gradle must use minSdk 24 and compile/target SDK 36`);
check(/com\.android\.tools\.build:gradle:8\.13\.0/.test(rootGradle),
  `${ANDROID}/build.gradle must pin Android Gradle Plugin 8.13.0`);
check(/gradle-8\.14\.3-all\.zip/.test(wrapper),
  `${ANDROID}/gradle/wrapper/gradle-wrapper.properties must pin Gradle 8.14.3`);

const strings = read(`${RES}/values/strings.xml`);
check(strings.includes(`<string name="app_name">${NATIVE_APP_NAME}</string>`)
  && strings.includes(`<string name="title_activity_main">${NATIVE_APP_NAME}</string>`)
  && strings.includes(`<string name="package_name">${APP_ID}</string>`),
`${RES}/values/strings.xml must align the shell name and package ID`);
const colors = read(`${RES}/values/colors.xml`);
check((colors.match(/#05060E/g) ?? []).length >= 2 && colors.includes('#2FD4F2'),
  `${RES}/values/colors.xml must keep system chrome on the branded dark background`);
const baseStyles = read(`${RES}/values/styles.xml`);
const api27Styles = read(`${RES}/values-v27/styles.xml`);
check(!baseStyles.includes('android:windowLightNavigationBar')
  && api27Styles.includes('android:windowLightNavigationBar'),
`${RES} must keep the API-27 navigation-bar attribute out of base API-24 resources`);
const mainActivity = read(`${APP}/src/main/java/com/appavaria/knucklebones/MainActivity.java`);
check(mainActivity.includes(`package ${APP_ID};`) && /extends\s+BridgeActivity/.test(mainActivity),
  'Android MainActivity must remain the standard Capacitor bridge activity');
for (const source of [
  `${APP}/src/test/java/com/appavaria/knucklebones/ApplicationIdTest.java`,
  `${APP}/src/androidTest/java/com/appavaria/knucklebones/ApplicationIdTest.java`,
]) {
  check(existsSync(source) && read(source).includes(`package ${APP_ID};`)
    && read(source).includes(`"${APP_ID}"`),
  `${source} must exercise the canonical application id instead of the Capacitor template id`);
}
check(!filesUnder(`${APP}/src`).some((file) => file.includes('com/getcapacitor/myapp')),
  'Android still contains the generated com.getcapacitor.myapp test package');

/* -------------------- platform security and lifecycle -------------------- */
const manifest = read(MANIFEST);
check(/android:allowBackup="false"/.test(manifest)
  && /android:fullBackupContent="false"/.test(manifest)
  && /android:dataExtractionRules="@xml\/data_extraction_rules"/.test(manifest),
`${MANIFEST} must disable backup and device-transfer restoration`);
check(/android:usesCleartextTraffic="false"/.test(manifest),
  `${MANIFEST} must explicitly disable cleartext traffic`);
const permissions = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)]
  .map((match) => match[1]);
check(JSON.stringify(permissions) === JSON.stringify(['android.permission.INTERNET']),
  `${MANIFEST} requests permissions beyond INTERNET: ${permissions.join(', ')}`);
check(/android:exported="true"/.test(manifest)
  && /android:launchMode="singleTask"/.test(manifest)
  && /android:screenOrientation="portrait"/.test(manifest)
  && /<application[\s\S]*?android:appCategory="game"/.test(manifest)
  && /android:configChanges="[^"]*orientation[^"]*screenSize[^"]*uiMode[^"]*density[^"]*"/.test(manifest),
`${MANIFEST} must retain standard launcher/configuration handling and the Android 16 game portrait exception`);
const extraction = read(`${RES}/xml/data_extraction_rules.xml`);
check(/<cloud-backup>[\s\S]*?<exclude domain="root" path="\." \/>[\s\S]*?<\/cloud-backup>/.test(extraction)
  && /<device-transfer>[\s\S]*?<exclude domain="root" path="\." \/>[\s\S]*?<\/device-transfer>/.test(extraction),
`${RES}/xml/data_extraction_rules.xml must exclude app data from cloud backup and transfer`);

/* -------------------- release signing cannot fall back to debug -------------------- */
check(/rootProject\.file\(['"]keystore\.properties['"]\)/.test(appGradle)
  && /if \(hasReleaseSigning\)[\s\S]*?signingConfig\s*=\s*signingConfigs\.release/.test(appGradle)
  && !/signingConfigs\.debug|signingConfig\s*=\s*signingConfigs\[['"]debug['"]\]/.test(appGradle),
`${APP}/build.gradle must conditionally use only the owner upload key for release signing`);
check(/buildFeatures\s*\{[\s\S]*?buildConfig\s*=\s*true[\s\S]*?\}/.test(appGradle),
`${APP}/build.gradle must generate BuildConfig for the application-id unit contract on AGP 8+`);
const signingExample = read(`${ANDROID}/keystore.properties.example`);
for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
  check(new RegExp(`^${key}=`, 'm').test(signingExample),
    `${ANDROID}/keystore.properties.example is missing ${key}`);
}
const bundleScript = read('native/scripts/bundle-android.mjs');
check(bundleScript.includes("existsSync(properties)")
  && bundleScript.includes("['--no-daemon', 'bundleRelease']")
  && bundleScript.includes("['-verify', bundle]")
  && bundleScript.includes("'-printcert', '-rfc', '-jarfile', bundle")
  && bundleScript.includes("'-exportcert', '-rfc'")
  && bundleScript.includes("'-storepass:env', 'KB_ANDROID_UPLOAD_STORE_PASSWORD'")
  && !bundleScript.includes("'-storepass', signing.get('storePassword')")
  && bundleScript.includes('bundledPem !== configuredPem'),
'native/scripts/bundle-android.mjs must fail without secrets, build release, verify its signature, '
+ 'and match the signer certificate to the configured upload-key alias');
const trackedAndroid = execFileSync('git', ['ls-files', '--', ANDROID], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
check(!trackedAndroid.some((file) => file.endsWith('/keystore.properties')
  || /\.(?:jks|keystore|p12|pfx)$/.test(file)),
'Git tracks Android signing secrets or a keystore');

/* -------------------- branded generated resource inputs -------------------- */
const { splashRenditions } = verifyAndroidResourceContract(check, RES);

/* -------------------- explicitly synced Capacitor payload -------------------- */
if (REQUIRE_SYNCED) {
  check(existsSync(`${SYNCED_WEB}/index.html`),
    `${SYNCED_WEB}/index.html is absent; run native:sync:android`);
  check(existsSync(SYNCED_CONFIG) && existsSync(SYNCED_PLUGINS),
    'Capacitor did not write the Android config/plugin manifests');
  if (existsSync(`${SYNCED_WEB}/index.html`) && existsSync(`${WEB}/index.html`)) {
    const expected = filesUnder(WEB);
    const actual = filesUnder(SYNCED_WEB);
    const generated = new Set(['cordova.js', 'cordova_plugins.js']);
    check(expected.every((file) => actual.includes(file)),
      `${SYNCED_WEB} omits files from ${WEB}`);
    check(actual.filter((file) => !expected.includes(file)).every((file) => generated.has(file)),
      `${SYNCED_WEB} contains stale files beyond Capacitor's Cordova shims`);
    for (const file of expected) {
      check(sameBytes(`${WEB}/${file}`, `${SYNCED_WEB}/${file}`),
        `${SYNCED_WEB}/${file} differs from ${WEB}/${file}`);
    }
  }
  if (existsSync(SYNCED_CONFIG)) {
    const synced = json(SYNCED_CONFIG);
    check(synced.appId === APP_ID && synced.appName === NATIVE_APP_NAME,
      `${SYNCED_CONFIG} carries the wrong app identity`);
    check(!('url' in (synced.server ?? {})) && synced.server?.cleartext !== true,
      `${SYNCED_CONFIG} would load cleartext or from a development server`);
  }
  if (existsSync(SYNCED_PLUGINS)) {
    const plugins = json(SYNCED_PLUGINS);
    const registrations = plugins.map((plugin: { pkg?: string; classpath?: string }) =>
      `${plugin.pkg}:${plugin.classpath}`).sort();
    check(JSON.stringify(registrations) === JSON.stringify([
      '@capacitor/share:com.capacitorjs.plugins.share.SharePlugin',
      '@capacitor/splash-screen:com.capacitorjs.plugins.splashscreen.SplashScreenPlugin',
      '@capawesome/capacitor-apple-sign-in:io.capawesome.capacitorjs.plugins.applesignin.AppleSignInPlugin',
    ].sort()), `${SYNCED_PLUGINS} does not register exactly Share, Splash Screen, and Apple Sign-In`);
  }
}

/* -------------------- compiler-produced CI artifact -------------------- */
if (REQUIRE_BUILT) {
  errs.push(...verifyAndroidBuiltArtifacts(check, { aab: AAB, debugApk: DEBUG_APK }).errs);
}

emitReport({
  nodePin,
  nodeRange,
  appId: APP_ID,
  appName: NATIVE_APP_NAME,
  storeName: NATIVE_STORE_NAME,
  requireSynced: REQUIRE_SYNCED,
  requireBuilt: REQUIRE_BUILT,
  permissions,
  splashRenditions,
  problems,
  errs,
}, problems.length || errs.length);
