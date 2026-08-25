import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { appleClientSecret, revokeAppleRefreshToken } from "../_shared/apple.ts";
import { createServiceClient, json, postOnly } from "../_shared/http.ts";

const clients = { createClient, env: Deno.env };

Deno.serve(async (request) => {
  const early = postOnly(request);
  if (early) return early;
  const expected = Deno.env.get("APPLE_REVOCATION_CRON_SECRET") ?? "";
  if (!expected || request.headers.get("X-Knucklebones-Cron") !== expected) {
    return json({ error: "forbidden" }, 403);
  }
  const service = createServiceClient(clients);
  const { data, error } = await service.rpc("claim_apple_revocations", { p_limit: 10 });
  if (error || !Array.isArray(data)) return json({ error: "claim-failed" }, 500);
  let complete = 0, retry = 0, terminal = 0;
  for (const row of data as Array<Record<string, unknown>>) {
    const id = row.credential_id;
    const clientId = row.client_id;
    const refreshToken = row.refresh_token;
    if (typeof id !== "number" || typeof clientId !== "string" || typeof refreshToken !== "string") {
      continue;
    }
    const expired = typeof row.expires_at === "string" && Date.parse(row.expires_at) <= Date.now();
    let result: "complete" | "terminal" | "retry" | "expired" = "expired";
    if (!expired) {
      try {
        const secret = await appleClientSecret(Deno.env, clientId);
        result = await revokeAppleRefreshToken(refreshToken, clientId, secret);
      } catch { result = "retry"; }
    }
    const { error: finishError } = await service.rpc("finish_apple_revocation", {
      p_credential_id: id,
      p_result: result,
    });
    if (finishError) return json({ error: "finish-failed" }, 500);
    if (result === "complete") complete++;
    else if (result === "retry") retry++;
    else terminal++;
  }
  return json({ processed: data.length, complete, retry, terminal });
});
