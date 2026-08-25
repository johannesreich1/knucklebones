// Game Center identity verification — the pure half, deliberately dependency
// free so it runs in Deno (the Edge Function), in Node (the test gate) and in a
// browser unmodified, exactly like core/.
//
// Apple hands the device four things and asks our server to check them against
// a certificate hosted on apple.com. The signed message is a fixed byte
// sequence, and everything about it has to match or the signature fails:
//
//     utf8(playerId) ++ utf8(bundleId) ++ bigEndianUInt64(timestamp) ++ salt
//
// Certificates issued before the 2021 rotation were SHA-1. Trying both modern
// and legacy digest algorithms costs one extra RSA verify on a cold path and
// avoids failing older valid signatures.
// Trying both costs one extra RSA verify on a cold path and removes a guess
// that would otherwise only fail on somebody's phone.

/* ---- minimal DER reader ----
   publicKeyUrl serves an X.509 CERTIFICATE, but WebCrypto imports a raw
   SubjectPublicKeyInfo, so the key has to be cut out of the certificate first.
   This walks the structure by position rather than pattern-matching bytes:

     Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
     tbsCertificate ::= SEQUENCE { [0] version OPTIONAL, serialNumber,
                                   signature, issuer, validity, subject,
                                   subjectPublicKeyInfo, ... } */
interface Tlv { tag: number; start: number; end: number; body: number }

function readTlv(b: Uint8Array, at: number): Tlv {
  if (!Number.isInteger(at) || at < 0 || at + 2 > b.length) throw new Error('truncated DER element');
  const tag = b[at];
  let n = at + 1;
  let len = b[n++];
  if (len & 0x80) {
    const count = len & 0x7f;
    if (count === 0 || count > 4) throw new Error('unsupported DER length');
    len = 0;
    if (n + count > b.length) throw new Error('truncated DER length');
    for (let i = 0; i < count; i++) len = (len * 256) + b[n++];
  }
  if (n + len > b.length) throw new Error('DER element exceeds input');
  return { tag, start: at, body: n, end: n + len };
}

/** children of a constructed element, in order */
function children(b: Uint8Array, el: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let at = el.body;
  while (at < el.end) { const c = readTlv(b, at); out.push(c); at = c.end; }
  if (at !== el.end) throw new Error('malformed DER children');
  return out;
}

function certificateFields(b: Uint8Array): { cert: Tlv; tbs: Tlv; fields: Tlv[]; outer: Tlv[] } {
  const cert = readTlv(b, 0);
  if (cert.tag !== 0x30 || cert.end !== b.length) throw new Error('malformed certificate sequence');
  const outer = children(b, cert);
  if (outer.length !== 3 || outer[0].tag !== 0x30) throw new Error('malformed certificate fields');
  const tbs = outer[0];
  const raw = children(b, tbs);
  const fields = raw[0]?.tag === 0xa0 ? raw.slice(1) : raw;
  if (fields.length < 6) throw new Error('truncated tbsCertificate');
  return { cert, tbs, fields, outer };
}

export function spkiFromCertificate(der: ArrayBuffer | Uint8Array): Uint8Array {
  const b = der instanceof Uint8Array ? der : new Uint8Array(der);
  const { fields } = certificateFields(b);
  const spki = fields[5];   // serial, sigAlg, issuer, validity, subject, THEN key
  if (!spki) throw new Error('certificate has no subjectPublicKeyInfo');
  return b.slice(spki.start, spki.end);
}

/* ---- certificate authority verification ----
   Apple's current Game Center leaf is signed by DigiCert Trusted G4 Code
   Signing RSA4096 SHA384 2021 CA1. WebCrypto has no X.509 chain API, so pin
   that intermediate's SPKI and verify the leaf's tbsCertificate signature
   directly. The pin is the key from DigiCert's official intermediate whose
   SHA-256 certificate fingerprint is
   46:01:1E:DE:1C:14:7E:B2:BC:73:1A:53:9B:7C:04:7B:7E:E9:3E:48:B9:D3:C3:BA:71:0C:E1:32:BB:DF:AC:6B. */
