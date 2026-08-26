import {
  createServiceClient, createUserClient, json, type ClientDependencies, type EdgeClient,
} from "../_shared/http.ts";
import type { GameCenterMode } from "./handler.ts";

interface Mapping {
  team_player_id?: string;
  user_id: string;
}

async function gcEmail(playerId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(playerId));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `gc-${hex.slice(0, 32)}@gamecenter.invalid`;
}

async function mapping(service: EdgeClient, playerId: string): Promise<Mapping | null> {
  const { data, error } = await service.from("game_center_ids")
    .select("team_player_id, user_id").eq("team_player_id", playerId).maybeSingle();
  if (error) throw new Error(`mapping read failed: ${error.message}`);
  return data as Mapping | null;
}

async function removeCreatedUser(service: EdgeClient, userId: string): Promise<string | null> {
  const { error } = await service.auth.admin.deleteUser(userId);
  return error?.message ?? null;
}

function isProvisionalEmail(email: string): boolean {
  return /^gc-pending-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@gamecenter\.invalid$/i
    .test(email);
}

/** Complete a cryptographically verified Game Center identity. */
export async function completeGameCenterIdentity(
  request: Request,
  playerId: string,
  mode: GameCenterMode,
  dependencies: ClientDependencies,
): Promise<Response> {
  const service = createServiceClient(dependencies);
  let caller: { id: string } | null = null;
  if (mode === "sign-in" && request.headers.get("Authorization")) {
    return json({ error: "session-not-allowed" }, 400);
  }
  if (mode !== "sign-in") {
    if (!request.headers.get("Authorization")) return json({ error: "unauthorized" }, 401);
    const authed = createUserClient(request, dependencies);
    const { data, error: callerError } = await authed.auth.getUser();
    if (callerError) return json({ error: "caller-check-failed" }, 500);
    caller = data.user;
  }

  let known: Mapping | null;
  try { known = await mapping(service, playerId); }
  catch (error) {
    console.error("gc-auth mapping read failed:", error);
    return json({ error: "mapping-read-failed" }, 500);
  }

  if (mode === "assert-current") {
    if (!caller) return json({ error: "unauthorized" }, 401);
    if (!known) return json({ kind: "assertion", status: "unlinked" });
    return json({
      kind: "assertion",
      status: known.user_id === caller.id ? "match" : "other-account",
    });
  }

  const email = await gcEmail(playerId);
  let ownerId = known?.user_id ?? null;
  let linked = false;

  if (!ownerId && caller) {
    const { error: insertError } = await service.from("game_center_ids")
      .insert({ team_player_id: playerId, user_id: caller.id });
    if (insertError) {
      // A simultaneous valid assertion may have claimed the mapping. Re-read
      // the winner; any other error fails closed without mutating Auth.
      try { known = await mapping(service, playerId); }
      catch (error) {
        console.error("gc-auth mapping re-read failed:", error);
        return json({ error: "mapping-write-failed" }, 500);
      }
      if (!known) return json({ error: "mapping-write-failed" }, 500);
      ownerId = known.user_id;
    } else {
      ownerId = caller.id;
      linked = true;
    }
  } else if (!ownerId) {
    // A losing mapping race may fail to clean up this provisional Auth user.
    // A unique email makes that orphan harmless: it cannot reserve the stable
    // Game Center email needed by the winning mapping's owner.
    const provisionalEmail = `gc-pending-${crypto.randomUUID()}@gamecenter.invalid`;
    const { data: made, error: createError } = await service.auth.admin.createUser({
      email: provisionalEmail,
      email_confirm: true,
    });
    if (createError || !made.user) {
      // A concurrent assertion may have completed the mapping while this
      // provisional Auth creation failed. Prefer that durable winner.
      try { known = await mapping(service, playerId); }
      catch (error) {
        console.error("gc-auth mapping re-read failed:", error);
        return json({ error: "create-failed" }, 500);
      }
      if (!known) return json({ error: "create-failed" }, 500);
      ownerId = known.user_id;
    } else {
      const { error: insertError } = await service.from("game_center_ids")
        .insert({ team_player_id: playerId, user_id: made.user.id });
      if (insertError) {
        const cleanupError = await removeCreatedUser(service, made.user.id);
        if (cleanupError) {
          return json({ error: "compensation-failed" }, 500);
        }
        try { known = await mapping(service, playerId); }
        catch (error) {
          console.error("gc-auth mapping re-read failed:", error);
          return json({ error: "mapping-write-failed" }, 500);
        }
        if (!known) return json({ error: "mapping-write-failed" }, 500);
        ownerId = known.user_id;
      } else {
        ownerId = made.user.id;
        linked = true;
      }
    }
  }

  if (!ownerId) return json({ error: "identity-owner-missing" }, 500);
  if (caller && ownerId !== caller.id) {
    return json({ error: "identity-already-linked" }, 409);
  }

  const { data: ownerData, error: ownerError } = await service.auth.admin.getUserById(ownerId);
  const owner = ownerData?.user;
  if (ownerError || !owner) return json({ error: "identity-owner-read-failed" }, 500);
  const currentEmail = owner.email;
  const preserveEmail = typeof currentEmail === "string" && currentEmail.length > 0
    && !isProvisionalEmail(currentEmail);
  const sessionEmail = preserveEmail ? currentEmail : email;

  // This idempotently completes a mapping-first attach if a prior invocation
  // stopped between the database claim and the Auth mutation.
  const { error: updateError } = sessionEmail === currentEmail
    ? { error: null }
    : await service.auth.admin.updateUserById(ownerId, {
      email: sessionEmail,
      email_confirm: true,
    });
  if (updateError) {
    // Keep a successful mapping claim as the durable recovery anchor. A retry
    // reads the same owner and idempotently completes this Auth mutation.
    return json({ error: "link-failed" }, 409);
  }

  if (mode === "attach") return json({ kind: "linked" });

  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: sessionEmail,
  });
  if (linkError || !link.properties?.hashed_token) {
    return json({ error: "session-failed" }, 500);
  }
  return json({ kind: "session", tokenHash: link.properties.hashed_token, linked });
}
