import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = resolve(nativeDir, 'android');
const properties = resolve(androidDir, 'keystore.properties');
const bundle = resolve(androidDir, 'app/build/outputs/bundle/release/app-release.aab');

if (!existsSync(properties)) {
  console.error('Signed Android release requires native/android/keystore.properties.');
  console.error('Copy keystore.properties.example and point it at the owner-held upload key.');
  process.exit(1);
}

const signing = new Map();
for (const line of readFileSync(properties, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
  const separator = trimmed.search(/[=:]/);
  if (separator < 1) continue;
  signing.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
}
for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
  if (!signing.get(key)) {
    console.error(`native/android/keystore.properties is missing ${key}.`);
    process.exit(1);
  }
}
const configuredStore = signing.get('storeFile');
const store = isAbsolute(configuredStore)
  ? configuredStore
  : resolve(androidDir, 'app', configuredStore);
if (!existsSync(store)) {
  console.error('The upload keystore configured by storeFile does not exist.');
  process.exit(1);
}

const gradle = spawnSync('./gradlew', ['--no-daemon', 'bundleRelease'], {
  cwd: androidDir,
  stdio: 'inherit',
});
if (gradle.status !== 0) process.exit(gradle.status ?? 1);
if (!existsSync(bundle)) {
  console.error(`Gradle completed without producing ${bundle}`);
  process.exit(1);
}

const verify = spawnSync('jarsigner', ['-verify', bundle], {
  cwd: androidDir,
  stdio: 'inherit',
});
if (verify.status !== 0) {
  console.error('The Android App Bundle has an invalid or missing JAR signature.');
  process.exit(verify.status ?? 1);
}

const certificatePem = (output) => output.match(
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
)?.[0].replace(/\s+/g, '') ?? null;
const bundledCertificate = spawnSync('keytool', ['-printcert', '-rfc', '-jarfile', bundle], {
  cwd: androidDir,
  encoding: 'utf8',
});
const configuredCertificate = spawnSync('keytool', [
  '-exportcert', '-rfc',
  '-keystore', store,
  '-storepass:env', 'KB_ANDROID_UPLOAD_STORE_PASSWORD',
  '-alias', signing.get('keyAlias'),
], {
  cwd: androidDir,
  encoding: 'utf8',
  env: {
    ...process.env,
    KB_ANDROID_UPLOAD_STORE_PASSWORD: signing.get('storePassword'),
  },
});
const bundledPem = bundledCertificate.status === 0
  ? certificatePem(bundledCertificate.stdout)
  : null;
const configuredPem = configuredCertificate.status === 0
  ? certificatePem(configuredCertificate.stdout)
  : null;
if (!bundledPem || !configuredPem || bundledPem !== configuredPem) {
  console.error('The Android App Bundle was not signed by the configured upload-key alias.');
  process.exit(1);
}

console.log(`Signed Android App Bundle: ${bundle}`);
