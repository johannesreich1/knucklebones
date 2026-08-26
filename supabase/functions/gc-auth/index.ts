// gc-auth: Apple assertion verification is the endpoint's authentication
// boundary because a restore call deliberately has no Supabase session yet.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { withErrorBoundary } from "../_shared/http.ts";
import { createGcAuthHandler } from "./handler.ts";
import { completeGameCenterIdentity } from "./operation.ts";
import { trustedAppleGameCenterCertificate, verifiedPlayerId } from "./verify.ts";

const BUNDLE_ID = "com.appavaria.knucklebones";
const clients = { createClient, env: Deno.env };

Deno.serve(withErrorBoundary(createGcAuthHandler({
  bundleId: BUNDLE_ID,
  originSecret: Deno.env.get("GC_AUTH_ORIGIN_SECRET") ?? "",
  now: Date.now,
  fetch: (url, init) => fetch(url, init),
  trust: trustedAppleGameCenterCertificate,
  verify: verifiedPlayerId,
  complete: (request, playerId, mode) => completeGameCenterIdentity(request, playerId, mode, clients),
})));
