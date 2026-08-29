import { readFileSync } from 'node:fs';
import {
  createNativeSplashRelease,
  NATIVE_SPLASH_FADE_MS,
  releaseNativeSplashAfter,
} from '../src/boot/native-splash.ts';
import { emitReport } from './support/emit-report.mjs';

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const tasks: Array<() => void> = [];
const hideOptions: unknown[] = [];
const release = createNativeSplashRelease(
  () => ({
    hide: async (options) => { hideOptions.push(options); },
  }),
  (task) => { tasks.push(task); },
);
release();
release();
check(tasks.length === 1 && hideOptions.length === 0,
  'native splash hide was not scheduled exactly once on a later task', {
    tasks: tasks.length, hides: hideOptions.length,
  });
tasks[0]?.();
await Promise.resolve();
check(JSON.stringify(hideOptions) === JSON.stringify([{
  fadeOutDuration: NATIVE_SPLASH_FADE_MS,
}]) && NATIVE_SPLASH_FADE_MS === 200,
'native splash hide did not use the one 200 ms release', hideOptions);

const startupOrder: string[] = [];
releaseNativeSplashAfter(() => {
  startupOrder.push('boot');
  startupOrder.push('hooks');
}, () => { startupOrder.push('schedule-hide'); });
check(startupOrder.join(',') === 'boot,hooks,schedule-hide',
  'splash release was armed before synchronous Home composition', startupOrder);

const failureOrder: string[] = [];
let failurePropagated = false;
try {
  releaseNativeSplashAfter(() => {
    failureOrder.push('boot');
    throw new Error('boot failed');
  }, () => { failureOrder.push('schedule-hide'); });
} catch (error) {
  failurePropagated = error instanceof Error && error.message === 'boot failed';
}
check(failurePropagated && failureOrder.join(',') === 'boot,schedule-hide',
  'boot failure did not both propagate and release the native splash', failureOrder);

const noBridgeTasks: Array<() => void> = [];
const webRelease = createNativeSplashRelease(
  () => undefined,
  (task) => { noBridgeTasks.push(task); },
);
webRelease();
let webThrew = false;
try { noBridgeTasks[0]?.(); } catch { webThrew = true; }
check(!webThrew, 'ordinary web startup depends on a Capacitor plugin bridge');

let unhandled = false;
const onUnhandled = () => { unhandled = true; };
process.on('unhandledRejection', onUnhandled);
const rejectionTasks: Array<() => void> = [];
createNativeSplashRelease(
  () => ({ hide: async () => { throw new Error('native bridge rejected'); } }),
  (task) => { rejectionTasks.push(task); },
)();
rejectionTasks[0]?.();
await new Promise<void>((resolve) => setImmediate(resolve));
process.off('unhandledRejection', onUnhandled);
check(!unhandled, 'a rejected native splash hide escaped as an unhandled rejection');

const mainSource = readFileSync('src/main.ts', 'utf8');
const widgetSource = readFileSync('src/widget.ts', 'utf8');
const helperSource = readFileSync('src/boot/native-splash.ts', 'utf8');
const releaseAt = mainSource.indexOf('releaseNativeSplashAfter(() =>');
const statsAt = mainSource.indexOf('loadStats()', releaseAt);
const localeAt = mainSource.indexOf('setLanguageOverride(S.localeOverride)', statsAt);
const markupAt = mainSource.indexOf("insertAdjacentHTML('afterbegin', MARKUP)", localeAt);
const localeRootAt = mainSource.indexOf("bindLocaleRoot(root, 'document')", markupAt);
const languageChangesAt = mainSource.indexOf('bindSystemLanguageChanges()', localeRootAt);
const bootAt = mainSource.indexOf('boot(false)', languageChangesAt);
const hooksAt = mainSource.indexOf('__kb = hooks()', bootAt);
check(releaseAt >= 0 && statsAt > releaseAt && localeAt > statsAt && markupAt > localeAt
    && localeRootAt > markupAt && languageChangesAt > localeRootAt
    && bootAt > languageChangesAt && hooksAt > bootAt,
  'standalone startup does not resolve locale, compose localized Home, and install hooks before release', {
    releaseAt, statsAt, localeAt, markupAt, localeRootAt, languageChangesAt, bootAt, hooksAt,
  });
check(!widgetSource.includes('native-splash') && widgetSource.includes('loadStats()')
    && widgetSource.includes("bindLocaleRoot(root, 'widget')") && widgetSource.includes('boot(true)'),
  'widget boot was coupled to native splash or skipped root-scoped localization');
check(!/from\s+['"]@capacitor\//.test(helperSource),
  'native splash helper imports plugin code into the web bundle');

emitReport({
  fadeMs: NATIVE_SPLASH_FADE_MS,
  startupOrder,
  failureOrder,
  problems,
}, problems.length);
