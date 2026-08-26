import type { Environment } from "./http.ts";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_AUDIENCE = "https://appleid.apple.com";
const APPLE_KEYS = `${APPLE_ISSUER}/auth/keys`;

const utf8 = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function jsonPart(value: unknown): string {
  return base64url(utf8.encode(JSON.stringify(value)));
}

function required(env: Environment, name: string): string {
  const value = env.get(name)?.trim();
  if (!value) throw new Error(`missing-${name.toLowerCase()}`);
  return value;
}

function privateKeyBytes(pem: string): Uint8Array {
  const raw = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!raw) throw new Error("invalid-apple-private-key");
  return Uint8Array.from(atob(raw), (character) => character.charCodeAt(0));
}

export async function appleClientSecret(
  env: Environment,
  clientId: string,
  nowMs = Date.now(),
): Promise<string> {
  const teamId = required(env, "APPLE_TEAM_ID");
  const keyId = required(env, "APPLE_KEY_ID");
  const privateKey = required(env, "APPLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(nowMs / 1000);
  const encodedHeader = jsonPart({ alg: "ES256", kid: keyId, typ: "JWT" });
  const encodedPayload = jsonPart({
    iss: teamId,
    iat: now,
    exp: now + 5 * 60,
    aud: APPLE_AUDIENCE,
    sub: clientId,
  });
  const input = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(privateKey) as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, utf8.encode(input) as BufferSource,
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

interface AppleTokenResponse {
  refresh_token?: unknown;
  id_token?: unknown;
}

export async function exchangeAppleAuthorizationCode(
  code: string,
  clientId: string,
  clientSecret: string,
  request: typeof fetch = fetch,
): Promise<{ refreshToken: string; idToken: string }> {
  const response = await request(`${APPLE_ISSUER}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  const value = await response.json().catch(() => null) as AppleTokenResponse | null;
  if (!response.ok || typeof value?.refresh_token !== "string"
    || typeof value.id_token !== "string") throw new Error("apple-code-exchange-failed");
  return { refreshToken: value.refresh_token, idToken: value.id_token };
}

interface AppleJwk extends JsonWebKey { kid?: string; alg?: string; kty?: string }

export async function verifiedAppleSubject(
  token: string,
  clientId: string,
  request: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: unknown; kid?: unknown };
  let claims: { iss?: unknown; aud?: unknown; exp?: unknown; sub?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64url(parts[1])));
  } catch { return null; }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
  const keysResponse = await request(APPLE_KEYS, { redirect: "error" });
  if (!keysResponse.ok) return null;
  const keys = (await keysResponse.json().catch(() => null) as { keys?: AppleJwk[] } | null)?.keys;
  const jwk = keys?.find((candidate) => candidate.kid === header.kid
    && candidate.kty === "RSA" && (!candidate.alg || candidate.alg === "RS256"));
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, decodeBase64url(parts[2]) as BufferSource,
    utf8.encode(`${parts[0]}.${parts[1]}`) as BufferSource,
  );
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return valid && claims.iss === APPLE_ISSUER && audience.includes(clientId)
      && typeof claims.exp === "number" && claims.exp > Math.floor(nowMs / 1000)
      && typeof claims.sub === "string" && claims.sub
    ? claims.sub : null;
}

export type AppleRevocationResult = "complete" | "terminal" | "retry";

export async function revokeAppleRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  request: typeof fetch = fetch,
): Promise<AppleRevocationResult> {
  try {
    const response = await request(`${APPLE_ISSUER}/auth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
    });
    if (response.ok) return "complete";
    return response.status >= 500 || response.status === 429 ? "retry" : "terminal";
  } catch (error) {
    console.error("apple revocation request failed:", error);
    return "retry";
  }
}
