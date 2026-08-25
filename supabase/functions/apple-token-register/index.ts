import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticator } from "../_shared/http.ts";
import { createAppleTokenRegisterHandler } from "./handler.ts";
import { registerAppleToken } from "./operation.ts";

const clients = { createClient, env: Deno.env };
const authenticate = createAuthenticator(clients);

Deno.serve(createAppleTokenRegisterHandler({
  authenticate,
  register: (context, code) => registerAppleToken(context, code, {
    env: Deno.env,
    fetch,
    now: Date.now,
  }),
}));
