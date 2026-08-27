// THE GATEWAY'S NATIVE ORIGIN IS DERIVED FROM capacitor.config.json.
//
// `allowedOrigin()` in the identity gateway Worker compares the request's
// Origin header against ALLOWED_ORIGINS as an exact string. On 2026-08-26 the
// deployed allow-list held `capacitor://localhost` — Capacitor's *iOS default*
// — while `native/capacitor.config.json` overrides both schemes to "https", so
// the shipped app's real WebView origin is `https://localhost`. Every Game
// Center exchange from a device would have answered 403 origin-not-allowed
// while the web build kept working, and the rollout note that produced it said
// only "the exact production web and native origins", which sounds like a
// choice rather than something to look up.
//
// WHAT THIS SUITE CANNOT DO: reach Cloudflare. The live allow-list is a
// dashboard value; no repository test can read or prove it, and a green run
// here is not evidence that the deployed Worker is correct.
//
// WHAT IT PINS INSTEAD: the two halves that ARE in the repository — the
// DERIVATION (`server.iosScheme` / `server.androidScheme` -> `<scheme>://
// localhost`) and the DOCUMENTED value the owner types into that dashboard. So
// flipping a scheme without updating the gateway documentation is a failing
// gate instead of a silent, native-only outage nobody sees until a device test.
//
// Run: mise exec -- node --experimental-strip-types tests/identity-gateway-origins.test.ts
import { readFileSync } from 'node:fs';

const problems: string[] = [];
const errs: string[] = [];
const check = (condition: unknown, message: string, detail?: unknown) => {
  if (condition) return;
  problems.push(detail === undefined ? message : `${message} :: ${JSON.stringify(detail)}`);
};

const CONFIG = 'native/capacitor.config.json';
const WORKER = 'cloudflare/identity-gateway/worker.ts';
const ENV_EXAMPLE = '.env.example';
const GATEWAY_DOC = 'cloudflare/identity-gateway/README.md';
const IDENTITY_DOC = 'docs/IDENTITY.md';
/* Both documents must carry the same literal, because the owner copies one of
   them into the dashboard and has no way to tell a stale copy from a fresh one. */
const DOCS = [GATEWAY_DOC, IDENTITY_DOC] as const;
const WEB_ORIGIN = 'https://knucklebones-asg.pages.dev';
const ENV_VAR = 'VITE_IDENTITY_GATEWAY_URL';

const read = (file: string): string => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    errs.push(`could not read ${file}: ${String(error)}`);
    return '';
  }
};

/* -------------------------------------------------------------------------
 * Derivation: the schemes Capacitor actually serves the WebView from
 * ---------------------------------------------------------------------- */

/* Capacitor's own defaults, applied when the key is absent — so deleting an
   override derives just as correctly as changing one. */
const SCHEME_DEFAULTS: Readonly<Record<string, string>> = {
  iosScheme: 'capacitor',
  androidScheme: 'https',
};

const schemes: Record<string, string> = {};
let nativeOrigins: string[] = [];
try {
  const parsed = JSON.parse(read(CONFIG) || '{}') as { server?: Record<string, unknown> };
  const server = parsed.server ?? {};
  for (const [key, fallback] of Object.entries(SCHEME_DEFAULTS)) {
    schemes[key] = String(server[key] ?? fallback);
  }
  nativeOrigins = [...new Set(Object.values(schemes).map((scheme) => `${scheme}://localhost`))]
    .sort();
} catch (error) {
  errs.push(`could not derive the native origin from ${CONFIG}: ${String(error)}`);
}
check(nativeOrigins.length > 0, `no native origin could be derived from ${CONFIG}`, schemes);

/* -------------------------------------------------------------------------
 * The documented allow-list, and whether it still matches that derivation
 * ---------------------------------------------------------------------- */