const DIGICERT_G4_CODE_SIGNING_SPKI = 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA1bQvQtAorXi3XdU5WRuxiEL1M4zrPYGXcMW7xIUmMJ+kjmjYXPXrNCQH4UtP03hD9BfXHtr50tVnGlJPDqFX/IiZwZHMgQM+TXAkZLON4gh9NH1MgFcSa0OamfLFOx/y78tHWhOmTLMBICXzENOLsvsI8IrgnQnAZaf6mIBJNYc9URnokCF4RS6hnyzhGMIazMXuk0lwQjKP+8bqHPNlaJGiTUyCEUhSaN4QvRRXXegYE2XFf7JPhSxIpFaENdb5LpyqABXRN/4aBpTCfMjqGzLmysL0p6MDDnSlrzm2q2AS4+jWufcx4dyt5Big2MEjR0ezoQ9uo6ttmAaDG7dqZy3SvUQakhCBj7A7CdfHmzJawv9qYFSLScGT7eG0XOBv6yb5jNWy+TgQ5urOkfW+0/tvk2E0XLyTRSiDNipmKF+wc86LJiUGsoPUXPYVGUztYuBeM/Lo6OwKp7ADK5GyNnm+960IHnWmZcy740hQ83eRGv7bUKJGyGFYmPV8AhY8gyitOYbs1LcNU9D4R+Z1MI3sMJN2FKZbS110YU0/EpF23r9Yy3IQKUHw1cVtJnZoEUETWJrcJisB9IlNWdt4z4FKPkBHX8mBUHOFECMhWWCKZFTBzCEa6DgZfGYczXg4RTCZT/9jT0y7qg0IU0F8WD1Hs/q27IwyCQLMbDwMVhECAwEAAQ==';
const EXPECTED_ISSUER = 'MGkxCzAJBgNVBAYTAlVTMRcwFQYDVQQKEw5EaWdpQ2VydCwgSW5jLjFBMD8GA1UEAxM4RGlnaUNlcnQgVHJ1c3RlZCBHNCBDb2RlIFNpZ25pbmcgUlNBNDA5NiBTSEEzODQgMjAyMSBDQTE=';
const EXPECTED_APPLE_SUBJECT = 'MIGHMQswCQYDVQQGEwJVUzETMBEGA1UECBMKQ2FsaWZvcm5pYTESMBAGA1UEBxMJQ3VwZXJ0aW5vMRMwEQYDVQQKEwpBcHBsZSBJbmMuMSUwIwYDVQQLExxtYW5hZ2VtZW50OmlkbXMuZ3JvdXAuNTMzNzcxMRMwEQYDVQQDEwpBcHBsZSBJbmMu';
const SHA256_WITH_RSA = '2a864886f70d01010b';
const RSA_ENCRYPTION = '2a864886f70d010101';
const KEY_USAGE = '551d0f';
const BASIC_CONSTRAINTS = '551d13';
const EXTENDED_KEY_USAGE = '551d25';
const CODE_SIGNING = '2b06010505070303';

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

