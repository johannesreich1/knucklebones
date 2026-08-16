// ranked-start: issue a server-side dice seed for a ranked game.
// Auth required (gateway verifies the JWT; we still resolve the user).
// The seed lives in ranked_sessions until ranked-submit replays against it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method-not-allowed" }, 405);

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const authed = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const svc = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // a profile (nickname) must exist before ranked play — the FK enforces it,
  // this just gives the client a distinguishable error
  const { data: profile } = await svc.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!profile) return json({ error: "no-profile" }, 409);

  const seed = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data: session, error } = await svc
    .from("ranked_sessions").insert({ player_id: user.id, seed })
    .select("id, seed").single();
  if (error) return json({ error: "db-error" }, 500);

  return json({ session_id: session.id, seed: session.seed });
});
