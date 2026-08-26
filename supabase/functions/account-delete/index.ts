// account-delete: the caller deletes their OWN account. Required in-app by
// Apple; the auth.users delete cascades profile, matches, moves and queue
// rows. Active matches are forfeited first so the opponent gets their win.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticator, withErrorBoundary } from "../_shared/http.ts";
import { createAccountDeleteHandler } from "./handler.ts";
import { deleteAccount } from "./operation.ts";

const authenticate = createAuthenticator({ createClient, env: Deno.env });
Deno.serve(withErrorBoundary(createAccountDeleteHandler({
  authenticate,
  operation: (context) => deleteAccount(context, { env: Deno.env, fetch, now: Date.now }),
})));