const documented = new Map<string, string[]>();
for (const doc of DOCS) {
  const text = read(doc);
  if (!text) continue;
  const lines = [...text.matchAll(/^[ \t]*ALLOWED_ORIGINS=(\S+)[ \t]*$/gm)].map((m) => m[1]);
  check(lines.length === 1,
    `${doc} must state the gateway allow-list exactly once, as a literal `
    + '`ALLOWED_ORIGINS=<value>` line the owner can copy verbatim', lines);
  if (lines.length !== 1) continue;
  const origins = lines[0].split(',');
  documented.set(doc, origins);

  check(origins.every((origin) => origin === origin.trim() && origin.length > 0),
    `${doc} documents an allow-list entry with padding or an empty slot; the Worker `
    + 'compares the Origin header exactly', origins);
  check(new Set(origins).size === origins.length,
    `${doc} documents a duplicate allow-list origin`, origins);
  check(origins.every((origin) => !origin.endsWith('/')),
    `${doc} documents an allow-list origin with a trailing slash; an Origin header never `
    + 'has one, so that entry can never match', origins);
  check(origins.includes(WEB_ORIGIN),
    `${doc} no longer documents the hosted web origin ${WEB_ORIGIN}`, origins);

  /* The trap itself, in both directions: every derived native origin must be
     present, and no OTHER `<scheme>://localhost` may be — a leftover
     `capacitor://localhost` allow-lists an origin the app never sends. */
  const localhostEntries = origins.filter((origin) => /^[a-z][a-z0-9+.-]*:\/\/localhost$/.test(origin));
  for (const origin of nativeOrigins) {
    check(origins.includes(origin),
      `${doc} does not document the native origin ${origin} derived from ${CONFIG}; the `
      + 'Capacitor scheme changed without the gateway allow-list moving with it', {
        schemes, documented: origins,
      });
  }
  for (const origin of localhostEntries) {
    check(nativeOrigins.includes(origin),
      `${doc} documents native origin ${origin}, which no scheme in ${CONFIG} produces`, {
        schemes, derived: nativeOrigins,
      });
  }

  check(text.includes(CONFIG),
    `${doc} states the allow-list without naming ${CONFIG}, so the next reader cannot see `
    + 'that the native origin is derived rather than chosen');
}

const values = [...documented.values()].map((origins) => origins.join(','));
check(values.length < 2 || new Set(values).size === 1,
  'the gateway documents differ on the allow-list the owner is told to configure',
  Object.fromEntries(documented));

/* ALLOWED_ORIGINS is the name the Worker reads; a rename would strand both
   documents on a variable Cloudflare no longer passes. */
const worker = read(WORKER);
check(worker.includes('env.ALLOWED_ORIGINS'),
  `${WORKER} no longer reads env.ALLOWED_ORIGINS, so the documented variable name is stale`);

/* -------------------------------------------------------------------------
 * The build-time variable stays a placeholder in the committed example
 * ---------------------------------------------------------------------- */

const envExample = read(ENV_EXAMPLE);
const envLines = [...envExample.matchAll(new RegExp(`^${ENV_VAR}=(.*)$`, 'gm'))].map((m) => m[1]);
check(envLines.length === 1, `${ENV_EXAMPLE} must define ${ENV_VAR} exactly once`, envLines);

const deployed = [...read(IDENTITY_DOC).matchAll(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/g)]
  .map((m) => m[0]);
check(deployed.length > 0,
  `${IDENTITY_DOC} no longer names the deployed gateway origin, so ${ENV_VAR} cannot be `
  + 'configured from the rollout it belongs to');

if (envLines.length === 1) {
  const value = envLines[0].trim();
  const host = value.replace(/^https?:\/\//, '').split('/')[0];
  check(host.split('.').includes('example'),
    `${ENV_EXAMPLE} sets ${ENV_VAR} to "${value}", which does not read as a placeholder; a `
    + `committed example that looks like configuration invites editing it instead of the `
    + `Pages/native build environment. Name the real origin in ${IDENTITY_DOC}`);
  check(!deployed.includes(value),
    `${ENV_EXAMPLE} carries the deployed gateway origin; it belongs in ${IDENTITY_DOC} where `
    + 'the rollout lives', value);
  check(/silent|never|empty|disable/i.test(envExample),
    `${ENV_EXAMPLE} does not say what an empty ${ENV_VAR} costs — a relative /v1/game-center `
    + 'and no Game Center link, with nothing logged');
}

console.log(JSON.stringify({
  config: CONFIG,
  schemes,
  derivedNativeOrigins: nativeOrigins,
  documentedAllowList: Object.fromEntries(documented),
  deployedGatewayOrigins: deployed,
  problems,
  errs,
}, null, 2));

process.exit(problems.length || errs.length ? 1 : 0);
