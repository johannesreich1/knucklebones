// pvp-move: the single authority for match progress. Validates the caller's
// move against the server-rebuilt state (turn, legality, seed-stream die),
// writes the move log, detects the end, applies Elo — and when the opponent
// is a bot, computes and records its reply in the same request.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { AI, ME, BOUNTY, isFull, boardTotalMode, legalCols, applyMove, type Player, type Mode } from "./core/rules.ts";
import { rebuild, matchTotal, type MatchState } from "./core/match.ts";
import { settle, botShape, type Score } from "./core/ladder.ts";
import { searchRoot, setRiskW, getRiskW } from "./core/ai.ts";
import { modeById } from "./core/modes.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const MATCH_COLS = "id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier, season_id";

/* How long a player's turn may sit untouched before the OTHER player may ask
   the server to place for them. The turn clock is 10s and an honest client
   places for itself when it expires, so this only ever catches somebody whose
   app is gone — backgrounded, closed, or offline. The waiting player asks; the
   SERVER decides, against its own clock, so neither a wrong device clock nor a
   hostile client can force it early.
   Leaving no longer loses the game outright: it hands your turns to a die. */
const AUTO_MS = 12 * 1000;

async function loadState(svc: SupabaseClient, matchId: string, mode: Mode): Promise<MatchState | null> {
  const { data: moves } = await svc.from("match_moves").select("idx, who, col").eq("match_id", matchId);
  const { data: seedRow } = await svc.from("match_seeds").select("seed").eq("match_id", matchId).single();
  if (!seedRow) return null;
  return rebuild(seedRow.seed, moves ?? [], mode);
}

/* A player's row on the season ladder, created at zero the first time they are
   paired. Season 1 starts empty by design (docs/LADDER.md §6): a row appearing
   here is what "entering the ladder" means. */
async function ladderRow(svc: SupabaseClient, season: number, player: string) {
  await svc.from("season_ratings")
    .upsert({ season_id: season, player }, { onConflict: "season_id,player", ignoreDuplicates: true });
  const { data } = await svc.from("season_ratings")
    .select("points, peak, wins, losses, draws")
    .eq("season_id", season).eq("player", player).maybeSingle();
  return data ?? { points: 0, peak: 0, wins: 0, losses: 0, draws: 0 };
}

/* end of match: scores, winner, and the ladder for both sides (bots included —
   their points drifting toward true strength improves future pairings).
   The points come from core/ladder.ts, so the client, the gate and this
   function cannot disagree about what a match was worth. */
