import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticator } from "../_shared/http.ts";
import { createPvpActionHandler } from "./handler.ts";
import { actionMatch } from "./operation.ts";

const authenticate = createAuthenticator({ createClient, env: Deno.env });
Deno.serve(createPvpActionHandler({ authenticate, operation: actionMatch }));
