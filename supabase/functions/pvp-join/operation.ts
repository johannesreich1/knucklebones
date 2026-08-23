import { diceStream, poolSequence } from "./core/dice.ts";
import { AI, ME, LIMITED, type Mode, type Player } from "./core/rules.ts";
import { rebuild, matchTotal } from "./core/match.ts";
import { botMove } from "./core/bot.ts";
import { settle, matchBand, botPairBand, SCALE, type Score } from "./core/ladder.ts";
import { modeById, pickMode } from "./core/modes.ts";
import { json, type AuthenticatedContext, type EdgeClient } from "../_shared/http.ts";
import { settleMatch } from "../_shared/settlement.ts";
import { findOldestEligiblePartner } from "./matchmaking.ts";
import type {
  JoinInput, MatchMoveRow, MatchRow, ProfileSummary,
} from "../_shared/types.ts";

const QUEUE_STALE_MS = 2 * 60 * 1000;
const STALL_MS = 30 * 1000;

const newSeed = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function joinMatch(context: AuthenticatedContext, input: JoinInput): Promise<Response> {
  const { user } = context;
  const svc = context.service();
  const uid = user.id;

  /* Opponent presentation data must be returned by this trusted boundary,
     because a client may only read its own profile row through RLS. */
  const names = async (a: string, b: string) => {
    const { data } = await svc.from("profiles").select("id, nickname, rating, avatar").in("id", [a, b]);
    const profiles = (data ?? []) as ProfileSummary[];
    const row = (id: string) => profiles.find((profile) => profile.id === id);
    const nick = (id: string) => row(id)?.nickname ?? "???";
    const rate = (id: string) => row(id)?.rating ?? null;
    const avatar = (id: string) => row(id)?.avatar ?? null;
    return { p1: nick(a), p2: nick(b), ratings: { p1: rate(a), p2: rate(b) },
             avatars: { p1: avatar(a), p2: avatar(b) } };
  };

  // A bot has no client to claim a human's abandoned match, so matchmaking
  // applies the same loss lazily when that human returns.
  const forfeitStalledBotMatch = async (match: MatchRow): Promise<boolean> => {
    const oppId = match.p1 === uid ? match.p2 : match.p1;
    const myIdx: Player = match.p1 === uid ? ME : AI;
    if (match.turn !== myIdx) return false;
    if (Date.now() - new Date(match.last_move_at).getTime() < STALL_MS) return false;
    const { data: opponentData } = await svc.from("profiles").select("is_bot").eq("id", oppId).maybeSingle();
    if (!(opponentData as { is_bot?: boolean } | null)?.is_bot) return false;
    const mode = modeById(match.modifier).mode;
    const { data: moveData } = await svc.from("match_moves").select("idx, who, col").eq("match_id", match.id);
    const moves = (moveData ?? []) as MatchMoveRow[];
    const { data: seedData } = await svc.from("match_seeds").select("seed").eq("match_id", match.id).single();
    const seedRow = seedData as { seed: string } | null;
    const state = seedRow && rebuild(seedRow.seed, moves, mode);
    if (!state) return false;
    const p1Score = matchTotal(state, ME, mode), p2Score = matchTotal(state, AI, mode);
    const p1Result: Score = myIdx === ME ? 0 : 1;
    const result = await settleMatch(svc, match, {
      status: "forfeit",
      winner: oppId,
      p1Score,
      p2Score,
      p1Result,
    }, settle);
    return result.match.status !== "active";
  };

  const { data: activeData } = await svc.from("matches")
    .select("id, p1, p2, status, turn, next_die, last_move_at, modifier, season_id")
    .eq("status", "active").or(`p1.eq.${uid},p2.eq.${uid}`).limit(1).maybeSingle();
  const active = activeData as MatchRow | null;
  if (active && !(await forfeitStalledBotMatch(active))) {
    /* Rejoined means this caller has already moved. A bot's server-written
       opening move must not suppress the human's first mode reveal. */
    const myIdx: Player = active.p1 === uid ? ME : AI;
    const { count } = await svc.from("match_moves")
      .select("*", { count: "exact", head: true }).eq("match_id", active.id).eq("who", myIdx);
    return json({ status: "matched", rejoined: (count ?? 0) > 0, match: active,
                  you: active.p1 === uid ? 1 : 0, names: await names(active.p1, active.p2) });
  }

  await svc.from("matchmaking_queue").delete()
    .lt("created_at", new Date(Date.now() - QUEUE_STALE_MS).toISOString());

  const { data: seasonNow } = await svc.rpc("current_season");
  const season = (seasonNow as number) ?? 1;

  /* When a bot is seated first, make its opening move here. Every later bot
     move rides the human's pvp-move request. */
  const openForBot = async (match: MatchRow, seed: string, mode: Mode, rating: number): Promise<MatchRow> => {
    const state0 = rebuild(seed, [], mode);
    if (!state0) return match;
    const col = botMove(state0.st, ME, state0.nextDie, rating, mode, Math.random);
    if (col < 0) return match;
    const { error } = await svc.from("match_moves")
      .insert({ match_id: match.id, idx: 0, who: ME, col, die: state0.nextDie });
    if (error) return match;
    const state1 = rebuild(seed, [{ idx: 0, who: ME, col }], mode);
    if (!state1) return match;
    const { data: updatedData } = await svc.from("matches").update({
      turn: state1.turn, next_die: state1.nextDie, last_move_at: new Date().toISOString(),
    }).eq("id", match.id)
      .select("id, p1, p2, status, turn, next_die, last_move_at, modifier, season_id").single();
    return (updatedData as MatchRow | null) ?? match;
  };

  /* Callers name the underdog, never raw seat order: the lower-rated player
     opens in every mode, against humans and bots alike. */
  const startMatch = async (
    underdog: string,
    favourite: string,
    bot?: { id: string; rating: number },
  ): Promise<MatchRow | null> => {
    const seed = newSeed();
    const spec = pickMode(seed);
    const p1 = underdog, p2 = favourite;
    const firstDie = spec.mode === LIMITED ? poolSequence(seed)[0] : diceStream(seed)();
    const { data: matchData, error } = await svc.from("matches")
      .insert({ p1, p2, next_die: firstDie, modifier: spec.id, season_id: season })
      .select("id, p1, p2, status, turn, next_die, last_move_at, modifier, season_id").single();
    const match = matchData as MatchRow | null;
    if (error || !match) return null;
    const { error: seedError } = await svc.from("match_seeds").insert({ match_id: match.id, seed });
    if (seedError) { await svc.from("matches").delete().eq("id", match.id); return null; }
    await svc.from("matchmaking_queue").delete().in("player_id", [p1, p2]);
    if (bot && p1 === bot.id) return openForBot(match, seed, spec.mode, bot.rating);
    return match;
  };

  const { data: profileData } = await svc.from("profiles").select("rating").eq("id", uid).single();
  const myRating = (profileData as { rating?: number | null } | null)?.rating ?? 0;
  const { data: nearRaw } = await svc.rpc("players_near", { p: uid, band: 150 * SCALE });
  const band = matchBand(Number(nearRaw ?? 0));

  const partner = await findOldestEligiblePartner(svc, uid, myRating, band);
  if (partner) {
    const { data: claimedData } = await svc.from("matchmaking_queue")
      .delete().eq("player_id", partner.player_id).select("player_id");
    const claimed = claimedData as Array<{ player_id: string }> | null;
    if (claimed && claimed.length === 1) {
      const { data: theirData } = await svc.from("profiles").select("rating").eq("id", partner.player_id).single();
      const theirRating = (theirData as { rating?: number | null } | null)?.rating ?? 0;
      const underdog = myRating < theirRating ? uid : partner.player_id;
      const favourite = underdog === uid ? partner.player_id : uid;
      const match = await startMatch(underdog, favourite);
      if (match) return json({ status: "matched", match, you: match.p1 === uid ? 1 : 0,
                               names: await names(match.p1, match.p2) });
    }
  }

  await svc.from("matchmaking_queue").upsert({ player_id: uid });
  if (input.allowBot) {
    const { data: botData } = await svc.from("profiles").select("id, rating").eq("is_bot", true);
    const bots = (botData ?? []) as ProfileSummary[];
    const { data: busyData } = await svc.from("matches").select("p1, p2").eq("status", "active");
    const busy = (busyData ?? []) as Array<Pick<MatchRow, "p1" | "p2">>;
    const busyIds = new Set(busy.flatMap((match) => [match.p1, match.p2]));
    const free = bots.filter((bot) => !busyIds.has(bot.id));
    const cap = Math.min(band, botPairBand(myRating));
    free.sort((a, b) => Math.abs(a.rating! - myRating) - Math.abs(b.rating! - myRating));
    const inRange = free.filter((bot) => Math.abs(bot.rating! - myRating) <= cap);
    let bot: { id: string; rating: number } | null = null;
    if (inRange.length) {
      const choices = inRange.slice(0, 3);
      const picked = choices[Math.floor(Math.random() * choices.length)];
      bot = { id: picked.id, rating: picked.rating ?? 0 };
    } else {
      const offset = Math.round(cap * (0.15 + Math.random() * 0.35)) * (Math.random() < 0.5 ? -1 : 1);
      const { data: mintedData } = await svc.rpc("mint_bot", { target_rating: Math.max(0, myRating + offset) });
      const minted = mintedData as string | null;
      if (minted) {
        const { data: mintedProfile } = await svc.from("profiles").select("rating").eq("id", minted).maybeSingle();
        const rating = (mintedProfile as { rating?: number | null } | null)?.rating ?? Math.max(0, myRating + offset);
        bot = { id: minted, rating };
      } else if (free.length) {
        bot = { id: free[0].id, rating: free[0].rating ?? 0 };
      }
    }
    if (bot) {
      const underdog = myRating < bot.rating ? uid : bot.id;
      const favourite = underdog === uid ? bot.id : uid;
      const match = await startMatch(underdog, favourite, bot);
      if (match) return json({ status: "matched", match, you: match.p1 === uid ? 1 : 0,
                               names: await names(match.p1, match.p2) });
    }
  }
  return json({ status: "queued" });
}
