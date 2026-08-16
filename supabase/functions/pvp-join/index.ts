// pvp-join: enter matchmaking. Pairs with the longest-waiting human, or —
// when the client signals it has waited long enough (allow_bot) — starts a
// match against a pooled bot. Human is always p1 (starts) vs a bot; between
// humans the longer-waiting player is p1. Idempotent: rejoining returns the
// caller's active match.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { diceStream } from "./core/dice.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const QUEUE_STALE_MS = 2 * 60 * 1000;

const newSeed = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method-not-allowed" }, 405);

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const authed = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const uid = user.id;

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const allowBot = body?.allow_bot === true;

  const svc = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // rejoin an active match if one exists (reconnects, page reloads)
  const { data: active } = await svc.from("matches")
    .select("id, p1, p2, status, turn, next_die, last_move_at")
    .eq("status", "active").or(`p1.eq.${uid},p2.eq.${uid}`).limit(1).maybeSingle();
  if (active) return json({ status: "matched", rejoined: true, match: active, you: active.p1 === uid ? 1 : 0 });

  // opportunistic hygiene: drop stale queue entries
  await svc.from("matchmaking_queue").delete()
    .lt("created_at", new Date(Date.now() - QUEUE_STALE_MS).toISOString());

  const startMatch = async (p1: string, p2: string) => {
    const seed = newSeed();
    const { data: match, error } = await svc.from("matches")
      .insert({ p1, p2, next_die: diceStream(seed)() })
      .select("id, p1, p2, status, turn, next_die, last_move_at").single();
    if (error || !match) return null;
    const { error: seedErr } = await svc.from("match_seeds").insert({ match_id: match.id, seed });
    if (seedErr) { await svc.from("matches").delete().eq("id", match.id); return null; }
    await svc.from("matchmaking_queue").delete().in("player_id", [p1, p2]);
    return match;
  };

  // try to pair with the longest-waiting other human
  const { data: partner } = await svc.from("matchmaking_queue")
    .select("player_id").neq("player_id", uid)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (partner) {
    // claim them atomically-ish: whoever deletes the row wins the pairing
    const { data: claimed } = await svc.from("matchmaking_queue")
      .delete().eq("player_id", partner.player_id).select("player_id");
    if (claimed && claimed.length === 1) {
      const match = await startMatch(partner.player_id, uid);  // they waited: they start
      if (match) return json({ status: "matched", match, you: 0 });
    }
  }

  // no partner: sit in the queue; with allow_bot, back-fill from the bot pool
  await svc.from("matchmaking_queue").upsert({ player_id: uid });
  if (allowBot) {
    const { data: bots } = await svc.from("profiles").select("id").eq("is_bot", true);
    const { data: busy } = await svc.from("matches").select("p1, p2").eq("status", "active");
    const busyIds = new Set((busy ?? []).flatMap((m: any) => [m.p1, m.p2]));
    const free = (bots ?? []).map((b: any) => b.id).filter((id: string) => !busyIds.has(id));
    if (free.length) {
      const bot = free[Math.floor(Math.random() * free.length)];
      const match = await startMatch(uid, bot);               // human always starts vs a bot
      if (match) return json({ status: "matched", match, you: 1 });
    }
  }
  return json({ status: "queued" });
});
