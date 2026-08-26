import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticator, withErrorBoundary } from "../_shared/http.ts";
import { ensureRuneTrialBotOpening } from "../_shared/rune-trial-bot-opening.ts";
import { createPvpRuneSelectHandler } from "./handler.ts";
import { selectRuneTrial } from "./operation.ts";

const authenticate = createAuthenticator({ createClient, env: Deno.env });
Deno.serve(withErrorBoundary(createPvpRuneSelectHandler({
  authenticate,
  operation: (context, input) => selectRuneTrial(context, input, ensureRuneTrialBotOpening),
})));
