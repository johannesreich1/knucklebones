import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ID, NATIVE_STORE_NAME } from '../src/config.ts';

const problems: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };
const sorted = (values: string[]) => [...values].sort();
const sameStrings = (actual: string[], expected: string[]) =>
  JSON.stringify(actual) === JSON.stringify(expected);
const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryPath = (path: string) => join(REPOSITORY_ROOT, path);
const readRepositoryFile = (path: string) => readFileSync(repositoryPath(path), 'utf8');

const ROOT_PACKAGE = 'package.json';
const XCODE = 'native/ios/App/App.xcodeproj/project.pbxproj';
const APP_STORE_ROOT = 'marketing/app-store/ios';
const APP_STORE_CONFIG = `${APP_STORE_ROOT}/app-store-connect.json`;
const APP_STORE_MANIFEST = `${APP_STORE_ROOT}/manifest.json`;
const APP_STORE_METADATA = `${APP_STORE_ROOT}/metadata.json`;
const APP_STORE_PROVENANCE = `${APP_STORE_ROOT}/capture-provenance.json`;
const APP_STORE_CAPTURE = `${APP_STORE_ROOT}/capture.mjs`;
const APP_STORE_SOURCE = `${APP_STORE_ROOT}/source.html`;
const APP_STORE_FINALIZE = `${APP_STORE_ROOT}/finalize.mjs`;
const APP_STORE_VERIFY = `${APP_STORE_ROOT}/verify-exports.mjs`;
const FASTFILE = 'fastlane/Fastfile';
const SCREENSHOT_SYNC = 'fastlane/lib/screenshot_sync.rb';
const APP_STORE_PLAN = 'fastlane/lib/app_store_plan.rb';
const GEMFILE = 'Gemfile';
const GEMFILE_LOCK = 'Gemfile.lock';

const appStore = JSON.parse(readRepositoryFile(APP_STORE_CONFIG));
const appStoreManifest = JSON.parse(readRepositoryFile(APP_STORE_MANIFEST));
const appStoreMetadata = JSON.parse(readRepositoryFile(APP_STORE_METADATA));
const captureProvenance = JSON.parse(readRepositoryFile(APP_STORE_PROVENANCE));

check(appStore.schemaVersion === 2 && appStoreManifest.schemaVersion === 2,
  'localized App Store config and screenshot manifest must both use schemaVersion 2');
check(appStore.metadataFile === 'metadata.json' && appStoreMetadata.schemaVersion === 1,
  `${APP_STORE_CONFIG} must bind the versioned ${APP_STORE_METADATA} contract`);
check(appStore.appleAppId === '6804966098' && appStore.sku === 'knucklebones-ios-001',
  `${APP_STORE_CONFIG} must retain the immutable App Store record identity`);
check(appStore.bundleId === APP_ID && appStore.storeName === NATIVE_STORE_NAME,
  `${APP_STORE_CONFIG} must use the canonical bundle id and store name`);
check(appStore.platform === 'IOS', `${APP_STORE_CONFIG} must target only iOS`);

const expectedLocaleOrder = [
  'en-GB', 'pt-BR', 'es-ES', 'de-DE', 'fr-FR', 'it', 'pl', 'tr', 'id', 'ja', 'ko',
];
const expectedLocales = sorted(expectedLocaleOrder);
const configuredLocales = appStore.locales?.map((locale: { appStoreLocale: string }) =>
  locale.appStoreLocale) ?? [];
check(sameStrings(configuredLocales, expectedLocaleOrder),
  `${APP_STORE_CONFIG} locales must be exactly ${expectedLocaleOrder.join(', ')} in campaign order`);
check(sameStrings(sorted(Object.keys(appStoreManifest.localizations ?? {})), expectedLocales)
  && sameStrings(sorted(Object.keys(appStoreMetadata.localizations ?? {})), expectedLocales),
`${APP_STORE_MANIFEST} and ${APP_STORE_METADATA} must cover exactly the configured locales`);

