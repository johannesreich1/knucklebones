import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticator, json, postOnly, withErrorBoundary } from "../_shared/http.ts";

const clients = { createClient, env: Deno.env };
const authenticate = createAuthenticator(clients);

Deno.serve(withErrorBoundary(async (request) => {
  const early = postOnly(request);
  if (early) return early;
  const context = await authenticate(request);
  if (!context) return json({ error: "unauthorized" }, 401);
  const service = context.service();
  const [mapping, user, revocation] = await Promise.all([
    service.from("game_center_ids").select("user_id").eq("user_id", context.user.id).maybeSingle(),
    service.auth.admin.getUserById(context.user.id),
    service.rpc("apple_revocation_ready", { p_user: context.user.id }),
  ]);
  if (mapping.error || user.error || revocation.error || !user.data.user) {
    console.error("identity-status read failed:",
      (mapping.error ?? user.error ?? revocation.error)?.message);
    return json({ error: "identity-status-failed" }, 500);
  }
  return json({
    gameCenterLinked: !!mapping.data,
    appleLinked: (user.data.user.identities ?? []).some((identity) => identity.provider === "apple"),
    appleRevocationReady: revocation.data === true,
  });
}));
