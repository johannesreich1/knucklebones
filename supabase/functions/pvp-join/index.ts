// pvp-join: enter matchmaking. Pairs with the longest-waiting human, or —
// when the client signals it has waited long enough (allow_bot) — starts a
// match against a pooled bot. Human is always p1 (starts) vs a bot; between
// humans the longer-waiting player is p1. Idempotent: rejoining returns the
// caller's active match — unless they abandoned a bot match past the stall
// window, which forfeits here (bots have no client to call pvp-claim).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { diceStream, poolSequence } from "./core/dice.ts";
import { AI, ME, LIMITED, boardTotalMode, type Player } from "./core/rules.ts";
import { rebuild, matchTotal } from "./core/match.ts";
import { settle, matchBand, SCALE, type Score } from "./core/ladder.ts";
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

  /* Names AND ratings: the mode dial shows who you are about to play, and a
     client can only ever read its OWN profile row (RLS), so anything it should
     know about the opponent has to be handed to it here. */
  const names = async (a: string, b: string) => {
    const { data } = await svc.from("profiles").select("id, nickname, rating").in("id", [a, b]);
    const row = (id: string) => data?.find((p: any) => p.id === id);
    const nick = (id: string) => row(id)?.nickname ?? "???";
    const rate = (id: string) => row(id)?.rating ?? null;
    return { p1: nick(a), p2: nick(b), ratings: { p1: rate(a), p2: rate(b) } };
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
    return json({ status: "matched", rejoined: true, match: active,
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

  const startMatch = async (p1: string, p2: string) => {
    const seed = newSeed();
    // the wheel spins server-side: the modifier is a deterministic draw from
    // the seed, so replay validation and both clients' wheels agree.
    // LIMITED deals its first die from the finite bag, not the endless stream.
    const spec = pickMode(seed);
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
      // handicap: the LOWER-rated player takes the first move — the small
      // first-move edge works as an equalizer. Ties go to the longer wait.
      const { data: theirProf } = await svc.from("profiles").select("rating").eq("id", partner.player_id).single();
      const theirR = theirProf?.rating ?? 0;
      const first = myR < theirR ? uid : partner.player_id;
      const second = first === uid ? partner.player_id : uid;
      const match = await startMatch(first, second);
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
    // Nobody within range — or nobody free at all — and the pool GROWS: a
    // fresh bot is minted at the human's rating, randomly a bit stronger or
    // weaker, so the ladder's edges always have sparring partners.
    free.sort((a: any, b: any) => Math.abs(a.rating - myR) - Math.abs(b.rating - myR));
    const inRange = free.filter((b: any) => Math.abs(b.rating - myR) <= BAND);
    let bot: string | null = null;
    if (inRange.length) {
      const pick = inRange.slice(0, 3);
      bot = pick[Math.floor(Math.random() * pick.length)].id;
    } else {
      // offsets scale with the points, and the floor is 0 — the bottom of the
      // ladder is where new players live, so a bot must be able to stand there
      const off = (40 + Math.floor(Math.random() * 101)) * SCALE * (Math.random() < 0.5 ? -1 : 1);
      const { data: minted } = await svc.rpc("mint_bot", { target_rating: Math.max(0, myR + off) });
      if (minted) bot = minted as string;
      else if (free.length) bot = free[0].id;   // mint failed: nearest bot beats no game
    }
    if (bot) {
      const match = await startMatch(uid, bot);
      if (match) return json({ status: "matched", match, you: 1, names: await names(match.p1, match.p2) });
    }
  }
  return json({ status: "queued" });
});
