// account-delete: the caller deletes their OWN account. Required in-app by
// Apple; the auth.users delete cascades profile, matches, moves and queue
// rows. Active matches are forfeited first so the opponent gets their win.
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

  // forfeit any active match: the remaining player should not lose their win
  const { data: active } = await svc.from("matches")
    .select("id, p1, p2").eq("status", "active")
    .or(`p1.eq.${user.id},p2.eq.${user.id}`).maybeSingle();
  if (active) {
    const opponent = active.p1 === user.id ? active.p2 : active.p1;
    await svc.from("matches").update({
      status: "forfeit", winner: opponent,
      next_die: null, finished_at: new Date().toISOString(),
    }).eq("id", active.id);
  }

  const { error } = await svc.auth.admin.deleteUser(user.id);
  if (error) return json({ error: "delete-failed" }, 500);
  return json({ deleted: true });
});
