// Live PvP suites mutate whichever Supabase project they target. Keep every
// credential outside git and make the destructive intent explicit on every run.
import { SUPABASE_URL } from '../../src/config.ts';

const REQUIRED = Object.freeze([
  'KB_E2E_SUPABASE_URL',
  'KB_E2E_SUPABASE_PUBLISHABLE_KEY',
  'KB_E2E_USER_A_EMAIL',
  'KB_E2E_USER_A_PASSWORD',
  'KB_E2E_USER_B_EMAIL',
  'KB_E2E_USER_B_PASSWORD',
]);

const canonicalHost = (hostname) => hostname
  .trim()
  .toLowerCase()
  .replace(/^\[|\]$/g, '')
  .replace(/\.+$/, '');

export function readLivePvpConfig(env = process.env) {
  const target = env.KB_E2E_TARGET?.trim();
  if (!['local', 'staging', 'production'].includes(target)) {
    throw new Error('KB_E2E_TARGET must be local, staging, or production.');
  }
  if (env.KB_ALLOW_LIVE_E2E !== '1') {
    throw new Error(
      'Live PvP tests are disabled. Set KB_ALLOW_LIVE_E2E=1 only after '
      + 'confirming KB_E2E_TARGET and the required post-run cleanup.',
    );
  }
  if (target === 'production' && env.KB_ALLOW_PROD_E2E !== '1') {
    throw new Error(
      'Production PvP tests require the additional KB_ALLOW_PROD_E2E=1 opt-in.',
    );
  }

  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Live PvP test configuration is incomplete: ${missing.join(', ')}`);
  }

  let supabaseUrl;
  try {
    supabaseUrl = new URL(env.KB_E2E_SUPABASE_URL);
  } catch {
    throw new Error('KB_E2E_SUPABASE_URL must be an absolute URL.');
  }
  if (!['http:', 'https:'].includes(supabaseUrl.protocol)) {
    throw new Error('KB_E2E_SUPABASE_URL must use http or https.');
  }
  if (supabaseUrl.username || supabaseUrl.password || supabaseUrl.pathname !== '/'
    || supabaseUrl.search || supabaseUrl.hash) {
    throw new Error('KB_E2E_SUPABASE_URL must be a bare Supabase origin.');
  }

  const productionOrigin = new URL(SUPABASE_URL).origin;
  const productionHost = canonicalHost(new URL(SUPABASE_URL).hostname);
  const host = canonicalHost(supabaseUrl.hostname);
  if (host === productionHost && target !== 'production') {
    throw new Error('The production Supabase host must use KB_E2E_TARGET=production.');
  }
  if (target === 'production' && supabaseUrl.origin !== productionOrigin) {
    throw new Error('KB_E2E_TARGET=production must use the app production Supabase host.');
  }
  if (target === 'local' && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('KB_E2E_TARGET=local must use localhost or a loopback IP.');
  }
  if (target === 'staging') {
    const stagingHost = canonicalHost(env.KB_E2E_STAGING_HOST ?? '');
    if (!stagingHost || host !== stagingHost) {
      throw new Error('KB_E2E_TARGET=staging must match KB_E2E_STAGING_HOST.');
    }
  }

  return Object.freeze({
    target,
    supabaseUrl: supabaseUrl.href.replace(/\/$/, ''),
    publishableKey: env.KB_E2E_SUPABASE_PUBLISHABLE_KEY,
    users: Object.freeze([
      Object.freeze({
        email: env.KB_E2E_USER_A_EMAIL,
        password: env.KB_E2E_USER_A_PASSWORD,
      }),
      Object.freeze({
        email: env.KB_E2E_USER_B_EMAIL,
        password: env.KB_E2E_USER_B_PASSWORD,
      }),
    ]),
  });
}