async function finish(svc: SupabaseClient, match: any, s: MatchState, mode: Mode, status: "done" | "forfeit", forfeitWinner?: Player) {
  const p1Score = matchTotal(s, ME, mode), p2Score = matchTotal(s, AI, mode);
  const p1Result: Score = status === "forfeit"
    ? (forfeitWinner === ME ? 1 : 0)
    : (p1Score > p2Score ? 1 : p1Score < p2Score ? 0 : 0.5);
  const season = match.season_id ?? 1;
  const [l1, l2] = await Promise.all([
    ladderRow(svc, season, match.p1), ladderRow(svc, season, match.p2),
  ]);
  const { da: d1, db: d2, a: next1, b: next2 } = settle(l1, l2, p1Result);
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
  /* the ladder is the truth; profiles.rating is a MIRROR of the current
     season, kept so everything already reading it survives untouched */
  for (const [player, next] of [[match.p1, next1], [match.p2, next2]] as const) {
    await svc.from("season_ratings").update(next)
      .eq("season_id", season).eq("player", player);
    await svc.from("profiles").update({ rating: next.points }).eq("id", player);
  }
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
  const { match_id, col, auto } = body ?? {};
  if (typeof match_id !== "string") return json({ error: "bad-request" }, 400);
  if (!auto && !Number.isInteger(col)) return json({ error: "bad-request" }, 400);

  const svc = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: match } = await svc.from("matches").select(MATCH_COLS).eq("id", match_id).maybeSingle();
  if (!match || (match.p1 !== user.id && match.p2 !== user.id)) return json({ error: "no-match" }, 404);
  if (match.status !== "active") return json({ error: "match-over" }, 409);
  const myIdx: Player = match.p1 === user.id ? ME : AI;
  /* Two ways to be entitled to move, ONE pipeline below. Normally you move on
     your own turn. With auto:true you are asking the server to move for an
     opponent who has stopped answering — so the turn check is inverted and the
     stall is proven against the server's clock. */
  const mover: Player = auto ? ((1 - myIdx) as Player) : myIdx;
  if (auto) {
    if (match.turn === myIdx) return json({ error: "your-own-turn" }, 409);
    if (Date.now() - new Date(match.last_move_at).getTime() < AUTO_MS) {
      return json({ error: "not-stalled-yet" }, 425);
    }
  } else if (match.turn !== myIdx) {
    return json({ error: "not-your-turn" }, 409);
  }
  const MODE: Mode = modeById(match.modifier).mode;

  let s = await loadState(svc, match_id, MODE);
  if (!s || s.over || s.turn !== mover) return json({ error: "corrupt-state" }, 500);
  const legal = legalCols(s.st[mover]);
  // an absent player's die goes somewhere legal and unremarkable — the same
  // uniform pick their own client would have made when their clock ran out
  const chosen = auto ? legal[Math.floor(Math.random() * legal.length)] : col;
  if (!legal.includes(chosen)) return json({ error: "illegal-move" }, 422);

  // the move log's primary key (match_id, idx) makes concurrent submits lose
  // cleanly — including an auto-place racing the absent player's own return
  const myDie = s.nextDie;
  const { error: insErr } = await svc.from("match_moves")
    .insert({ match_id, idx: s.moveCount, who: mover, col: chosen, die: myDie });
  if (insErr) return json({ error: "race-lost" }, 409);
  const myHits = applyMove(s.st, mover, chosen, myDie, MODE);
  if (MODE === BOUNTY) s.bounty[mover] += myHits;   // the in-request move banks too

  if (isFull(s.st[mover])) {
    const updated = await finish(svc, match, s, MODE, "done");
    return json({ match: updated, your_die: myDie, auto: !!auto });
  }

  // opponent's turn; if it's a bot, it answers within this request. An
  // auto-place never triggers this: it moved FOR the opponent, so the turn has
  // just come back to the caller.
  const oppId = myIdx === ME ? match.p2 : match.p1;
  const { data: oppProf } = await svc.from("profiles").select("is_bot").eq("id", oppId).single();
  let botMove: { col: number; die: number } | null = null;
  s = (await loadState(svc, match_id, MODE))!;   // re-derive next die cleanly from the log
  if (!auto && oppProf?.is_bot && !s.over) {
    const botIdx = (1 - myIdx) as Player;  // vs a human p1, the bot is always index 0
    const botDie = s.nextDie;
    // Dynamic sparring, keyed to the player's SHARE of the population rather
    // than to a rating number (docs/LADDER.md §4). This used to read the
    // literals 820 / 1080 / 1150 off profiles.rating, which worked only while
    // the rating was a centred Elo. The new ladder climbs for anyone who keeps
    // playing, so absolute thresholds quietly stop meaning anything within a
    // season — and they would have to be re-tuned after every reset. A
    // percentile does not, and it survives a season rollover for free.
    //
    // The three levers behind it are unchanged, and so is what they buy:
    //   · risk sense ramps IN rather than being on from the start — a bot
    //     blind to what you can destroy is beatable while still looking
    //     sensible,
    //   · the search stays short-sighted low down, which reads as a careless
    //     player rather than a broken one,
    //   · a plain slip on top, up to a coin-flip move at the very bottom.
    // A brand-new player sits at 0 points in the bottom percentile and meets
    // something genuinely simple, which is the point of starting at zero.
    const { data: pctRaw } = await svc.rpc("player_percentile", { p: user.id });
    const shape = botShape(Number(pctRaw ?? 0));
    const w = getRiskW(); setRiskW(1.2 * shape.risk);
    let botCol: number;
    if (shape.slip > 0 && Math.random() < shape.slip) {
      const lg = legalCols(s.st[botIdx]);
      botCol = lg[Math.floor(Math.random() * lg.length)];
    } else {
      botCol = searchRoot(s.st, botIdx, botDie, shape.depth, MODE).c;
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
