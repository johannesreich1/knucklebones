// gc-auth: turn a Game Center player into a Knucklebones session.
//
// Game Center is the only rung of the ladder that costs the player nothing at
// all — no sheet, no tap, no typing — because iOS already knows who they are.
// Supabase has no provider for it, so this function is the bridge, and it is
// the most security-sensitive code in the repo: it decides whether a caller may
// BECOME an existing player. Three things stand between a stranger and someone
// else's rating:
//
//   1. the certificate must come from Apple (host allowlist, https only),
//   2. the signature must cover this app's bundle id and a player id the caller
//      also sent (see ./verify.ts — the crypto, tested in tests/gcauth.test.ts),
//   3. the timestamp must be recent, so a captured signature cannot be replayed
//      next month.
//
// Only then is the player id looked up. If the caller is already playing as a
// guest, the Game Center identity is hung on THAT account — the rating they
// just earned is the whole point, and creating a second row would throw it
// away.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  createServiceClient, createUserClient, json, postOnly, record,
} from "../_shared/http.ts";
import { verifiedPlayerId } from "./verify.ts";

const clients = { createClient, env: Deno.env };

const BUNDLE_ID = "com.appavaria.knucklebones";
const FRESH_MS = 10 * 60 * 1000;          // a signature older than this is a replay
const CERT_HOSTS = [".apple.com"];        // publicKeyUrl is attacker-influenced input
/* Game Center identities are not email addresses, but GoTrue models every
   permanent identity as one. The player id is hashed rather than embedded: the
   address is stable (it has to resolve to the same account next year) without
   carrying Apple's identifier around in a field the player can read. The
   .invalid TLD is reserved by RFC 6761 precisely so it can never be delivered
   to or registered by anybody. */
async function gcEmail(playerId: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(playerId));
  const hex = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `gc-${hex.slice(0, 32)}@gamecenter.invalid`;
}

const b64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function certUrlOk(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  return u.protocol === "https:" && CERT_HOSTS.some((h) => u.hostname.endsWith(h));
}

Deno.serve(async (req: Request) => {
  const early = postOnly(req);
  if (early) return early;

  let body: Record<string, unknown> | null;
  try { body = record(await req.json()); } catch { return json({ error: "bad-json" }, 400); }

  const { publicKeyUrl, signature, salt, timestamp, gamePlayerID, teamPlayerID } = body ?? {};
  if (typeof publicKeyUrl !== "string" || typeof signature !== "string" ||
      typeof salt !== "string" || (typeof timestamp !== "string" && typeof timestamp !== "number") ||
      (!gamePlayerID && !teamPlayerID)) {
    return json({ error: "bad-request" }, 400);
  }
  if (!certUrlOk(publicKeyUrl)) return json({ error: "bad-cert-host" }, 400);

  const ts = BigInt(timestamp);                       // Apple sends milliseconds
  if (Math.abs(Date.now() - Number(ts)) > FRESH_MS) return json({ error: "stale-signature" }, 400);

  const certRes = await fetch(publicKeyUrl);
  if (!certRes.ok) return json({ error: "cert-unavailable" }, 502);
  const cert = await certRes.arrayBuffer();

  let playerId: string | null;
  try {
    playerId = await verifiedPlayerId(cert, {
      playerIds: [gamePlayerID, teamPlayerID].filter(Boolean) as string[],
      bundleId: BUNDLE_ID,
      timestamp: ts,
      salt: b64(salt),
      signature: b64(signature),
    });
  } catch { return json({ error: "bad-certificate" }, 400); }
  if (!playerId) return json({ error: "unverified" }, 401);

  const svc = createServiceClient(clients);

  // whoever is calling — a guest mid-career, or nobody at all
  const authed = createUserClient(req, clients);
  const { data: { user: caller } } = await authed.auth.getUser();

  const { data: known } = await svc.from("game_center_ids")
    .select("user_id").eq("player_id", playerId).maybeSingle();

  const email = await gcEmail(playerId);
  if (known) {
    // This Game Center account already owns a player here, so the session below
    // is simply theirs. A guest sitting in front of it does NOT get merged in:
    // two identities, two careers, and silently discarding one is not ours to do.
  } else if (caller) {
    // first time on this account — keep the rating the guest already built
    const { error } = await svc.auth.admin.updateUserById(caller.id, { email, email_confirm: true });
    if (error) return json({ error: "link-failed", detail: error.message }, 409);
    await svc.from("game_center_ids").insert({ player_id: playerId, user_id: caller.id });
  } else {
    const { data: made, error } = await svc.auth.admin.createUser({ email, email_confirm: true });
    if (error || !made.user) return json({ error: "create-failed", detail: error?.message }, 500);
    await svc.from("game_center_ids").insert({ player_id: playerId, user_id: made.user.id });
  }

  /* Hand back a one-shot token rather than a password: the client exchanges it
     with verifyOtp() and gets a real session with a refresh token, and nothing
     reusable is ever stored on the device or in this function. */
  const { data: link, error: linkErr } = await svc.auth.admin.generateLink({
    type: "magiclink", email,
  });
  if (linkErr || !link.properties?.hashed_token) {
    return json({ error: "session-failed", detail: linkErr?.message }, 500);
  }
  return json({ token_hash: link.properties.hashed_token, email, linked: !known });
});
