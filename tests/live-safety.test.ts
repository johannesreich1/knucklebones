// LIVE TESTS MUST FAIL CLOSED AND KEEP THEIR CREDENTIALS OUT OF GIT.
import { readFileSync } from 'node:fs';
import { SUPABASE_URL } from '../src/config.ts';
import { readLivePvpConfig } from './support/live-pvp-config.mjs';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };

const fakeCredentials = {
  KB_E2E_TARGET: 'staging',
  KB_E2E_STAGING_HOST: 'example.invalid',
  KB_E2E_SUPABASE_URL: 'https://example.invalid',
  KB_E2E_SUPABASE_PUBLISHABLE_KEY: 'public-test-key-from-environment',
  KB_E2E_USER_A_EMAIL: 'first@example.invalid',
  KB_E2E_USER_A_PASSWORD: 'first-from-environment',
  KB_E2E_USER_B_EMAIL: 'second@example.invalid',
  KB_E2E_USER_B_PASSWORD: 'second-from-environment',
};

let guardFailedClosed = false;
try { readLivePvpConfig(fakeCredentials); }
catch (error) { guardFailedClosed = /KB_ALLOW_LIVE_E2E=1/.test(String(error)); }
check(guardFailedClosed,
  'live PvP config did not fail closed without the explicit live-test opt-in');

let productionFailedClosed = false;
try {
  readLivePvpConfig({
    ...fakeCredentials,
    KB_E2E_TARGET: 'production',
    KB_ALLOW_LIVE_E2E: '1',
  });
} catch (error) {
  productionFailedClosed = /KB_ALLOW_PROD_E2E=1/.test(String(error));
}
check(productionFailedClosed,
  'production did not require its additional explicit opt-in');

try {
  const production = readLivePvpConfig({
    ...fakeCredentials,
    KB_E2E_TARGET: 'production',
    KB_ALLOW_LIVE_E2E: '1',
    KB_ALLOW_PROD_E2E: '1',
    KB_E2E_SUPABASE_URL: SUPABASE_URL,
  });
  check(production.target === 'production' && production.supabaseUrl === SUPABASE_URL,
    'fully opted-in production configuration did not bind to the app production origin');
} catch (error) {
  problems.push(`valid production live config was rejected: ${String(error)}`);
}

let missingFailedClosed = false;
try { readLivePvpConfig({ KB_E2E_TARGET: 'staging', KB_ALLOW_LIVE_E2E: '1' }); }
catch (error) { missingFailedClosed = /configuration is incomplete/.test(String(error)); }
check(missingFailedClosed,
  'live PvP config accepted the opt-in without environment-provided credentials');

try {
  const config = readLivePvpConfig({ KB_ALLOW_LIVE_E2E: '1', ...fakeCredentials });
  check(config.target === 'staging' && config.users.length === 2
    && config.supabaseUrl === 'https://example.invalid',
    'live PvP config did not return the complete environment-provided configuration');
} catch (error) {
  problems.push(`valid environment-provided live config was rejected: ${String(error)}`);
}

let invalidTargetFailedClosed = false;
try { readLivePvpConfig({ ...fakeCredentials, KB_E2E_TARGET: 'preview' }); }
catch (error) { invalidTargetFailedClosed = /local, staging, or production/.test(String(error)); }
check(invalidTargetFailedClosed,
  'live PvP config accepted an unidentified target class');

let disguisedProductionFailedClosed = false;
try {
  readLivePvpConfig({
    ...fakeCredentials,
    KB_ALLOW_LIVE_E2E: '1',
    KB_E2E_SUPABASE_URL: SUPABASE_URL,
  });
} catch (error) {
  disguisedProductionFailedClosed = /must use KB_E2E_TARGET=production/.test(String(error));
}
check(disguisedProductionFailedClosed,
  'the production host could be mislabeled as staging to bypass its opt-in');

let dottedProductionFailedClosed = false;
try {
  readLivePvpConfig({
    ...fakeCredentials,
    KB_ALLOW_LIVE_E2E: '1',
    KB_E2E_STAGING_HOST: `${new URL(SUPABASE_URL).hostname}.`,
    KB_E2E_SUPABASE_URL: `${SUPABASE_URL}.`,
  });
} catch (error) {
  dottedProductionFailedClosed = /must use KB_E2E_TARGET=production/.test(String(error));
}
check(dottedProductionFailedClosed,
  'a fully-qualified production hostname could bypass the production opt-in');

