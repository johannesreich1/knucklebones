// pvp-claim: claim a win from a stalled human, or explicitly resign an active
// match. HTTP/auth parsing is isolated from the settlement operation.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticator, withErrorBoundary } from "../_shared/http.ts";
import { createPvpClaimHandler } from "./handler.ts";
import { claimMatch } from "./operation.ts";

const authenticate = createAuthenticator({ createClient, env: Deno.env });
Deno.serve(withErrorBoundary(createPvpClaimHandler({ authenticate, operation: claimMatch })));
