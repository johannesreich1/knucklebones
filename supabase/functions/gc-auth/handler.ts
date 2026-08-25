import { json, postOnly, record } from "../_shared/http.ts";

const FRESH_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_CERT_BYTES = 16 * 1024;
const MAX_CERT_CACHE_MS = 60 * 60 * 1000;
const MAX_CERT_CACHE_ENTRIES = 4;
const MAX_PLAYER_ID_CHARS = 512;
const MAX_SIGNATURE_BYTES = 1024;
const MAX_SALT_BYTES = 256;
const GAME_CENTER_CERT = /^\/public-key\/gc-prod-[1-9][0-9]{0,2}\.cer$/;
const TOO_LARGE = Symbol("too-large");

export interface GameCenterVerification {
  playerIds: string[];
  bundleId: string;
  timestamp: bigint;
  salt: Uint8Array;
  signature: Uint8Array;
}

export interface GcAuthDependencies {
  bundleId: string;
  originSecret: string;
  now(): number;
  fetch(input: string, init: RequestInit): Promise<Response>;
  trust(certificate: ArrayBuffer, nowMs: number): Promise<boolean>;
  verify(certificate: ArrayBuffer, input: GameCenterVerification): Promise<string | null>;
  complete(request: Request, playerId: string, mode: GameCenterMode): Promise<Response>;
}

export type GameCenterMode = "sign-in" | "attach" | "assert-current";

export function certUrlOk(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  return url.protocol === "https:"
    && url.hostname === "static.gc.apple.com"
    && url.port === ""
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === ""
    && GAME_CENTER_CERT.test(url.pathname);
}

function base64(value: string, maxBytes: number): Uint8Array | null {
  if (value.length === 0 || value.length > 4 * Math.ceil(maxBytes / 3)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return decoded.length > 0 && decoded.length <= maxBytes ? decoded : null;
  }
  catch { return null; }
}

async function requestRecord(request: Request): Promise<Record<string, unknown> | null | typeof TOO_LARGE> {
  const declaredHeader = request.headers.get("content-length");
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared < 0) return null;
    if (declared > MAX_BODY_BYTES) return TOO_LARGE;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return TOO_LARGE;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return record(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

function certificateCacheMs(response: Response): number {
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i
    .exec(response.headers.get("cache-control") ?? "")?.[1];
  if (!maxAge) return 0;
  const seconds = Number(maxAge);
  return Number.isSafeInteger(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_CERT_CACHE_MS)
    : 0;
}

async function certificateBytes(response: Response, expectedUrl: string): Promise<ArrayBuffer | null> {
  if (!response.ok || response.redirected || response.url !== expectedUrl) return null;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-x509-ca-cert") return null;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_CERT_BYTES) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_CERT_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  if (total === 0) return null;
  const certificate = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { certificate.set(chunk, offset); offset += chunk.byteLength; }
  return certificate.buffer;
}

export function createGcAuthHandler(dependencies: GcAuthDependencies) {
  const certificates = new Map<string, { bytes: ArrayBuffer; expiresAt: number }>();
  return async (request: Request): Promise<Response> => {
    const early = postOnly(request);
    if (early) return early;
    if (!dependencies.originSecret
      || request.headers.get("X-Knucklebones-Origin") !== dependencies.originSecret) {
      return json({ error: "forbidden" }, 403);
    }

    const body = await requestRecord(request);
    if (body === TOO_LARGE) return json({ error: "request-too-large" }, 413);
    if (!body) return json({ error: "bad-json" }, 400);
    const { mode, proof } = body ?? {};
    if (mode !== "sign-in" && mode !== "attach" && mode !== "assert-current") {
      return json({ error: "bad-mode" }, 400);
    }
    const assertion = record(proof);
    if (!assertion) return json({ error: "bad-request" }, 400);
    const { publicKeyUrl, signature, salt, timestamp, teamPlayerID } = assertion;
    if (typeof publicKeyUrl !== "string" || typeof signature !== "string"
      || typeof salt !== "string" || (typeof timestamp !== "string" && typeof timestamp !== "number")
      || typeof teamPlayerID !== "string") {
      return json({ error: "bad-request" }, 400);
    }
    const playerIds = [teamPlayerID];
    if (publicKeyUrl.length > 256 || signature.length > 1400 || salt.length > 400
      || (typeof timestamp === "number" && !Number.isSafeInteger(timestamp))
      || !/^\d{1,20}$/.test(String(timestamp)) || playerIds.length === 0
      || playerIds.some((candidate) => candidate.length > MAX_PLAYER_ID_CHARS)
      || !teamPlayerID) {
      return json({ error: "bad-request" }, 400);
    }
    if (!certUrlOk(publicKeyUrl)) return json({ error: "bad-cert-host" }, 400);

    let parsedTimestamp: bigint;
    try { parsedTimestamp = BigInt(timestamp); }
    catch { return json({ error: "bad-request" }, 400); }
    const now = Math.trunc(dependencies.now());
    const skew = parsedTimestamp - BigInt(now);
    if (parsedTimestamp < 0n || skew > BigInt(FRESH_MS) || skew < -BigInt(FRESH_MS)) {
      return json({ error: "stale-signature" }, 400);
    }
    const parsedSalt = base64(salt, MAX_SALT_BYTES);
    const parsedSignature = base64(signature, MAX_SIGNATURE_BYTES);
    if (!parsedSalt || !parsedSignature) return json({ error: "bad-request" }, 400);

    let certificate: ArrayBuffer;
    let fetchedCacheMs = 0;
    const cached = certificates.get(publicKeyUrl);
    let cacheHit = false;
    if (cached && cached.expiresAt > now) {
      cacheHit = true;
      certificate = cached.bytes;
      certificates.delete(publicKeyUrl);
      certificates.set(publicKeyUrl, cached);
    } else {
      certificates.delete(publicKeyUrl);
      try {
        const certificateResponse = await dependencies.fetch(publicKeyUrl, { redirect: "manual" });
        fetchedCacheMs = certificateCacheMs(certificateResponse);
        const bounded = await certificateBytes(certificateResponse, publicKeyUrl);
        if (!bounded) return json({ error: "bad-certificate-response" }, 502);
        certificate = bounded;
      } catch {
        return json({ error: "cert-unavailable" }, 502);
      }
    }

    if (!(await dependencies.trust(certificate, now))) {
      certificates.delete(publicKeyUrl);
      return json({ error: "untrusted-certificate" }, 401);
    }
    if (!cacheHit && fetchedCacheMs > 0) {
      while (certificates.size >= MAX_CERT_CACHE_ENTRIES) {
        const oldest = certificates.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        certificates.delete(oldest);
      }
      certificates.set(publicKeyUrl, { bytes: certificate, expiresAt: now + fetchedCacheMs });
    }

    let playerId: string | null;
    try {
      playerId = await dependencies.verify(certificate, {
        playerIds,
        bundleId: dependencies.bundleId,
        timestamp: parsedTimestamp,
        salt: parsedSalt,
        signature: parsedSignature,
      });
    } catch {
      return json({ error: "bad-certificate" }, 400);
    }
    if (!playerId) return json({ error: "unverified" }, 401);
    return dependencies.complete(request, playerId, mode);
  };
}
