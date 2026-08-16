// pvp-claim: claim a forfeit win when the opponent has stalled. Only valid
// while it is the OPPONENT's turn and their silence exceeds the threshold.
// (Bots reply inside pvp-move, so claims only ever hit absent humans.)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { AI, ME, boardTotal, type Player } from "./core/rules.ts";
import { rebuild } from "./core/match.ts";
import { eloDelta, type MatchScore } from "./core/elo.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const STALL_MS = 60 * 1000;
const MATCH_COLS = "id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at";

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
  if (typeof body?.match_id !== "string") return json({ error: "bad-request" }, 400);

  const svc: SupabaseClient = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: match } = await svc.from("matches").select(MATCH_COLS).eq("id", body.match_id).maybeSingle();
  if (!match || (match.p1 !== user.id && match.p2 !== user.id)) return json({ error: "no-match" }, 404);
  if (match.status !== "active") return json({ error: "match-over" }, 409);
  const myIdx: Player = match.p1 === user.id ? ME : AI;
  if (match.turn === myIdx) return json({ error: "your-own-turn" }, 409);
  if (Date.now() - new Date(match.last_move_at).getTime() < STALL_MS) {
    return json({ error: "not-stalled-yet" }, 425);
  }

  const { data: moves } = await svc.from("match_moves").select("idx, who, col").eq("match_id", match.id);
  const { data: seedRow } = await svc.from("match_seeds").select("seed").eq("match_id", match.id).single();
  const s = seedRow && rebuild(seedRow.seed, moves ?? []);
  if (!s) return json({ error: "corrupt-state" }, 500);

  const p1Score = boardTotal(s.st[ME]), p2Score = boardTotal(s.st[AI]);
  const p1Result: MatchScore = myIdx === ME ? 1 : 0;
  const { data: profs } = await svc.from("profiles").select("id, rating").in("id", [match.p1, match.p2]);
  const r1 = profs!.find((p: any) => p.id === match.p1)!.rating;
  const r2 = profs!.find((p: any) => p.id === match.p2)!.rating;
  const d1 = eloDelta(r1, r2, p1Result);
  const d2 = eloDelta(r2, r1, (1 - p1Result) as MatchScore);
  await svc.from("profiles").update({ rating: r1 + d1 }).eq("id", match.p1);
  await svc.from("profiles").update({ rating: r2 + d2 }).eq("id", match.p2);
  const { data: updated } = await svc.from("matches").update({
    status: "forfeit", winner: user.id, p1_score: p1Score, p2_score: p2Score,
    p1_rating_delta: d1, p2_rating_delta: d2,
    next_die: null, finished_at: new Date().toISOString(),
  }).eq("id", match.id).select(MATCH_COLS).single();
  return json({ match: updated });
});
