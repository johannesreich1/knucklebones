// GAME CENTER identity verification: the crypto, checked without a phone.
//
// This is the one part of the Game Center rung that can be proven on a laptop,
// and it is also the part where a mistake is worst: it decides whether a
// stranger may become an existing player. So it gets real keys, a real
// signature and real tampering — everything but Apple.
//
// The certificate is synthesised here rather than downloaded, which also pins
// the DER walk: the SubjectPublicKeyInfo is found BY POSITION inside
// tbsCertificate, with and without the optional [0] version tag, and across the
// long-form length encoding a 2048-bit key forces.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { APP_ID } from '../src/config.ts';
import { certUrlOk, createGcAuthHandler } from '../supabase/functions/gc-auth/handler.ts';
import {
  trustedAppleGameCenterCertificate, verifiedPlayerId, payload, spkiFromCertificate,
} from '../supabase/functions/gc-auth/verify.ts';
import { runGcAuthOperationTests } from './support/gcauth-operation.ts';

const problems: string[] = [];
const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

/* ---- the smallest DER encoder that can shape a certificate ---- */
const len = (n: number): number[] => {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let v = n; v > 0; v >>>= 8) out.unshift(v & 0xff);
  return [0x80 | out.length, ...out];
};
const tlv = (tag: number, body: number[] | Uint8Array): Uint8Array =>
  Uint8Array.from([tag, ...len(body.length), ...body]);
const seq = (...parts: Uint8Array[]): Uint8Array =>
  tlv(0x30, parts.reduce<number[]>((a, p) => (a.push(...p), a), []));

/** an X.509 shell around a real SPKI — enough structure for the reader to walk */
function fakeCert(spki: Uint8Array, withVersion: boolean): Uint8Array {
  const version = tlv(0xa0, [...tlv(0x02, [2])]);
  const serial = tlv(0x02, [0x2a]);
  const emptySeq = seq();
  const tbs = seq(...(withVersion ? [version] : []), serial, emptySeq, emptySeq, emptySeq, emptySeq, spki);
  return seq(tbs, emptySeq, tlv(0x03, [0x00]));
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const spki = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }) as Buffer);

const GAME_ID = 'G:1234567890';
const TEAM_ID = 'T:0987654321';
const BUNDLE = APP_ID;
const TS = 1755600000000n;
const SALT = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);

const sign = (id: string, bundle = BUNDLE, ts = TS, salt = SALT) =>
  new Uint8Array(crypto.sign('sha256', payload(id, bundle, ts, salt), privateKey));

const claim = (signature: Uint8Array, over = { playerIds: [GAME_ID, TEAM_ID] }) =>
  ({ playerIds: over.playerIds, bundleId: BUNDLE, timestamp: TS, salt: SALT, signature });

// the key really is where the reader thinks it is, both cert shapes
for (const withVersion of [true, false]) {
  const found = spkiFromCertificate(fakeCert(spki, withVersion));
  check(Buffer.compare(Buffer.from(found), Buffer.from(spki)) === 0,
    'SPKI not recovered from the certificate (version tag: ' + withVersion + ')', found.length);
}

const CERT = fakeCert(spki, true);

// 1 · a genuine signature verifies, and names the id that was actually signed
check(await verifiedPlayerId(CERT, claim(sign(GAME_ID))) === GAME_ID,
  'a real gamePlayerID signature was rejected');
check(await verifiedPlayerId(CERT, claim(sign(TEAM_ID))) === TEAM_ID,
  'a real teamPlayerID signature was rejected — the ambiguity is not handled');

// 2 · every field is load-bearing: change any one and it must fail
check(await verifiedPlayerId(CERT, claim(sign(GAME_ID), { playerIds: ['G:someone-else'] })) === null,
  'ANOTHER PLAYER passed with a valid signature');
check(await verifiedPlayerId(CERT, { ...claim(sign(GAME_ID)), bundleId: 'com.someone.else' }) === null,
  'a signature from a DIFFERENT APP was accepted');
check(await verifiedPlayerId(CERT, { ...claim(sign(GAME_ID)), timestamp: TS + 1n }) === null,
  'the timestamp is not covered by the signature');
check(await verifiedPlayerId(CERT, { ...claim(sign(GAME_ID)), salt: new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1]) }) === null,
  'the salt is not covered by the signature');

// 3 · a signature from the wrong key never verifies, however well formed
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const forged = new Uint8Array(crypto.sign('sha256', payload(GAME_ID, BUNDLE, TS, SALT), other.privateKey));
check(await verifiedPlayerId(CERT, claim(forged)) === null,
  'A FORGED SIGNATURE WAS ACCEPTED — anyone could become any player');

