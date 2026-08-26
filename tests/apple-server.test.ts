import {
  appleClientSecret,
  exchangeAppleAuthorizationCode,
  revokeAppleRefreshToken,
  verifiedAppleSubject,
} from '../supabase/functions/_shared/apple.ts';
import { handleIdentityRequest } from '../cloudflare/identity-gateway/worker.ts';
import { readFileSync } from 'node:fs';

const problems: string[] = [];
const check = (ok: boolean, message: string, detail?: unknown) => {
  if (!ok) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};
const migration = readFileSync(
  'supabase/migrations/20260826153102_apple_identity_credentials.sql', 'utf8',
);
check(/create table private\.apple_revocation_credentials/.test(migration)
  && /references auth\.users\(id\) on delete set null/.test(migration)
  && /enable row level security/.test(migration)
  && /vault\.create_secret/.test(migration)
  && /vault\.decrypted_secrets/.test(migration)
  && /for update skip locked/.test(migration)
  && /revoke all on function public\.store_apple_revocation_credential[\s\S]*?from public, anon, authenticated/.test(migration),
'Apple deletion credentials are not Vault-backed, retry-safe, and inaccessible to app roles');
const credentialTable = migration.match(
  /create table private\.apple_revocation_credentials \(([\s\S]*?)\n\);/,
)?.[1] ?? '';
check(!/refresh_token\s+text/.test(credentialTable),
  'the Apple refresh token is stored as plaintext in an application table');
const b64url = (value: Uint8Array | string): string => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString('base64url');
};

const signingPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
);
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', signingPair.privateKey));
const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----`;
const envValues: Record<string, string> = {
  APPLE_TEAM_ID: 'TEAM123', APPLE_KEY_ID: 'KEY123', APPLE_PRIVATE_KEY: pem,
};
const secret = await appleClientSecret({ get: (key) => envValues[key] }, 'com.example.app', 1_800_000);
const [secretHeader, secretClaims, secretSignature] = secret.split('.');
const claims = JSON.parse(Buffer.from(secretClaims, 'base64url').toString());
check(JSON.parse(Buffer.from(secretHeader, 'base64url').toString()).alg === 'ES256'
  && claims.sub === 'com.example.app' && claims.exp - claims.iat === 300,
'Apple client secret has the wrong algorithm, audience lifetime, or client id');
check(await crypto.subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' }, signingPair.publicKey,
  Buffer.from(secretSignature, 'base64url'), new TextEncoder().encode(`${secretHeader}.${secretClaims}`),
), 'Apple client secret signature is not verifiable');

let tokenForm: URLSearchParams | null = null;
const exchange = await exchangeAppleAuthorizationCode('single-use', 'com.example.app', secret,
  (async (_url: string | URL | Request, init?: RequestInit) => {
    tokenForm = init?.body as URLSearchParams;
    return Response.json({ refresh_token: 'refresh-token', id_token: 'identity-token' });
  }) as typeof fetch);
check(exchange.refreshToken === 'refresh-token' && tokenForm?.get('code') === 'single-use'
  && tokenForm?.get('grant_type') === 'authorization_code',
'Apple authorization-code exchange did not request and retain the refresh token');

const rsaPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const jwk = await crypto.subtle.exportKey('jwk', rsaPair.publicKey);
const jwtHeader = b64url(JSON.stringify({ alg: 'RS256', kid: 'apple-key' }));
const jwtClaims = b64url(JSON.stringify({
  iss: 'https://appleid.apple.com', aud: 'com.example.app', exp: 2000, sub: 'apple-subject',
}));
const jwtSig = new Uint8Array(await crypto.subtle.sign(
  'RSASSA-PKCS1-v1_5', rsaPair.privateKey,
  new TextEncoder().encode(`${jwtHeader}.${jwtClaims}`),
));
const appleJwt = `${jwtHeader}.${jwtClaims}.${b64url(jwtSig)}`;
const keysFetch = (async () => Response.json({ keys: [{ ...jwk, kid: 'apple-key', alg: 'RS256' }] })) as typeof fetch;
check(await verifiedAppleSubject(appleJwt, 'com.example.app', keysFetch, 1_900_000) === 'apple-subject'
  && await verifiedAppleSubject(appleJwt, 'wrong-client', keysFetch, 1_900_000) === null,
'Apple identity token verification did not enforce signature, issuer, expiry, and audience');

const revokeStatuses = [204, 429, 400];
for (const [index, expected] of ['complete', 'retry', 'terminal'].entries()) {
  const actual = await revokeAppleRefreshToken('refresh', 'com.example.app', secret,
    (async () => new Response(null, { status: revokeStatuses[index] })) as typeof fetch);
  check(actual === expected, `Apple revocation status ${revokeStatuses[index]} classified as ${actual}`);
}

const gatewayEnv = (success = true) => ({
  GC_RATE_LIMITER: { limit: async () => ({ success }) },
  SUPABASE_GC_AUTH_URL: 'https://project.supabase.co/functions/v1/gc-auth',
  SUPABASE_PUBLISHABLE_KEY: 'publishable',
  GC_AUTH_ORIGIN_SECRET: 'gateway-secret',
  ALLOWED_ORIGINS: 'https://knucklebones.app,capacitor://localhost',
});
const gatewayRequest = (origin = 'capacitor://localhost') => new Request(
  'https://identity.example/v1/game-center', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: 'Bearer player' },
    body: JSON.stringify({ mode: 'attach', proof: { teamPlayerID: 'team' } }),
  },
);
const originalFetch = globalThis.fetch;
let forwarded: RequestInit | undefined;
globalThis.fetch = (async (_input, init) => {
  forwarded = init;
  return Response.json({ kind: 'linked' });
}) as typeof fetch;
try {
  const proxied = await handleIdentityRequest(gatewayRequest(), gatewayEnv());
  const headers = new Headers(forwarded?.headers);
  check(proxied.status === 200 && headers.get('X-Knucklebones-Origin') === 'gateway-secret'
    && headers.get('Authorization') === 'Bearer player'
    && headers.get('apikey') === 'publishable',
  'the Game Center gateway did not preserve auth and add its private origin proof');
  check((await handleIdentityRequest(gatewayRequest('https://evil.example'), gatewayEnv())).status === 403,
    'the Game Center gateway accepted an unlisted browser origin');
  check((await handleIdentityRequest(gatewayRequest(), gatewayEnv(false))).status === 429,
    'the Game Center gateway ignored the durable per-IP rate limiter');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({ problems }, null, 2));
process.exit(problems.length ? 1 : 0);
