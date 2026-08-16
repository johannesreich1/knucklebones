// ranked-submit: validate a finished ranked game by REPLAYING it.
// The score stored is the one the replay computes — the client's opinion of
// its score is never even part of the request. Deployment uploads
// src/core/{rules,dice,replay}.ts and src/config.ts verbatim next to this
// file (see supabase/functions/README.md), so validation runs the exact
// rules the client plays by.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { replayGame } from "./core/replay.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const SESSION_TTL_MS = 24 * 3600 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method-not-allowed" }, 405);

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const authed = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad-json" }, 400); }
  const { session_id, moves, difficulty } = body ?? {};
  if (typeof session_id !== "string" || !["easy", "medium", "hard"].includes(difficulty)) {
    return json({ error: "bad-request" }, 400);
  }

  const svc = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: session } = await svc
    .from("ranked_sessions").select("id, player_id, seed, used_at, created_at")
    .eq("id", session_id).maybeSingle();
  if (!session || session.player_id !== user.id) return json({ error: "no-session" }, 404);
  if (session.used_at) return json({ error: "already-submitted" }, 409);
  if (Date.now() - new Date(session.created_at).getTime() > SESSION_TTL_MS) {
    return json({ error: "expired" }, 410);
  }

  const result = replayGame(session.seed, moves);
  if (!result) return json({ error: "invalid-game" }, 422);

  const { error: insErr } = await svc.from("games").insert({
    session_id: session.id, player_id: user.id, moves, difficulty,
    score: result.score, opponent_score: result.opponent_score, won: result.won,
  });
  if (insErr) {
    // 23505 = unique violation on session_id: a racing double-submit
    const dup = insErr.code === "23505";
    return json({ error: dup ? "already-submitted" : "db-error" }, dup ? 409 : 500);
  }
  await svc.from("ranked_sessions").update({ used_at: new Date().toISOString() }).eq("id", session.id);

  return json(result);
});
