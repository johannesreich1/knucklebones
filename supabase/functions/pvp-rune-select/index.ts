import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticator } from "../_shared/http.ts";
import { createPvpRuneSelectHandler } from "./handler.ts";
import { selectRuneTrial } from "./operation.ts";

const authenticate = createAuthenticator({ createClient, env: Deno.env });
Deno.serve(createPvpRuneSelectHandler({ authenticate, operation: selectRuneTrial }));
