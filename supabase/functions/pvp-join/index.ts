// pvp-join: server-authoritative matchmaking, reconnects, bot backfill, and
// seating. The handler owns HTTP/auth; the operation owns existing behavior.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticator, withErrorBoundary } from "../_shared/http.ts";
import { createPvpJoinHandler } from "./handler.ts";
import { joinMatch } from "./operation.ts";

const authenticate = createAuthenticator({ createClient, env: Deno.env });
Deno.serve(withErrorBoundary(createPvpJoinHandler({ authenticate, operation: joinMatch })));
