// pvp-move: the single authority for match progress. Validates the caller's
// move against the server-rebuilt state (turn, legality, seed-stream die),
// writes the move log, detects the end, applies Elo — and when the opponent
// is a bot, computes and records its reply in the same request.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { AI, ME, isFull, boardTotalMode, legalCols, applyMove, type Player, type Mode } from "./core/rules.ts";
import { rebuild, type MatchState } from "./core/match.ts";
import { eloDelta, type MatchScore } from "./core/elo.ts";
import { searchRoot, setRiskW, getRiskW } from "./core/ai.ts";
import { modeById } from "./core/modes.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const MATCH_COLS = "id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier";

async function loadState(svc: SupabaseClient, matchId: string, mode: Mode): Promise<MatchState | null> {
  const { data: moves } = await svc.from("match_moves").select("idx, who, col").eq("match_id", matchId);
  const { data: seedRow } = await svc.from("match_seeds").select("seed").eq("match_id", matchId).single();
  if (!seedRow) return null;
  return rebuild(seedRow.seed, moves ?? [], mode);
}

/* end of match: scores, winner, Elo for both sides (bots included — their
   hidden rating drifting toward true strength improves future pairings) */
async function finish(svc: SupabaseClient, match: any, s: MatchState, mode: Mode, status: "done" | "forfeit", forfeitWinner?: Player) {
  const p1Score = boardTotalMode(s.st[ME], mode), p2Score = boardTotalMode(s.st[AI], mode);
  const p1Result: MatchScore = status === "forfeit"
    ? (forfeitWinner === ME ? 1 : 0)
    : (p1Score > p2Score ? 1 : p1Score < p2Score ? 0 : 0.5);
  const { data: profs } = await svc.from("profiles").select("id, rating").in("id", [match.p1, match.p2]);
  const r1 = profs!.find((p: any) => p.id === match.p1)!.rating;
  const r2 = profs!.find((p: any) => p.id === match.p2)!.rating;
  const d1 = eloDelta(r1, r2, p1Result);
  const d2 = eloDelta(r2, r1, (1 - p1Result) as MatchScore);
  await svc.from("profiles").update({ rating: r1 + d1 }).eq("id", match.p1);
  await svc.from("profiles").update({ rating: r2 + d2 }).eq("id", match.p2);
  const winner = p1Result === 1 ? match.p1 : p1Result === 0 ? match.p2 : null;
  const { data: updated } = await svc.from("matches").update({
    status, winner, p1_score: p1Score, p2_score: p2Score,
    p1_rating_delta: d1, p2_rating_delta: d2,
    next_die: null, finished_at: new Date().toISOString(), last_move_at: new Date().toISOString(),
  }).eq("id", match.id).select(MATCH_COLS).single();
  return updated;
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
  const { match_id, col } = body ?? {};
  if (typeof match_id !== "string" || !Number.isInteger(col)) return json({ error: "bad-request" }, 400);

  const svc = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: match } = await svc.from("matches").select(MATCH_COLS).eq("id", match_id).maybeSingle();
  if (!match || (match.p1 !== user.id && match.p2 !== user.id)) return json({ error: "no-match" }, 404);
  if (match.status !== "active") return json({ error: "match-over" }, 409);
  const myIdx: Player = match.p1 === user.id ? ME : AI;
  if (match.turn !== myIdx) return json({ error: "not-your-turn" }, 409);
  const MODE: Mode = modeById(match.modifier).mode;

  let s = await loadState(svc, match_id, MODE);
  if (!s || s.over || s.turn !== myIdx) return json({ error: "corrupt-state" }, 500);
  if (!legalCols(s.st[myIdx]).includes(col)) return json({ error: "illegal-move" }, 422);

  // the move log's primary key (match_id, idx) makes concurrent submits lose cleanly
  const myDie = s.nextDie;
  const { error: insErr } = await svc.from("match_moves")
    .insert({ match_id, idx: s.moveCount, who: myIdx, col, die: myDie });
  if (insErr) return json({ error: "race-lost" }, 409);
  applyMove(s.st, myIdx, col, myDie, MODE);

  if (isFull(s.st[myIdx])) {
    const updated = await finish(svc, match, s, MODE, "done");
    return json({ match: updated, your_die: myDie });
  }

  // opponent's turn; if it's a bot, it answers within this request
  const oppId = myIdx === ME ? match.p2 : match.p1;
  const { data: oppProf } = await svc.from("profiles").select("is_bot").eq("id", oppId).single();
  let botMove: { col: number; die: number } | null = null;
  s = (await loadState(svc, match_id, MODE))!;   // re-derive next die cleanly from the log
  if (oppProf?.is_bot && !s.over) {
    const botIdx = (1 - myIdx) as Player;  // vs a human p1, the bot is always index 0
    const botDie = s.nextDie;
    // Dynamic sparring: the bot's strength follows the HUMAN's rating, read
    // at move time. Below 1000 softness ramps in continuously (random moves,
    // no risk sense, shallow search — by ~850 it plays like the local EASY
    // CPU); at 1100+ it sharpens to depth 3. Nobody gets frustrated at the
    // bottom, nobody gets flattered at the top.
    const { data: me } = await svc.from("profiles").select("rating").eq("id", user.id).single();
    const hr = me?.rating ?? 1000;
    const soft = Math.min(1, Math.max(0, (1000 - hr) / 150));   // 0 at 1000 → 1 at ≤850
    const depth = soft > 0.5 ? 1 : hr >= 1100 ? 3 : 2;
    const w = getRiskW(); setRiskW(soft > 0 ? 0.9 * (1 - soft) : hr >= 1100 ? 1.3 : 0.9);
    let botCol: number;
    if (soft > 0 && Math.random() < soft * 0.5) {
      const lg = legalCols(s.st[botIdx]);
      botCol = lg[Math.floor(Math.random() * lg.length)];
    } else {
      botCol = searchRoot(s.st, botIdx, botDie, depth, MODE).c;
    }
    setRiskW(w);
    const { error: botErr } = await svc.from("match_moves")
      .insert({ match_id, idx: s.moveCount, who: botIdx, col: botCol, die: botDie });
    if (!botErr) {
      applyMove(s.st, botIdx, botCol, botDie, MODE);
      botMove = { col: botCol, die: botDie };
      if (isFull(s.st[botIdx])) {
        const updated = await finish(svc, match, s, MODE, "done");
        return json({ match: updated, your_die: myDie, bot_move: botMove });
      }
      s = (await loadState(svc, match_id, MODE))!;
    }
  }

  const { data: updated } = await svc.from("matches").update({
    turn: s.turn, next_die: s.nextDie, last_move_at: new Date().toISOString(),
  }).eq("id", match_id).select(MATCH_COLS).single();
  return json({ match: updated, your_die: myDie, bot_move: botMove });
});