const expectedRuntimeLocales = new Map([
  ['en-GB', 'en'],
  ['pt-BR', 'pt'],
  ['es-ES', 'es'],
  ['de-DE', 'de'],
  ['fr-FR', 'fr'],
  ['it', 'it'],
  ['pl', 'pl'],
  ['tr', 'tr'],
  ['id', 'id'],
  ['ja', 'ja'],
  ['ko', 'ko'],
]);
for (const locale of appStore.locales ?? []) {
  check(locale.runtimeLocale === expectedRuntimeLocales.get(locale.appStoreLocale)
    && locale.screenshotExportRoot === `exports/${locale.appStoreLocale}`,
  `${locale.appStoreLocale} must use its canonical runtime locale and localized export root`);
  check(appStoreManifest.localizations?.[locale.appStoreLocale]?.runtimeLocale === locale.runtimeLocale,
    `${locale.appStoreLocale} runtime locale must agree between config and manifest`);
}

const expectedTargets = [
  {
    id: 'iphone-6.9', displayType: 'APP_IPHONE_67', width: 1320, height: 2868,
    exportDirectory: 'iphone-6.9',
  },
  {
    id: 'ipad-13', displayType: 'APP_IPAD_PRO_3GEN_129', width: 2064, height: 2752,
    exportDirectory: 'ipad-13',
  },
];
const targetFields = (target: Record<string, unknown>) => ({
  id: target.id,
  displayType: target.displayType,
  width: target.width,
  height: target.height,
  exportDirectory: target.exportDirectory,
});
check(JSON.stringify((appStore.screenshotTargets ?? []).map(targetFields))
    === JSON.stringify(expectedTargets),
`${APP_STORE_CONFIG} must own exactly the iPhone 6.9-inch and iPad 13-inch screenshot targets`);
const manifestTargets = new Map((appStoreManifest.targets ?? [])
  .map((target: { id: string }) => [target.id, target]));
check(manifestTargets.size === expectedTargets.length,
  `${APP_STORE_MANIFEST} must contain exactly two screenshot targets`);
for (const target of expectedTargets) {
  const manifestTarget = manifestTargets.get(target.id) as Record<string, unknown> | undefined;
  check(manifestTarget?.displayType === target.displayType
      && manifestTarget?.width === target.width && manifestTarget?.height === target.height
      && manifestTarget?.format === 'png' && manifestTarget?.alpha === false,
  `${APP_STORE_MANIFEST} ${target.id} must be an opaque ${target.width}x${target.height} PNG target`);
}

const ownedMetadataFields = ['description', 'keywords', 'name', 'promotionalText', 'subtitle'];
check(sameStrings(sorted(appStoreMetadata.ownedFields ?? []), ownedMetadataFields),
  `${APP_STORE_METADATA} must own only ${ownedMetadataFields.join(', ')}`);
for (const locale of expectedLocales) {
  check(sameStrings(sorted(Object.keys(appStoreMetadata.localizations?.[locale] ?? {})), ownedMetadataFields),
    `${APP_STORE_METADATA} ${locale} must contain exactly the owned fields`);
}
check(/not approved for review submission/i.test(appStoreMetadata.status ?? ''),
  `${APP_STORE_METADATA} must explicitly remain outside review submission`);
check(appStore.draftSyncApproved === true
  && appStore.reviewSubmissionApproved === false
  && appStore.uploadApproved === undefined
  && appStoreManifest.status === 'approved for draft App Store Connect synchronization',
`${APP_STORE_CONFIG} must approve only draft synchronization while review submission remains forbidden`);

const slides = appStoreManifest.slides ?? [];
const screenshotSets = configuredLocales.length * expectedTargets.length;
check(Array.isArray(slides) && slides.length === 6 && screenshotSets === 22,
  `${APP_STORE_MANIFEST} must define six slides across exactly twenty-two locale/device sets`);
