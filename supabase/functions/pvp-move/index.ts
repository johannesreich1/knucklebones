// pvp-move: the single authority for server-rebuilt match progress. The
// handler owns HTTP/auth validation; the operation owns existing game logic.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticator, withErrorBoundary } from "../_shared/http.ts";
import { createPvpMoveHandler } from "./handler.ts";
import { moveMatch } from "./operation.ts";

const authenticate = createAuthenticator({ createClient, env: Deno.env });
Deno.serve(withErrorBoundary(createPvpMoveHandler({ authenticate, operation: moveMatch })));