function hex(b: Uint8Array, element: Tlv): string {
  return [...b.slice(element.body, element.end)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function algorithmOid(b: Uint8Array, algorithm: Tlv): string {
  const oid = children(b, algorithm)[0];
  if (!oid || oid.tag !== 0x06) throw new Error('certificate algorithm has no OID');
  return hex(b, oid);
}

function timeValue(b: Uint8Array, element: Tlv): number {
  const value = new TextDecoder().decode(b.slice(element.body, element.end));
  let year: number, month: number, day: number, hour: number, minute: number, second: number;
  if (element.tag === 0x17 && /^\d{12}Z$/.test(value)) {
    const short = Number(value.slice(0, 2));
    year = short >= 50 ? 1900 + short : 2000 + short;
    month = Number(value.slice(2, 4)); day = Number(value.slice(4, 6));
    hour = Number(value.slice(6, 8)); minute = Number(value.slice(8, 10));
    second = Number(value.slice(10, 12));
  } else if (element.tag === 0x18 && /^\d{14}Z$/.test(value)) {
    year = Number(value.slice(0, 4)); month = Number(value.slice(4, 6));
    day = Number(value.slice(6, 8)); hour = Number(value.slice(8, 10));
    minute = Number(value.slice(10, 12)); second = Number(value.slice(12, 14));
  } else {
    throw new Error('unsupported certificate validity time');
  }
  const parsed = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(parsed);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day || check.getUTCHours() !== hour
    || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) {
    throw new Error('invalid certificate validity time');
  }
  return parsed;
}

function extensionValue(b: Uint8Array, fields: Tlv[], wanted: string): Uint8Array | null {
  const tagged = fields.find((field) => field.tag === 0xa3);
  if (!tagged) return null;
  const extensions = children(b, tagged)[0];
  if (!extensions || extensions.tag !== 0x30) return null;
  for (const extension of children(b, extensions)) {
    const parts = children(b, extension);
    const oid = parts[0];
    const value = parts.find((part) => part.tag === 0x04);
    if (oid?.tag === 0x06 && value && hex(b, oid) === wanted) {
      return b.slice(value.body, value.end);
    }
  }
  return null;
}

/** True only for a current Apple Game Center leaf signed by the pinned CA. */
export async function trustedAppleGameCenterCertificate(
  der: ArrayBuffer | Uint8Array,
  nowMs = Date.now(),
): Promise<boolean> {
  try {
    const b = der instanceof Uint8Array ? der : new Uint8Array(der);
    const { tbs, fields, outer } = certificateFields(b);
    if (algorithmOid(b, fields[1]) !== SHA256_WITH_RSA
      || algorithmOid(b, outer[1]) !== SHA256_WITH_RSA) return false;
    if (!equal(b.slice(fields[2].start, fields[2].end), fromBase64(EXPECTED_ISSUER))
      || !equal(b.slice(fields[4].start, fields[4].end), fromBase64(EXPECTED_APPLE_SUBJECT))) {
      return false;
    }

    const validity = children(b, fields[3]);
    if (validity.length !== 2
      || nowMs < timeValue(b, validity[0])
      || nowMs > timeValue(b, validity[1])) return false;

    const spkiParts = children(b, fields[5]);
    if (!spkiParts[0] || algorithmOid(b, spkiParts[0]) !== RSA_ENCRYPTION) return false;

    const usageBytes = extensionValue(b, fields, KEY_USAGE);
    const basicBytes = extensionValue(b, fields, BASIC_CONSTRAINTS);
    const extendedBytes = extensionValue(b, fields, EXTENDED_KEY_USAGE);
    if (!usageBytes || !basicBytes || !extendedBytes) return false;
    const usage = readTlv(usageBytes, 0);
    if (usage.tag !== 0x03 || usage.body + 1 >= usage.end
      || (usageBytes[usage.body + 1] & 0x80) === 0) return false;
    const basic = readTlv(basicBytes, 0);
    if (basic.tag !== 0x30 || children(basicBytes, basic).some(
      (part) => part.tag === 0x01 && basicBytes[part.body] !== 0,
    )) return false;
    const extended = readTlv(extendedBytes, 0);
    if (extended.tag !== 0x30 || !children(extendedBytes, extended).some(
      (oid) => oid.tag === 0x06 && hex(extendedBytes, oid) === CODE_SIGNING,
    )) return false;

    const signature = outer[2];
    if (signature.tag !== 0x03 || signature.body >= signature.end
      || b[signature.body] !== 0) return false;
    const authority = await crypto.subtle.importKey(
      'spki', fromBase64(DIGICERT_G4_CODE_SIGNING_SPKI) as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', authority,
      b.slice(signature.body + 1, signature.end) as BufferSource,
      b.slice(tbs.start, tbs.end) as BufferSource,
    );
  } catch {
    return false;
  }
}

/* ---- the signed message ---- */
export function payload(playerId: string, bundleId: string, timestamp: bigint, salt: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const p = enc.encode(playerId), a = enc.encode(bundleId);
  const out = new Uint8Array(p.length + a.length + 8 + salt.length);
  out.set(p, 0);
  out.set(a, p.length);
  const ts = new DataView(out.buffer, p.length + a.length, 8);
  ts.setBigUint64(0, timestamp, false);            // big-endian, per Apple
  out.set(salt, p.length + a.length + 8);
  return out;
}

export interface Claim {
  playerIds: string[];        // public handler supplies only the stable teamPlayerID
  bundleId: string;
  timestamp: bigint;
  salt: Uint8Array;
  signature: Uint8Array;
}

/** the player id that verified, or null if nothing did */
export async function verifiedPlayerId(cert: ArrayBuffer | Uint8Array, c: Claim): Promise<string | null> {
  const spki = spkiFromCertificate(cert);
  for (const hash of ['SHA-256', 'SHA-1']) {
    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey('spki', spki as BufferSource,
        { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
    } catch { continue; }
    for (const id of c.playerIds) {
      if (!id) continue;
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
        c.signature as BufferSource, payload(id, c.bundleId, c.timestamp, c.salt) as BufferSource);
      if (ok) return id;
    }
  }
  return null;
}
