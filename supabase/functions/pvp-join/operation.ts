import { diceStream, poolSequence } from "./core/dice.ts";
import { AI, ME, LIMITED, type Mode, type Player } from "./core/rules.ts";
import { rebuild, matchTotal } from "./core/match.ts";
import { botMove } from "./core/bot.ts";
import { settle, matchBand, botPairBand, SCALE, type Score } from "./core/ladder.ts";
import { modeById, pickMode } from "./core/modes.ts";
import { json, type AuthenticatedContext } from "../_shared/http.ts";
import { settleMatch } from "../_shared/settlement.ts";
import { findOldestEligiblePartner, type QueueCandidate } from "./matchmaking.ts";
import type {
  JoinInput, MatchMoveRow, MatchRow, ProfileSummary,
} from "../_shared/types.ts";

const QUEUE_STALE_MS = 2 * 60 * 1000;
const STALL_MS = 30 * 1000;
const MATCH_COLS = "id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier, season_id";

class MatchStartFailure extends Error {}

const newSeed = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function matchPayload(value: unknown): MatchRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const match = (value as Record<string, unknown>).match;
  return match && typeof match === "object" && !Array.isArray(match)
    && typeof (match as Record<string, unknown>).id === "string"
    ? match as MatchRow
    : null;
}

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

  const matched = async (match: MatchRow, rejoined?: boolean | null): Promise<Response> => {
    const myIdx: Player = match.p1 === uid ? ME : AI;
    let honestRejoin = rejoined;
    if (honestRejoin === undefined) {
      const { count, error } = await svc.from("match_moves")
        .select("*", { count: "exact", head: true }).eq("match_id", match.id).eq("who", myIdx);
      if (error) return json({ error: "match-read-failed" }, 500);
      honestRejoin = (count ?? 0) > 0;
    }
    return json({ status: "matched", ...(honestRejoin === null ? {} : { rejoined: honestRejoin }), match,
                  you: match.p1 === uid ? 1 : 0, names: await names(match.p1, match.p2) });
  };

  // A bot has no client to claim a human's abandoned match, so matchmaking
  // applies the same loss lazily when that human returns.
  const forfeitStalledBotMatch = async (match: MatchRow): Promise<boolean> => {
    const oppId = match.p1 === uid ? match.p2 : match.p1;
    const myIdx: Player = match.p1 === uid ? ME : AI;
    if (match.turn !== myIdx) return false;
    if (Date.now() - new Date(match.last_move_at).getTime() < STALL_MS) return false;
    const { data: opponentData, error: opponentError } = await svc.from("profiles")
      .select("is_bot").eq("id", oppId).maybeSingle();
    if (opponentError || !(opponentData as { is_bot?: boolean } | null)?.is_bot) return false;
    const mode = modeById(match.modifier).mode;
    const [{ data: moveData, error: moveError }, { data: seedData, error: seedError }] = await Promise.all([
      svc.from("match_moves").select("idx, who, col").eq("match_id", match.id),
      svc.from("match_seeds").select("seed").eq("match_id", match.id).single(),
    ]);
    if (moveError || seedError) return false;
    const moves = (moveData ?? []) as MatchMoveRow[];
    const seedRow = seedData as { seed: string } | null;
    const state = seedRow && rebuild(seedRow.seed, moves, mode);
    if (!state || state.moveCount !== moves.length || state.turn !== match.turn
      || state.nextDie !== match.next_die) return false;
    const p1Score = matchTotal(state, ME, mode), p2Score = matchTotal(state, AI, mode);
    const p1Result: Score = myIdx === ME ? 0 : 1;
    const result = await settleMatch(svc, match, {
      status: "forfeit",
      winner: oppId,
      p1Score,
      p2Score,
      p1Result,
    }, settle, {
      turn: match.turn,
      lastMoveAt: match.last_move_at,
      moveCount: moves.length,
    });
    return result.match.status !== "active";
  };

  const { data: activeData, error: activeError } = await svc.from("matches")
    .select(MATCH_COLS).eq("status", "active")
    .or(`p1.eq.${uid},p2.eq.${uid}`).limit(1).maybeSingle();
  if (activeError) return json({ error: "match-read-failed" }, 500);
  const active = activeData as MatchRow | null;
  if (active && !(await forfeitStalledBotMatch(active))) return matched(active);

  const { error: staleError } = await svc.from("matchmaking_queue").delete()
    .lt("created_at", new Date(Date.now() - QUEUE_STALE_MS).toISOString());
  if (staleError) return json({ error: "queue-failed" }, 500);

  const { data: seasonNow, error: seasonError } = await svc.rpc("current_season");
  if (seasonError) return json({ error: "season-read-failed" }, 500);
  const season = (seasonNow as number) ?? 1;

  const { data: profileData, error: profileError } = await svc.from("profiles")
    .select("rating").eq("id", uid).single();
  if (profileError) return json({ error: "profile-read-failed" }, 500);
  const myRating = (profileData as { rating?: number | null } | null)?.rating ?? 0;
  const { data: nearRaw, error: nearError } = await svc.rpc("players_near", { p: uid, band: 150 * SCALE });
  if (nearError) return json({ error: "ladder-read-failed" }, 500);
  const band = matchBand(Number(nearRaw ?? 0));

  const { data: queuedRaw, error: queueError } = await svc.rpc("enqueue_ranked_player", { p_player: uid });
  if (queueError || !queuedRaw || typeof queuedRaw !== "object") {
    return json({ error: "queue-failed" }, 500);
  }
  const queueState = queuedRaw as { status?: string; match_id?: string };
  if (queueState.status === "deleting") return json({ error: "account-deleting" }, 409);
  if (queueState.status === "active" && queueState.match_id) {
    const { data: racedData, error: racedError } = await svc.from("matches")
      .select(MATCH_COLS).eq("id", queueState.match_id).maybeSingle();
    if (racedError || !racedData) return json({ error: "match-read-failed" }, 500);
    return matched(racedData as MatchRow);
  }
  if (queueState.status !== "queued") return json({ error: "queue-failed" }, 500);

  /* Callers name the underdog, never raw seat order: the lower-rated player
     opens in every mode, against humans and bots alike. */
  const startMatch = async (
    underdog: string,
    favourite: string,
    queuedOpponent: string | null,
    bot?: { id: string; rating: number },
  ): Promise<MatchRow | null> => {
    const seed = newSeed();
    const spec = pickMode(seed);
    const p1 = underdog, p2 = favourite;
    const firstDie = spec.mode === LIMITED ? poolSequence(seed)[0] : diceStream(seed)();
    let openingCol: number | null = null;
    let afterTurn: Player | null = null;
    let afterDie: number | null = null;
    if (bot && p1 === bot.id) {
      const state0 = rebuild(seed, [], spec.mode);
      if (!state0) return null;
      openingCol = botMove(state0.st, ME, state0.nextDie, bot.rating, spec.mode, Math.random);
      const state1 = openingCol >= 0 ? rebuild(seed, [{ idx: 0, who: ME, col: openingCol }], spec.mode) : null;
      if (!state1) return null;
      afterTurn = state1.turn;
      afterDie = state1.nextDie;
    }
    const { data: started, error } = await svc.rpc("start_ranked_match", {
      p_requester: uid,
      p_p1: p1,
      p_p2: p2,
      p_seed: seed,
      p_next_die: firstDie,
      p_modifier: spec.id,
      p_season_id: season,
      p_queued_opponent: queuedOpponent,
      p_opening_col: openingCol,
      p_opening_die: openingCol == null ? null : firstDie,
      p_after_turn: afterTurn,
      p_after_next_die: afterDie,
    });
    if (error?.code === "P0001") return null;
    if (error) throw new MatchStartFailure(error.message);
    const startedMatch = matchPayload(started);
    if (!startedMatch) throw new MatchStartFailure("invalid start_ranked_match payload");
    return startedMatch;
  };

  let partner: QueueCandidate | null;
  try {
    partner = await findOldestEligiblePartner(svc, uid, myRating, band);
  } catch {
    return json({ error: "queue-failed" }, 500);
  }
  if (partner) {
    const { data: theirData, error: theirError } = await svc.from("profiles")
      .select("rating").eq("id", partner.player_id).single();
    if (theirError) return json({ error: "profile-read-failed" }, 500);
    try {
      const theirRating = (theirData as { rating?: number | null } | null)?.rating ?? 0;
      const underdog = myRating < theirRating ? uid : partner.player_id;
      const favourite = underdog === uid ? partner.player_id : uid;
      const match = await startMatch(underdog, favourite, partner.player_id);
      if (match) return matched(match, null);
    } catch (error) {
      if (error instanceof MatchStartFailure) return json({ error: "match-start-failed" }, 500);
      throw error;
    }
  }

  if (input.allowBot) {
    const [{ data: botData, error: botError }, { data: busyData, error: busyError }] = await Promise.all([
      svc.from("profiles").select("id, rating").eq("is_bot", true),
      svc.from("matches").select("p1, p2").eq("status", "active"),
    ]);
    if (botError || busyError) return json({ error: "bot-read-failed" }, 500);
    const bots = (botData ?? []) as ProfileSummary[];
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
      const { data: mintedData, error: mintError } = await svc.rpc("mint_bot", {
        target_rating: Math.max(0, myRating + offset),
      });
      if (mintError) return json({ error: "bot-create-failed" }, 500);
      const minted = mintedData as string | null;
      if (minted) {
        const { data: mintedProfile, error: mintedError } = await svc.from("profiles")
          .select("rating").eq("id", minted).maybeSingle();
        if (mintedError) return json({ error: "bot-read-failed" }, 500);
        const rating = (mintedProfile as { rating?: number | null } | null)?.rating
          ?? Math.max(0, myRating + offset);
        bot = { id: minted, rating };
      } else if (free.length) {
        bot = { id: free[0].id, rating: free[0].rating ?? 0 };
      }
    }
    if (bot) {
      const underdog = myRating < bot.rating ? uid : bot.id;
      const favourite = underdog === uid ? bot.id : uid;
      try {
        const match = await startMatch(underdog, favourite, null, bot);
        if (match) return matched(match, null);
      } catch (error) {
        if (error instanceof MatchStartFailure) return json({ error: "match-start-failed" }, 500);
        throw error;
      }
    }
  }
  return json({ status: "queued" });
}