// 4 · APPLE'S OWN certificate, not just the shape this test invents. Node's
//     X.509 parser is the independent second opinion: if the positional walk
//     ever drifts, these two stop agreeing. (Fixture: static.gc.apple.com's
//     gc-prod-8.cer, a 4096-bit production key — all of gc-prod-2..8 passed
//     this check when it was written.)
{
  const der = new Uint8Array(readFileSync(new URL('./fixtures/gc-prod-8.cer', import.meta.url)));
  const mine = spkiFromCertificate(der);
  const truth = new crypto.X509Certificate(Buffer.from(der)).publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  check(Buffer.compare(Buffer.from(mine), truth) === 0,
    "the DER walk disagrees with Node's X.509 parser on Apple's real certificate", mine.length);
  let imported = false;
  try {
    await crypto.webcrypto.subtle.importKey('spki', mine as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    imported = true;
  } catch { /* reported below */ }
  check(imported, "WebCrypto refused the key cut out of Apple's certificate");
}

// 5 · the runtime trust boundary, independently of the assertion signature.
//     This fixture is the current Apple-hosted leaf on 2026-08-23; its leaf
//     signature must chain to the pinned DigiCert intermediate. A syntactically
//     valid attacker certificate and any leaf tampering must fail.
const currentLeaf = new Uint8Array(Buffer.from(
  readFileSync(new URL('./fixtures/gc-prod-12.base64', import.meta.url), 'utf8').trim(),
  'base64',
));
check(await trustedAppleGameCenterCertificate(currentLeaf, Date.UTC(2026, 7, 23)) === true,
  'the current Apple Game Center certificate did not validate to the pinned signing authority');
check(await trustedAppleGameCenterCertificate(CERT, Date.UTC(2026, 7, 23)) === false,
  'a self-signed attacker certificate passed the Apple signing-authority boundary');
const tamperedLeaf = currentLeaf.slice();
tamperedLeaf[tamperedLeaf.length - 1] ^= 1;
check(await trustedAppleGameCenterCertificate(tamperedLeaf, Date.UTC(2026, 7, 23)) === false,
  'a leaf with a tampered certificate signature passed authority verification');
check(await trustedAppleGameCenterCertificate(currentLeaf, Date.UTC(2028, 0, 1)) === false,
  'an expired Apple Game Center certificate remained trusted');

// 6 · the unauthenticated fetch boundary accepts only Apple's documented
//     Game Center cert path, never follows a redirect, validates final URL and
//     MIME type, and bounds the streamed body before parsing untrusted DER.
const CERT_URL = 'https://static.gc.apple.com/public-key/gc-prod-12.cer';
check(certUrlOk(CERT_URL), 'the documented Game Center certificate URL was rejected');
for (const url of [
  'https://evil.apple.com/public-key/gc-prod-12.cer',
  'https://static.gc.apple.com.evil.invalid/public-key/gc-prod-12.cer',
  'https://static.gc.apple.com/public-key/anything.cer',
  'https://static.gc.apple.com/public-key/gc-prod-12.cer?redirect=1',
  'http://static.gc.apple.com/public-key/gc-prod-12.cer',
]) check(!certUrlOk(url), `an unsafe certificate URL was accepted: ${url}`);

const NOW = Date.UTC(2026, 7, 23);
const handlerBody = JSON.stringify({
  publicKeyUrl: CERT_URL,
  signature: Buffer.from([1, 2, 3]).toString('base64'),
  salt: Buffer.from([4, 5, 6]).toString('base64'),
  timestamp: String(NOW),
  gamePlayerID: GAME_ID,
});
const handlerRequest = () => new Request('https://edge.test/gc-auth', {
  method: 'POST', body: handlerBody, headers: { 'Content-Type': 'application/json' },
});
const certificateResponse = (
  bytes: Uint8Array,
  url = CERT_URL,
  contentType = 'application/x-x509-ca-cert',
): Response => {
  const response = new Response(bytes as BodyInit, {
    headers: {
      'content-type': contentType,
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=60',
    },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
let fetchInit: RequestInit | null = null;
let fetchCalls = 0;
let trustCalls = 0;
let handlerNow = NOW;
const handler = createGcAuthHandler({
  bundleId: BUNDLE,
  now: () => handlerNow,
  fetch: async (_url, init) => {
    fetchCalls++;
    fetchInit = init;
    return certificateResponse(currentLeaf);
  },
  trust: async () => { trustCalls++; return true; },
  verify: async () => GAME_ID,
  complete: async () => new Response(JSON.stringify({ complete: true })),
});
const handled = await handler(handlerRequest());
check(handled.status === 200 && (await handled.json()).complete === true,
  'a trusted Game Center assertion did not reach identity completion');
check(fetchInit?.redirect === 'manual' && trustCalls === 1,
  'the certificate fetch may follow redirects or skipped authority validation');
check((await handler(handlerRequest())).status === 200 && fetchCalls === 1 && trustCalls === 2,
  'a current trusted Apple certificate was fetched again inside its bounded max-age cache');
handlerNow += 61_000;
check((await handler(handlerRequest())).status === 200 && fetchCalls === 2,
  'an expired Apple certificate cache entry was reused beyond its max-age');

const fetchesBeforeBadInput = fetchCalls;
const oversizedRequest = new Request('https://edge.test/gc-auth', {
  method: 'POST', body: JSON.stringify({ padding: 'x'.repeat(9 * 1024) }),
  headers: { 'Content-Type': 'application/json' },
});
check((await handler(oversizedRequest)).status === 413 && fetchCalls === fetchesBeforeBadInput,
  'an oversized unauthenticated request reached the Apple fetch boundary');
const oversizedScalar = new Request('https://edge.test/gc-auth', {
  method: 'POST',
  body: JSON.stringify({
    publicKeyUrl: CERT_URL, signature: 'A'.repeat(1500), salt: 'BA==',
    timestamp: String(handlerNow), gamePlayerID: GAME_ID,
  }),
  headers: { 'Content-Type': 'application/json' },
});
check((await handler(oversizedScalar)).status === 400 && fetchCalls === fetchesBeforeBadInput,
  'an oversized assertion scalar reached certificate fetch or cryptography');

const rejectedFetch = async (
  response: Response,
  message: string,
): Promise<void> => {
  let trusted = false;
  const guarded = createGcAuthHandler({
    bundleId: BUNDLE,
    now: () => NOW,
    fetch: async () => response,
    trust: async () => { trusted = true; return true; },
    verify: async () => GAME_ID,
    complete: async () => new Response('impossible'),
  });
  const result = await guarded(handlerRequest());
  check(result.status === 502 && !trusted, message);
};
await rejectedFetch(certificateResponse(currentLeaf, 'https://attacker.invalid/key.cer'),
  'a changed final certificate URL reached authority verification');
await rejectedFetch(certificateResponse(currentLeaf, CERT_URL, 'text/html'),
  'a non-certificate response type reached authority verification');
await rejectedFetch(certificateResponse(new Uint8Array(16 * 1024 + 1)),
  'an oversized certificate response reached authority verification');

const untrustedHandler = createGcAuthHandler({
  bundleId: BUNDLE,
  now: () => NOW,
  fetch: async () => certificateResponse(currentLeaf),
  trust: async () => false,
  verify: async () => GAME_ID,
  complete: async () => new Response('impossible'),
});
check((await untrustedHandler(handlerRequest())).status === 401,
  'an untrusted certificate was not rejected at the public endpoint');

const config = readFileSync('supabase/config.toml', 'utf8');
const jwtFlag = (slug: string) => new RegExp(
  `\\[functions\\.${slug}\\]\\s*verify_jwt\\s*=\\s*(true|false)`,
).exec(config)?.[1];
check(jwtFlag('gc-auth') === 'false', 'gc-auth is not explicitly configured for assertion auth');
for (const slug of ['account-delete', 'pvp-claim', 'pvp-join', 'pvp-move']) {
  check(jwtFlag(slug) === 'true', `${slug} is not explicitly protected by Supabase JWT verification`);
}

// 7 · the byte layout itself, in case a refactor "tidies" it
const p = payload('AB', 'CD', 0x0102030405060708n, new Uint8Array([0xff]));
check(Buffer.from(p).toString('hex') === '41424344' + '0102030405060708' + 'ff',
  'the signed message is no longer id ++ bundle ++ bigendian(ts) ++ salt', Buffer.from(p).toString('hex'));

// 8 · every identity mutation leaves a durable retry path. Successful mapping
// claims remain the anchor; only a provisional loser in a mapping race is
// deleted. The operation-owned fakes/cases live in their focused support file.
await runGcAuthOperationTests(check, GAME_ID);

console.log(JSON.stringify({ problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
