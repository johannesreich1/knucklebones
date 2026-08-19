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
// Two details are genuinely ambiguous in Apple's own documentation, so this
// module does not bet on either:
//   · WHICH player id is signed — the docs for the modern API say teamPlayerID,
//     the Apple Arcade guidance says gamePlayerID. Callers pass both and we
//     report which one verified.
//   · WHICH digest — certificates issued before the 2021 rotation were SHA-1.
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
  const tag = b[at];
  let n = at + 1;
  let len = b[n++];
  if (len & 0x80) {
    const count = len & 0x7f;
    if (count === 0 || count > 4) throw new Error('unsupported DER length');
    len = 0;
    for (let i = 0; i < count; i++) len = (len << 8) | b[n++];
  }
  return { tag, start: at, body: n, end: n + len };
}

/** children of a constructed element, in order */
function children(b: Uint8Array, el: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let at = el.body;
  while (at < el.end) { const c = readTlv(b, at); out.push(c); at = c.end; }
  return out;
}

export function spkiFromCertificate(der: ArrayBuffer | Uint8Array): Uint8Array {
  const b = der instanceof Uint8Array ? der : new Uint8Array(der);
  const cert = readTlv(b, 0);
  const tbs = children(b, cert)[0];
  if (!tbs) throw new Error('certificate has no tbsCertificate');
  const fields = children(b, tbs);
  // [0] EXPLICIT version is optional; when present it wears context tag 0xA0
  const rest = fields[0]?.tag === 0xa0 ? fields.slice(1) : fields;
  const spki = rest[5];   // serial, sigAlg, issuer, validity, subject, THEN key
  if (!spki) throw new Error('certificate has no subjectPublicKeyInfo');
  return b.slice(spki.start, spki.end);
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
  playerIds: string[];        // gamePlayerID and teamPlayerID — either may be the signed one
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
