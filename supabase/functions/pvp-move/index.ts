// pvp-move: the single authority for match progress. Validates the caller's
// move against the server-rebuilt state (turn, legality, seed-stream die),
// writes the move log, detects the end, applies Elo — and when the opponent
// is a bot, computes and records its reply in the same request.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { AI, ME, BOUNTY, isFull, boardTotalMode, legalCols, applyMove, type Player, type Mode } from "./core/rules.ts";
import { rebuild, matchTotal, type MatchState } from "./core/match.ts";
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
  const p1Score = matchTotal(s, ME, mode), p2Score = matchTotal(s, AI, mode);
  const p1Result: MatchScore = status === "forfeit"
    ? (forfeitWinner === ME ? 1 : 0)
    : (p1Score > p2Score ? 1 : p1Score < p2Score ? 0 : 0.5);
  const { data: profs } = await svc.from("profiles").select("id, rating").in("id", [match.p1, match.p2]);
  const r1 = profs!.find((p: any) => p.id === match.p1)!.rating;
  const r2 = profs!.find((p: any) => p.id === match.p2)!.rating;
  const d1 = eloDelta(r1, r2, p1Result);
  const d2 = eloDelta(r2, r1, (1 - p1Result) as MatchScore);
  const winner = p1Result === 1 ? match.p1 : p1Result === 0 ? match.p2 : null;
  // claim the row FIRST (status guard): only the winner of this update pays
  // Elo, so a racing finisher (claim / lazy forfeit) can never double-pay —
  // an unguarded version of this once minted 17 phantom rating points
  const { data: claimed } = await svc.from("matches").update({
    status, winner, p1_score: p1Score, p2_score: p2Score,
    p1_rating_delta: d1, p2_rating_delta: d2,
    next_die: null, finished_at: new Date().toISOString(), last_move_at: new Date().toISOString(),
  }).eq("id", match.id).eq("status", "active").select(MATCH_COLS);
  if (!claimed || claimed.length !== 1) {
    const { data: cur } = await svc.from("matches").select(MATCH_COLS).eq("id", match.id).single();
    return cur;   // someone else finished it — their numbers stand
  }
  await svc.from("profiles").update({ rating: r1 + d1 }).eq("id", match.p1);
  await svc.from("profiles").update({ rating: r2 + d2 }).eq("id", match.p2);
  return claimed[0];
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
  const myHits = applyMove(s.st, myIdx, col, myDie, MODE);
  if (MODE === BOUNTY) s.bounty[myIdx] += myHits;   // the in-request move banks too

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
    // Dynamic sparring: the bot's strength follows the HUMAN's rating, read at
    // move time — softness ramps in continuously, no cliffs, and the bot the
    // player meets at 1100 is a different animal from the one at 900.
    //
    // Retuned 2026-08-18 (player report: "too hard around 950", and the
    // measurements agreed). Against a fixed depth-2 opponent, 50% is an even
    // match and 81% is playing a coin-flipper; the old ramp left rating 950 at
    // ~58%, i.e. a quarter of the way from even to easy, because it still ran
    // a depth-2 search WITH a sense of danger there. Three levers, in the order
    // they matter:
    //   · risk sense is the biggest one — it now fades IN over 970..1080
    //     rather than being on from the start (a bot blind to what you can
    //     destroy is beatable while still looking sensible),
    //   · the search stays SHORT-SIGHTED (depth 1) through the whole ramp,
    //     which reads as a careless player rather than a broken one,
    //   · a plain slip on top, ramping to a coin-flip move at the very bottom.
    // The middle of the ladder is sparring; the top is still a real fight.
    const { data: me } = await svc.from("profiles").select("rating").eq("id", user.id).single();
    const hr = me?.rating ?? 1000;
    const soft = Math.min(1, Math.max(0, (1080 - hr) / 260));   // 1 at ≤820 → 0 at ≥1080
    const depth = soft > 0.2 ? 1 : hr >= 1150 ? 3 : 2;
    const w = getRiskW(); setRiskW(1.2 * Math.max(0, 1 - soft * 2.4));
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
      const botHits = applyMove(s.st, botIdx, botCol, botDie, MODE);
      if (MODE === BOUNTY) s.bounty[botIdx] += botHits;
      botMove = { col: botCol, die: botDie };
      if (isFull(s.st[botIdx])) {
        const updated = await finish(svc, match, s, MODE, "done");
        return json({ match: updated, your_die: myDie, bot_move: botMove });
      }
      s = (await loadState(svc, match_id, MODE))!;
    }
  }

  // LIMITED: the bag can empty without a full board — that ends the game too
  if (s.over) {
    const updated = await finish(svc, match, s, MODE, "done");
    return json({ match: updated, your_die: myDie, bot_move: botMove });
  }

  const { data: updated } = await svc.from("matches").update({
    turn: s.turn, next_die: s.nextDie, last_move_at: new Date().toISOString(),
  }).eq("id", match_id).select(MATCH_COLS).single();
  return json({ match: updated, your_die: myDie, bot_move: botMove });
});
