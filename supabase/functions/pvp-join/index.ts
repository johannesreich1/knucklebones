// pvp-join: enter matchmaking. Pairs with the longest-waiting human, or —
// when the client signals it has waited long enough (allow_bot) — starts a
// match against a pooled bot. Human is always p1 (starts) vs a bot, because a
// bot cannot open; between humans the LOWER-RATED player takes the seat the
// mode favours, which is p1 everywhere except LIMITED (see startMatch, and
// core/modes seatEdge for the measurement). Idempotent: rejoining returns the
// caller's active match — unless they abandoned a bot match past the stall
// window, which forfeits here (bots have no client to call pvp-claim).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { diceStream, poolSequence } from "./core/dice.ts";
import { AI, ME, LIMITED, boardTotalMode, type Player } from "./core/rules.ts";
import { rebuild, matchTotal } from "./core/match.ts";
import { settle, matchBand, botPairBand, SCALE, type Score } from "./core/ladder.ts";
import { modeById, pickMode, seatsFor } from "./core/modes.ts";

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

  /* A player's row on the season ladder, created at zero the first time they
     are paired — the same helper pvp-move and pvp-claim carry. */
  const ladderRow = async (season: number, player: string) => {
    await svc.from("season_ratings")
      .upsert({ season_id: season, player }, { onConflict: "season_id,player", ignoreDuplicates: true });
    const { data, error } = await svc.from("season_ratings")
      .select("points, peak, wins, losses, draws")
      .eq("season_id", season).eq("player", player).maybeSingle();
    /* NEVER fall back to a default — see the note in pvp-move. A missing grant
       once made a failed read look like an unrated player rather than an
       error, and matches settled against that guess. */
    if (error) throw new Error(`ladder read failed for ${player}: ${error.message}`);
    if (!data) throw new Error(`no ladder row for ${player} in season ${season} after upsert`);
    return data;
  };

  /* Names, ratings AND avatars: the mode dial shows who you are about to
     play, and a client can only ever read its OWN profile row (RLS), so
     anything it should know about the opponent has to be handed to it here. */
  const names = async (a: string, b: string) => {
    const { data } = await svc.from("profiles").select("id, nickname, rating, avatar").in("id", [a, b]);
    const row = (id: string) => data?.find((p: any) => p.id === id);
    const nick = (id: string) => row(id)?.nickname ?? "???";
    const rate = (id: string) => row(id)?.rating ?? null;
    const av = (id: string) => row(id)?.avatar ?? null;
    return { p1: nick(a), p2: nick(b), ratings: { p1: rate(a), p2: rate(b) },
             avatars: { p1: av(a), p2: av(b) } };
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
    // The arithmetic is core/ladder.ts's settle(), shared with pvp-move and
    // pvp-claim — the three used to carry a copy each. Claim the row first
    // (the status guard beats a concurrent finish), pay out after.
    const p1Score = matchTotal(s, ME, MODE), p2Score = matchTotal(s, AI, MODE);
    const p1Result: Score = myIdx === ME ? 0 : 1;    // the leaver loses
    const season = m.season_id ?? 1;
    const [l1, l2] = await Promise.all([ladderRow(season, m.p1), ladderRow(season, m.p2)]);
    const { da: d1, db: d2, a: next1, b: next2 } = settle(l1, l2, p1Result);
    const { data: claimed } = await svc.from("matches").update({
      status: "forfeit", winner: oppId, p1_score: p1Score, p2_score: p2Score,
      p1_rating_delta: d1, p2_rating_delta: d2,
      next_die: null, finished_at: new Date().toISOString(),
    }).eq("id", m.id).eq("status", "active").select("id");
    if (!claimed || claimed.length !== 1) return false;
    for (const [player, next] of [[m.p1, next1], [m.p2, next2]] as const) {
      await svc.from("season_ratings").update(next)
        .eq("season_id", season).eq("player", player);
      await svc.from("profiles").update({ rating: next.points }).eq("id", player);
    }
    return true;
  };

  // rejoin an active match if one exists (reconnects, page reloads)
  const { data: active } = await svc.from("matches")
    .select("id, p1, p2, status, turn, next_die, last_move_at, modifier, season_id")
    .eq("status", "active").or(`p1.eq.${uid},p2.eq.${uid}`).limit(1).maybeSingle();
  if (active && !(await forfeitStalledBotMatch(active))) {
    /* rejoined tells the client to SKIP the mode-wheel reveal — but a match
       nobody has moved in yet is a fresh PAIRING, not a reconnect: the
       WAITING player's next poll lands here whenever the partner's own join
       created the match between polls, and an unconditional true dropped
       exactly one of the two players straight onto the board while the other
       watched the wheel (user report, live match 2026-08-21). Zero moves =
       the reveal has not been seen: show it. A true reconnect before the
       first move sees the wheel again, which costs a five-second hold. */
    const { count } = await svc.from("match_moves")
      .select("*", { count: "exact", head: true }).eq("match_id", active.id);
    return json({ status: "matched", rejoined: (count ?? 0) > 0, match: active,
                  you: active.p1 === uid ? 1 : 0, names: await names(active.p1, active.p2) });
  }

  // opportunistic hygiene: drop stale queue entries
  await svc.from("matchmaking_queue").delete()
    .lt("created_at", new Date(Date.now() - QUEUE_STALE_MS).toISOString());

  /* Every match is stamped with the season it began in. A match must never
     settle against a ladder it did not start on — that is the same rule the
     cutover applied to the games that were live when the scale changed. */
  const { data: seasonNow } = await svc.rpc("current_season");
  const season = (seasonNow as number) ?? 1;

  /* Callers name who is BEHIND, never a raw p1/p2 order, so the ranked
     handicap cannot be dropped by forgetting it at a new call site. The rule
     itself lives in core/modes seatsFor() — one implementation, gated by
     tests/modes.test.ts, because it decides real ranked outcomes: the
     underdog takes the seat the MODE favours, which is p1 everywhere except
     LIMITED, whose even 24-die bag hands the last placement across. */
  const startMatch = async (underdog: string, favourite: string, forceFirst?: string) => {
    const seed = newSeed();
    // the wheel spins server-side: the modifier is a deterministic draw from
    // the seed, so replay validation and both clients' wheels agree.
    // LIMITED deals its first die from the finite bag, not the endless stream.
    const spec = pickMode(seed);
    const [p1, p2] = seatsFor(spec, underdog, favourite, forceFirst);
    const firstDie = spec.mode === LIMITED ? poolSequence(seed)[0] : diceStream(seed)();
    const { data: match, error } = await svc.from("matches")
      .insert({ p1, p2, next_die: firstDie, modifier: spec.id, season_id: season })
      .select("id, p1, p2, status, turn, next_die, last_move_at, modifier, season_id").single();
    if (error || !match) return null;
    const { error: seedErr } = await svc.from("match_seeds").insert({ match_id: match.id, seed });
    if (seedErr) { await svc.from("matches").delete().eq("id", match.id); return null; }
    await svc.from("matchmaking_queue").delete().in("player_id", [p1, p2]);
    return match;
  };

  /* profiles.rating is the mirror of this season's ladder points, so it starts
     at 0 like everything else — NOT at 1000, which was the old Elo's centre. */
  const { data: myProf } = await svc.from("profiles").select("rating").eq("id", uid).single();
  const myR = myProf?.rating ?? 0;
  /* How wide to look for an opponent: tight when the neighbourhood is crowded,
     open when it is empty (docs/LADDER.md §4). A brand-new player at 0 points
     has nobody beside them on day one, so a fixed window would strand them. */
  const { data: nearRaw } = await svc.rpc("players_near", { p: uid, band: 150 * SCALE });
  const BAND = matchBand(Number(nearRaw ?? 0));

  // try to pair with the longest-waiting other human
  const { data: partner } = await svc.from("matchmaking_queue")
    .select("player_id").neq("player_id", uid)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (partner) {
    // claim them atomically-ish: whoever deletes the row wins the pairing
    const { data: claimed } = await svc.from("matchmaking_queue")
      .delete().eq("player_id", partner.player_id).select("player_id");
    if (claimed && claimed.length === 1) {
      // handicap: the LOWER-rated player takes the seat the MODE favours —
      // which is not always the first one (startMatch owns that rule).
      // Ties go to the longer wait.
      const { data: theirProf } = await svc.from("profiles").select("rating").eq("id", partner.player_id).single();
      const theirR = theirProf?.rating ?? 0;
      const underdog = myR < theirR ? uid : partner.player_id;
      const favourite = underdog === uid ? partner.player_id : uid;
      const match = await startMatch(underdog, favourite);
      if (match) return json({ status: "matched", match, you: match.p1 === uid ? 1 : 0, names: await names(match.p1, match.p2) });
    }
  }

  // no partner: sit in the queue; with allow_bot, back-fill from the bot pool.
  // (Vs a bot the human MUST be p1: bots only move inside the human's
  // requests, so a bot could never make the opening move.)
  await svc.from("matchmaking_queue").upsert({ player_id: uid });
  if (allowBot) {
    const { data: bots } = await svc.from("profiles").select("id, rating").eq("is_bot", true);
    const { data: busy } = await svc.from("matches").select("p1, p2").eq("status", "active");
    const busyIds = new Set((busy ?? []).flatMap((m: any) => [m.p1, m.p2]));
    const free = (bots ?? []).filter((b: any) => !busyIds.has(b.id));
    // rating-matched backfill: one of the three free bots closest to the
    // human's rating (a dash of randomness so it isn't always the same face).
    // A bot's strength IS its rating now (its own group's shape, LADDER.md
    // §4), so the human matchmaking BAND is too generous here: it opens to
    // ±4500 when the ladder is sparse, which sat a 148-point STONE player
    // across 784-point IVORY bots. A bot is minted or picked, never waited
    // for, so it never needs to arrive from groups away — the cap is the
    // player's own group width. Nobody inside it — or nobody free at all —
    // and the pool GROWS: a fresh bot is minted a step up or down from the
    // human, inside the same cap, so the ladder's edges always have honest
    // sparring partners.
    const CAP = Math.min(BAND, botPairBand(myR));
    free.sort((a: any, b: any) => Math.abs(a.rating - myR) - Math.abs(b.rating - myR));
    const inRange = free.filter((b: any) => Math.abs(b.rating - myR) <= CAP);
    let bot: string | null = null;
    if (inRange.length) {
      const pick = inRange.slice(0, 3);
      bot = pick[Math.floor(Math.random() * pick.length)].id;
    } else {
      // 15–50% of the cap, either side; the floor is 0 — the bottom of the
      // ladder is where new players live, so a bot must be able to stand there
      const off = Math.round(CAP * (0.15 + Math.random() * 0.35)) * (Math.random() < 0.5 ? -1 : 1);
      const { data: minted } = await svc.rpc("mint_bot", { target_rating: Math.max(0, myR + off) });
      if (minted) bot = minted as string;
      else if (free.length) bot = free[0].id;   // mint failed: nearest bot beats no game
    }
    if (bot) {
      // Seated by NECESSITY, not by the handicap: a bot cannot make the
      // opening move, so the human is p1 here whichever seat the mode
      // favours, and whichever of the two is actually rated lower. The cost
      // is real but small — weighted across the wheel the human gains ~0.4
      // points of win probability — and removing it means teaching pvp-join
      // to play the bot's opening move at match creation.
      const match = await startMatch(uid, bot, uid);
      // derived, not asserted: `you` must follow the seats actually written,
      // so this cannot quietly lie if the bot ever learns to open
      if (match) return json({ status: "matched", match, you: match.p1 === uid ? 1 : 0, names: await names(match.p1, match.p2) });
    }
  }
  return json({ status: "queued" });
});