check(captureProvenance.schemaVersion === 1
  && captureProvenance.generator === APP_STORE_CAPTURE
  && sameStrings(captureProvenance.locales ?? [], expectedLocaleOrder)
  && captureProvenance.targets?.length === expectedTargets.length
  && captureProvenance.captures >= screenshotSets * slides.length,
`${APP_STORE_PROVENANCE} must bind all localized runtime captures to ${APP_STORE_CAPTURE}`);

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
  `${APP_STORE_VERIFY} rejected the localized raw captures, provenance, metadata, or exports: `
  + `${screenshotVerification.stderr || screenshotVerification.stdout}`.trim());

const rootPackage = JSON.parse(readRepositoryFile(ROOT_PACKAGE));
const scripts = rootPackage.scripts ?? {};
check(scripts['appstore:screenshots:capture'] === `node ${APP_STORE_CAPTURE}`
  && scripts['appstore:screenshots:finalize'] === `node ${APP_STORE_FINALIZE}`
  && scripts['appstore:screenshots:verify'] === `node ${APP_STORE_VERIFY}`
  && scripts['appstore:screenshots:generate']
    === 'npm run build && npm run appstore:screenshots:capture && npm run appstore:screenshots:finalize && npm run appstore:screenshots:verify',
`${ROOT_PACKAGE} must expose the deterministic build/capture/finalize/verify pipeline in order`);
check(scripts['appstore:screenshots:contract']?.includes('appstore-delivery.test.ts')
  && scripts['appstore:screenshots:check']?.includes('screenshots_check')
  && scripts['appstore:screenshots:plan']?.includes('screenshots_plan')
  && scripts['appstore:screenshots:upload']?.includes('screenshots_upload'),
`${ROOT_PACKAGE} must expose separate contract, local-check, read-only-plan, and confirmed-sync commands`);

const fastfile = readRepositoryFile(FASTFILE);
const screenshotSync = readRepositoryFile(SCREENSHOT_SYNC);
const appStorePlan = readRepositoryFile(APP_STORE_PLAN);
const captureSource = readRepositoryFile(APP_STORE_CAPTURE);
const captureFixtureSource = readRepositoryFile(APP_STORE_SOURCE);
const finalizeSource = readRepositoryFile(APP_STORE_FINALIZE);
const verifySource = readRepositoryFile(APP_STORE_VERIFY);
const deliverySources = `${fastfile}\n${screenshotSync}\n${appStorePlan}`;

