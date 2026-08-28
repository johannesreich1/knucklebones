import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { APP_ID } from '../../src/config.ts';

type Check = (ok: boolean, message: string) => void;

/* The only Android assertions that need a compiler: they read the bundle and
   APK the CI job produced. Failures split two ways on purpose. A wrong
   manifest is a release problem and goes to `check`; an absent `unzip`, `java`
   or bundletool is a broken environment and goes to `errs`, which the suite
   reports separately. The array is built and returned here rather than pushed
   into the suite's own, so nothing is shared but the callback. */
export function verifyAndroidBuiltArtifacts(
  check: Check,
  { aab, debugApk }: { aab: string; debugApk: string },
): { errs: string[] } {
  const errs: string[] = [];
  check(existsSync(aab), `${aab} was not produced`);
  check(existsSync(debugApk), `${debugApk} was not produced`);
  if (existsSync(aab)) {
    let entries: string[] = [];
    try {
      entries = execFileSync('unzip', ['-Z1', aab], { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean);
    } catch (error) {
      errs.push(`could not inspect ${aab}: ${String(error)}`);
    }
    check(entries.includes('base/manifest/AndroidManifest.xml')
      && entries.includes('base/assets/public/index.html'),
    `${aab} is missing its base manifest or offline web payload`);
    check(!entries.some((entry) => /^META-INF\/.*\.(?:RSA|DSA|EC|SF)$/i.test(entry)),
      `${aab} is signed; CI must upload a verification-only unsigned artifact`);

    const bundletool = process.env.BUNDLETOOL_JAR;
    check(!!bundletool && existsSync(bundletool),
      'BUNDLETOOL_JAR must point to CI\'s checksum-verified bundletool JAR');
    if (bundletool && existsSync(bundletool)) {
      let bundledManifest = '';
      try {
        bundledManifest = execFileSync('java', [
          '-jar', bundletool,
          'dump', 'manifest',
          `--bundle=${aab}`,
        ], { encoding: 'utf8' });
      } catch (error) {
        errs.push(`bundletool could not inspect ${aab}: ${String(error)}`);
      }
      check(bundledManifest.includes(`package="${APP_ID}"`),
        `the AAB manifest package is not ${APP_ID}`);
      check(/android:versionCode="1"/.test(bundledManifest)
        && /android:versionName="1\.0"/.test(bundledManifest),
      'the AAB manifest is not versionCode 1 / versionName 1.0');
      check(/android:minSdkVersion="24"/.test(bundledManifest)
        && /android:targetSdkVersion="36"/.test(bundledManifest),
      'the AAB manifest is not minSdk 24 / targetSdk 36');
      check(/android:allowBackup="false"/.test(bundledManifest)
        && /android:usesCleartextTraffic="false"/.test(bundledManifest)
        && !/android:debuggable="true"/.test(bundledManifest),
      'the AAB manifest permits backup, cleartext, or debugging');
    }
  }
  return { errs };
}