let stagingAllowlistFailedClosed = false;
try {
  readLivePvpConfig({
    ...fakeCredentials,
    KB_ALLOW_LIVE_E2E: '1',
    KB_E2E_STAGING_HOST: 'other.invalid',
  });
} catch (error) {
  stagingAllowlistFailedClosed = /must match KB_E2E_STAGING_HOST/.test(String(error));
}
check(stagingAllowlistFailedClosed,
  'staging accepted a host outside its explicit allowlist');

let shapedUrlFailedClosed = false;
try {
  readLivePvpConfig({
    ...fakeCredentials,
    KB_ALLOW_LIVE_E2E: '1',
    KB_E2E_SUPABASE_URL: 'https://example.invalid/rest/v1',
  });
} catch (error) {
  shapedUrlFailedClosed = /bare Supabase origin/.test(String(error));
}
check(shapedUrlFailedClosed,
  'live PvP config accepted a URL with a path instead of a bare Supabase origin');

try {
  const local = readLivePvpConfig({
    ...fakeCredentials,
    KB_E2E_TARGET: 'local',
    KB_ALLOW_LIVE_E2E: '1',
    KB_E2E_SUPABASE_URL: 'http://[::1]:54321',
  });
  check(local.supabaseUrl === 'http://[::1]:54321',
    'live PvP config did not accept the documented IPv6 loopback target');
} catch (error) {
  problems.push(`valid IPv6 loopback live config was rejected: ${String(error)}`);
}

const LIVE_SUITES = ['tests/e2e-pvp.mjs', 'tests/e2e-pvp-ui.mjs'];
const LIVE_FILES = [...LIVE_SUITES, 'tests/support/live-pvp-config.mjs', '.env.live.example'];
const forbiddenLiterals = [
  { pattern: /https:\/\/[^'"`\s]+\.supabase\.co/gi, label: 'Supabase URL' },
  { pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, label: 'JWT' },
  { pattern: /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/g, label: 'Supabase key' },
  { pattern: /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, label: 'account email' },
  {
    pattern: /\bpass(?:word)?(?:_[A-Za-z0-9]+)?\s*(?::|=)\s*['"`][^'"`]+['"`]/gi,
    label: 'account password',
  },
];

for (const file of LIVE_SUITES) {
  const source = readFileSync(file, 'utf8');
  check(source.includes("from './support/live-pvp-config.mjs'"),
    `${file} does not use the shared fail-closed live configuration`);
  const guardAt = source.indexOf('readLivePvpConfig()');
  const effects = ['fetch(', 'await servedBase()', 'chromium.launch()']
    .map((needle) => source.indexOf(needle))
    .filter((position) => position >= 0);
  check(guardAt >= 0 && effects.every((position) => guardAt < position),
    `${file} can start a network or browser side effect before validating its live configuration`);
}

const uiSource = readFileSync('tests/e2e-pvp-ui.mjs', 'utf8');
check(/liveConfig\.target\s*!==\s*['"]production['"]/.test(uiSource),
  'the UI live probe is not restricted to its production-configured app build');

for (const file of LIVE_FILES) {
  const source = readFileSync(file, 'utf8');
  for (const { pattern, label } of forbiddenLiterals) {
    pattern.lastIndex = 0;
    check(!pattern.test(source), `${file} contains a literal ${label}; provide it through the environment`);
  }
}

const ignoreRules = readFileSync('.gitignore', 'utf8');
check(/^\.env\.\*$/m.test(ignoreRules),
  '.gitignore does not cover local environment variants such as .env.live');

const example = readFileSync('.env.live.example', 'utf8');
const configuredExampleValues = example.split('\n')
  .filter((line) => line && !line.startsWith('#'))
  .filter((line) => !line.endsWith('='));
check(configuredExampleValues.length === 0,
  '.env.live.example must document variable names without carrying credential values');

console.log(JSON.stringify({ checked: LIVE_FILES, problems, errs }, null, 2));
