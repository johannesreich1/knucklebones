// pvp-join: enter matchmaking. Pairs with the longest-waiting human, or —
// when the client signals it has waited long enough (allow_bot) — starts a
// match against a pooled bot. Human is always p1 (starts) vs a bot; between
// humans the longer-waiting player is p1. Idempotent: rejoining returns the
// caller's active match — unless they abandoned a bot match past the stall
// window, which forfeits here (bots have no client to call pvp-claim).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { diceStream } from "./core/dice.ts";
import { AI, ME, boardTotalMode, type Player } from "./core/rules.ts";
import { rebuild } from "./core/match.ts";
import { eloDelta, type MatchScore } from "./core/elo.ts";
import { modeById, pickMode } from "./core/modes.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const QUEUE_STALE_MS = 2 * 60 * 1000;
const STALL_MS = 30 * 1000;          // same threshold pvp-claim enforces between humans

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

  const names = async (a: string, b: string) => {
    const { data } = await svc.from("profiles").select("id, nickname").in("id", [a, b]);
    const nick = (id: string) => data?.find((p: any) => p.id === id)?.nickname ?? "???";
    return { p1: nick(a), p2: nick(b) };
  };

  // Leaving loses — even against a bot. A human opponent claims the forfeit
  // via pvp-claim after STALL_MS; a bot has no client, so the same rule is
  // applied lazily the moment the leaver next contacts matchmaking.
  // Returns true when the match was forfeited (caller gets fresh matchmaking).
  const forfeitStalledBotMatch = async (m: any): Promise<boolean> => {
    const oppId = m.p1 === uid ? m.p2 : m.p1;
    const myIdx: Player = m.p1 === uid ? ME : AI;
    if (m.turn !== myIdx) return false;              // only the caller's own silence forfeits
    if (Date.now() - new Date(m.last_move_at).getTime() < STALL_MS) return false;
    const { data: opp } = await svc.from("profiles").select("is_bot").eq("id", oppId).maybeSingle();
    if (!opp?.is_bot) return false;                  // human opponent: their client claims
    const MODE = modeById(m.modifier).mode;
    const { data: moves } = await svc.from("match_moves").select("idx, who, col").eq("match_id", m.id);
    const { data: seedRow } = await svc.from("match_seeds").select("seed").eq("match_id", m.id).single();
    const s = seedRow && rebuild(seedRow.seed, moves ?? [], MODE);
    if (!s) return false;
    // finish block mirrors pvp-claim — keep the two in sync.
    // Claim the row first (status guard beats a concurrent finish), Elo after.
    const p1Score = boardTotalMode(s.st[ME], MODE), p2Score = boardTotalMode(s.st[AI], MODE);
    const { data: profs } = await svc.from("profiles").select("id, rating").in("id", [m.p1, m.p2]);
    const r1 = profs!.find((p: any) => p.id === m.p1)!.rating;
    const r2 = profs!.find((p: any) => p.id === m.p2)!.rating;
    const p1Result: MatchScore = myIdx === ME ? 0 : 1; // the leaver loses
    const d1 = eloDelta(r1, r2, p1Result);
    const d2 = eloDelta(r2, r1, (1 - p1Result) as MatchScore);
    const { data: claimed } = await svc.from("matches").update({
      status: "forfeit", winner: oppId, p1_score: p1Score, p2_score: p2Score,
      p1_rating_delta: d1, p2_rating_delta: d2,
      next_die: null, finished_at: new Date().toISOString(),
    }).eq("id", m.id).eq("status", "active").select("id");
    if (!claimed || claimed.length !== 1) return false;
    await svc.from("profiles").update({ rating: r1 + d1 }).eq("id", m.p1);
    await svc.from("profiles").update({ rating: r2 + d2 }).eq("id", m.p2);
    return true;
  };

  // rejoin an active match if one exists (reconnects, page reloads)
  const { data: active } = await svc.from("matches")
    .select("id, p1, p2, status, turn, next_die, last_move_at, modifier")
    .eq("status", "active").or(`p1.eq.${uid},p2.eq.${uid}`).limit(1).maybeSingle();
  if (active && !(await forfeitStalledBotMatch(active))) {
    return json({ status: "matched", rejoined: true, match: active,
                  you: active.p1 === uid ? 1 : 0, names: await names(active.p1, active.p2) });
  }

  // opportunistic hygiene: drop stale queue entries
  await svc.from("matchmaking_queue").delete()
    .lt("created_at", new Date(Date.now() - QUEUE_STALE_MS).toISOString());

  const startMatch = async (p1: string, p2: string) => {
    const seed = newSeed();
    // the wheel spins server-side: the modifier is a deterministic draw from
    // the seed, so replay validation and both clients' wheels agree
    const { data: match, error } = await svc.from("matches")
      .insert({ p1, p2, next_die: diceStream(seed)(), modifier: pickMode(seed).id })
      .select("id, p1, p2, status, turn, next_die, last_move_at, modifier").single();
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
      if (match) return json({ status: "matched", match, you: 0, names: await names(match.p1, match.p2) });
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
      if (match) return json({ status: "matched", match, you: 1, names: await names(match.p1, match.p2) });
    }
  }
  return json({ status: "queued" });
});
