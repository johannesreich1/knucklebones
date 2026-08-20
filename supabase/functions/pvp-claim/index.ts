// pvp-claim: claim a forfeit win when the opponent has stalled. Only valid
// while it is the OPPONENT's turn and their silence exceeds the threshold.
// (Bots reply inside pvp-move, so claims only ever hit absent humans.)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { AI, ME, boardTotalMode, type Player } from "./core/rules.ts";
import { rebuild, matchTotal } from "./core/match.ts";
import { settle, type Score } from "./core/ladder.ts";
import { modeById } from "./core/modes.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const STALL_MS = 30 * 1000;
const MATCH_COLS = "id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier, season_id";

/* A player's row on the season ladder, created at zero the first time they are
   paired — the same helper pvp-move carries, over the same table. */
async function ladderRow(svc: SupabaseClient, season: number, player: string) {
  await svc.from("season_ratings")
    .upsert({ season_id: season, player }, { onConflict: "season_id,player", ignoreDuplicates: true });
  const { data } = await svc.from("season_ratings")
    .select("points, peak, wins, losses, draws")
    .eq("season_id", season).eq("player", player).maybeSingle();
  return data ?? { points: 0, peak: 0, wins: 0, losses: 0, draws: 0 };
}


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
  /* A BOT NEVER FORFEITS. A bot only moves inside the human's own request, so
     it is never "absent" in the sense this endpoint exists to punish — and if
     its reply ever failed to land, the turn would sit with it and a player
     could claim a free win off it on demand. The honest resolution for that
     stall is pvp-move's auto:true, which plays the missing move rather than
     awarding the match; the watchdog already calls it. */
  const oppId = myIdx === ME ? match.p2 : match.p1;
  const { data: oppProf } = await svc.from("profiles").select("is_bot").eq("id", oppId).maybeSingle();
  if (oppProf?.is_bot) return json({ error: "opponent-is-a-bot" }, 409);
  if (Date.now() - new Date(match.last_move_at).getTime() < STALL_MS) {
    return json({ error: "not-stalled-yet" }, 425);
  }

  const MODE = modeById(match.modifier).mode;
  const { data: moves } = await svc.from("match_moves").select("idx, who, col").eq("match_id", match.id);
  const { data: seedRow } = await svc.from("match_seeds").select("seed").eq("match_id", match.id).single();
  const s = seedRow && rebuild(seedRow.seed, moves ?? [], MODE);
  if (!s) return json({ error: "corrupt-state" }, 500);

  const p1Score = matchTotal(s, ME, MODE), p2Score = matchTotal(s, AI, MODE);
  const p1Result: Score = myIdx === ME ? 1 : 0;
  const season = match.season_id ?? 1;
  const [l1, l2] = await Promise.all([
    ladderRow(svc, season, match.p1), ladderRow(svc, season, match.p2),
  ]);
  const { da: d1, db: d2, a: next1, b: next2 } = settle(l1, l2, p1Result);
  // claim the row FIRST (status guard) — mirrors pvp-move's finish: only the
  // winner of this update pays out, so racing finishers never double-pay
  const { data: claimed } = await svc.from("matches").update({
    status: "forfeit", winner: user.id, p1_score: p1Score, p2_score: p2Score,
    p1_rating_delta: d1, p2_rating_delta: d2,
    next_die: null, finished_at: new Date().toISOString(),
  }).eq("id", match.id).eq("status", "active").select(MATCH_COLS);
  if (!claimed || claimed.length !== 1) {
    const { data: cur } = await svc.from("matches").select(MATCH_COLS).eq("id", match.id).single();
    return json({ match: cur });
  }
  for (const [player, next] of [[match.p1, next1], [match.p2, next2]] as const) {
    await svc.from("season_ratings").update(next)
      .eq("season_id", season).eq("player", player);
    await svc.from("profiles").update({ rating: next.points }).eq("id", player);
  }
  return json({ match: claimed[0] });
});
