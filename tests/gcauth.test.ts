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
import { verifiedPlayerId, payload, spkiFromCertificate } from '../supabase/functions/gc-auth/verify.ts';

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
const BUNDLE = 'com.appavaria.knucklebones';
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

// 5 · the byte layout itself, in case a refactor "tidies" it
const p = payload('AB', 'CD', 0x0102030405060708n, new Uint8Array([0xff]));
check(Buffer.from(p).toString('hex') === '41424344' + '0102030405060708' + 'ff',
  'the signed message is no longer id ++ bundle ++ bigendian(ts) ++ salt', Buffer.from(p).toString('hex'));

console.log(JSON.stringify({ problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
