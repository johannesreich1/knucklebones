import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ID, NATIVE_STORE_NAME } from '../src/config.ts';

const problems: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };
const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryPath = (path: string) => join(REPOSITORY_ROOT, path);
const readRepositoryFile = (path: string) => readFileSync(repositoryPath(path), 'utf8');

const ROOT_PACKAGE = 'package.json';
const XCODE = 'native/ios/App/App.xcodeproj/project.pbxproj';
const APP_STORE_CONFIG = 'marketing/app-store/ios/app-store-connect.json';
const APP_STORE_MANIFEST = 'marketing/app-store/ios/manifest.json';
const APP_STORE_VERIFY = 'marketing/app-store/ios/verify-exports.mjs';
const APP_STORE_ENV_EXAMPLE = '.env.appstore.example';
const FASTFILE = 'fastlane/Fastfile';
const SCREENSHOT_SYNC = 'fastlane/lib/screenshot_sync.rb';
const GEMFILE = 'Gemfile';
const GEMFILE_LOCK = 'Gemfile.lock';

const appStore = JSON.parse(readRepositoryFile(APP_STORE_CONFIG));
const appStoreManifest = JSON.parse(readRepositoryFile(APP_STORE_MANIFEST));
check(appStore.appleAppId === '6804966098' && appStore.sku === 'knucklebones-ios-001',
  `${APP_STORE_CONFIG} must retain the immutable App Store record identity`);
check(appStore.bundleId === APP_ID && appStore.storeName === NATIVE_STORE_NAME,
  `${APP_STORE_CONFIG} must use the canonical bundle id and store name`);
check(appStore.platform === 'IOS' && appStore.screenshotDisplayType === 'APP_IPHONE_67',
  `${APP_STORE_CONFIG} must target only the iOS 6.9-inch screenshot set`);
check(typeof appStore.uploadApproved === 'boolean'
  && (!appStore.uploadApproved || appStoreManifest.status === 'approved for App Store Connect upload'),
  `${APP_STORE_CONFIG} may approve uploads only with the matching reviewed manifest status`);

const xcode = readRepositoryFile(XCODE);
const marketingVersions = [...xcode.matchAll(/MARKETING_VERSION\s*=\s*([^;\s]+)\s*;/g)]
  .map((match) => match[1]);
check(marketingVersions.length === 2 && marketingVersions.every((version) => version === appStore.appVersion),
  `${APP_STORE_CONFIG} appVersion=${appStore.appVersion} differs from Xcode `
  + `MARKETING_VERSION values ${JSON.stringify(marketingVersions)}`);

const screenshotVerification = spawnSync(process.execPath, [repositoryPath(APP_STORE_VERIFY)], {
  cwd: REPOSITORY_ROOT,
  encoding: 'utf8',
});
check(screenshotVerification.status === 0,
  `${APP_STORE_VERIFY} rejected the committed App Store exports: `
  + `${screenshotVerification.stderr || screenshotVerification.stdout}`.trim());

const rootPackage = JSON.parse(readRepositoryFile(ROOT_PACKAGE));
check(rootPackage.scripts?.['appstore:screenshots:contract']?.includes('appstore-delivery.test.ts')
  && rootPackage.scripts?.['appstore:screenshots:check']?.includes('screenshots_check')
  && rootPackage.scripts?.['appstore:screenshots:plan']?.includes('screenshots_plan')
  && rootPackage.scripts?.['appstore:screenshots:upload']?.includes('screenshots_upload'),
  `${ROOT_PACKAGE} must expose separate contract, local-check, read-only-plan, and confirmed-upload commands`);
const fastfile = readRepositoryFile(FASTFILE);
const appStoreEnvExample = readRepositoryFile(APP_STORE_ENV_EXAMPLE);
const screenshotSync = readRepositoryFile(SCREENSHOT_SYNC);
const forbiddenBroadUpload = /upload_to_app_store|overwrite_screenshots|sync_screenshots|ensure_version!|create_app_store_version_localization/;
check(!forbiddenBroadUpload.test(`${fastfile}\n${screenshotSync}`),
  'the screenshot workflow must not use broad Deliver overwrite/sync or create versions/localizations');
check(/ASC_SCREENSHOT_UPLOAD_CONFIRM/.test(fastfile)
  && /uploadApproved/.test(fastfile)
  && /APP_IPHONE_67/.test(fastfile)
  && /sh\("mise", "exec", "--", "node",/.test(fastfile)
  && !/KB_NODE_BINARY/.test(`${fastfile}\n${appStoreEnvExample}`)
  && !/UI\.user_error\(/.test(fastfile)
  && /commit every App Store marketing and uploader input/.test(screenshotSync)
  && /"mise\.toml"/.test(screenshotSync)
  && /rediscovered target screenshot set is not exact/.test(screenshotSync)
  && /an unrelated locale or device screenshot set changed/.test(screenshotSync),
  'the screenshot upload must remain reviewed, approval-gated, inventory-bound, and scoped to APP_IPHONE_67');
const gemfile = readRepositoryFile(GEMFILE);
const gemfileLock = readRepositoryFile(GEMFILE_LOCK);
check(/gem ["']fastlane["'], ["']2\.238\.0["']/.test(gemfile)
  && /^    fastlane \(2\.238\.0\)$/m.test(gemfileLock)
  && /^  fastlane \(= 2\.238\.0\)$/m.test(gemfileLock),
  'Fastlane internal API usage requires the exact tested 2.238.0 Gemfile and lock pin');
const ignoredP8 = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', 'owner-key.p8'], {
  cwd: REPOSITORY_ROOT,
});
check(ignoredP8.status === 0, '.p8 App Store Connect keys must remain ignored everywhere in the repository');

if (problems.length) {
  console.error(`APP STORE DELIVERY CONTRACT FAILED\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  process.exit(1);
}

console.log(JSON.stringify({
  appleAppId: appStore.appleAppId,
  bundleId: appStore.bundleId,
  version: appStore.appVersion,
  displayType: appStore.screenshotDisplayType,
  screenshots: appStoreManifest.slides.length,
  uploadApproved: appStore.uploadApproved,
}, null, 2));