check(/capture-provenance\.json/.test(captureSource)
  && /runtimeBuild/.test(captureSource)
  && /manifest\.localizations/.test(captureSource)
  && /manifest\.targets/.test(captureSource)
  && /config\.locales/.test(finalizeSource)
  && /config\.screenshotTargets/.test(finalizeSource)
  && /checksums\.txt/.test(finalizeSource)
  && /capture-provenance\.json/.test(verifySource)
  && /provenance\.files/.test(verifySource)
  && /createHash\(['"]sha256['"]\)/.test(verifySource),
  'capture, finalize, and verification must retain locale/target iteration, provenance, and checksums');

const captureModulePaths = [...captureFixtureSource.matchAll(
  /\bimport\((['"])\/(src\/[^'"]+)\1\)/g,
)].map((match) => match[2]);
const missingCaptureModules = [...new Set(captureModulePaths)]
  .filter((modulePath) => !existsSync(repositoryPath(modulePath)));
check(captureModulePaths.length > 0 && missingCaptureModules.length === 0,
  `${APP_STORE_SOURCE} imports missing production modules: ${missingCaptureModules.join(', ')}`);
check(/openOnline\(['"]ladder['"]/.test(captureFixtureSource)
    && !/openOnline\(['"]board['"]/.test(captureFixtureSource),
  `${APP_STORE_SOURCE} must open the production ladder through its current view id`);
check(/localeLanguageTag\(runtimeLocale\)/.test(captureFixtureSource),
  `${APP_STORE_SOURCE} must distinguish stable locale ids from presentation language tags`);
check(/onLadderList/.test(captureFixtureSource) && !/onBoardList/.test(captureFixtureSource),
  `${APP_STORE_SOURCE} must wait for the current production ladder panel`);
check((captureFixtureSource.match(/runtimeT\(['"]game['"], ['"]difficulty\.normal['"]\)/g) ?? []).length === 2,
  `${APP_STORE_SOURCE} must validate both AI Normal fixtures against localized runtime copy`);

check(/REQUIRED_LOCALES\s*=\s*%w\[de-DE en-GB es-ES fr-FR id it ja ko pl pt-BR tr\]/.test(screenshotSync)
  && /REQUIRED_DISPLAY_TYPES\s*=\s*%w\[APP_IPAD_PRO_3GEN_129 APP_IPHONE_67\]/.test(screenshotSync)
  && /metadataFile must be metadata\.json/.test(screenshotSync)
  && /metadata ownedFields must be exactly/.test(screenshotSync),
  'Fastlane sync must hard-bind the exact eleven locales, two display types, and owned metadata file');
check(/ASC_APP_STORE_SYNC_CONFIRM/.test(fastfile)
  && /draftSyncApproved/.test(fastfile)
  && /reviewSubmissionApproved/.test(fastfile)
  && /APPROVED_MANIFEST_STATUS/.test(fastfile)
  && /sh\("mise", "exec", "--", "node",/.test(fastfile)
  && /desired_snapshot/.test(screenshotSync)
  && /remote_snapshot/.test(screenshotSync)
  && /Digest::SHA256/.test(appStorePlan)
  && /commit every App Store metadata, marketing, and uploader input/.test(screenshotSync)
  && /unowned App Store metadata, locale, or device inventory changed during sync/.test(screenshotSync),
  'the draft sync must remain reviewed, draft-approved, committed, and bound to desired and remote inventory');

const planLane = fastfile.split('lane :screenshots_plan do')[1]?.split('lane :screenshots_upload do')[0] ?? '';
const uploadLane = fastfile.split('lane :screenshots_upload do')[1] ?? '';
check(/\.plan!\(/.test(planLane) && !/\.sync!\(/.test(planLane),
  'the authenticated plan lane must remain read-only');
check(/\.sync!\(/.test(uploadLane)
  && /APP_STORE_CONFIG\.fetch\("draftSyncApproved"\)/.test(uploadLane)
  && /APP_STORE_CONFIG\.fetch\("reviewSubmissionApproved"\)/.test(uploadLane),
  'the mutation lane must call the scoped sync only for draft staging with review disabled');
check(/create_app_info_localization/.test(screenshotSync)
  && /create_app_store_version_localization/.test(screenshotSync)
  && /create_app_screenshot_set/.test(screenshotSync)
  && /upload_screenshot/.test(screenshotSync),
  'the scoped sync must support missing exact localizations and locale/device screenshot sets');

const forbiddenBroadOrReleaseActions = [
  'upload_to_app_store',
  'upload_to_testflight',
  'sync_screenshots',
  'overwrite_screenshots',
  'build_app',
  'gym',
  'pilot',
  'submit_for_review',
  'select_build',
  'create_app_store_version(',
  'create_app_store_review',
  'review_submission',
  'Spaceship::ConnectAPI::Build',
];
const foundForbiddenActions = forbiddenBroadOrReleaseActions
  .filter((action) => deliverySources.includes(action));
check(foundForbiddenActions.length === 0,
  `App Store metadata/screenshot sync must not build, upload binaries, or submit for review: ${foundForbiddenActions.join(', ')}`);
check(!/(^|\s)deliver\s*(?:\(|do\b)/m.test(deliverySources),
  'App Store sync must not invoke broad Deliver behavior');

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
  locales: configuredLocales,
  displayTypes: expectedTargets.map((target) => target.displayType),
  sets: screenshotSets,
  screenshotsPerSet: slides.length,
  screenshots: screenshotSets * slides.length,
  ownedMetadataFields,
  draftSyncApproved: appStore.draftSyncApproved,
  reviewSubmissionApproved: appStore.reviewSubmissionApproved,
}, null, 2));
