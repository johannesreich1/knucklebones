import { AI, ME, type Player } from "./core/rules.ts";
import { rebuild, matchTotal } from "./core/match.ts";
import { settle, matchBand, botPairBand, SCALE, type Score } from "./core/ladder.ts";
import {
  ALL_RANKED_CAPABILITIES,
  RUNE_TRIAL_FORMAT,
  rankedOutcomeByMatch,
  type RankedParticipantAccess,
  type RankedPoolTier,
} from "./core/ranked-outcomes.ts";
import { rankedActionTotal, rebuildRankedActions, type RankedActionRow } from "./core/ranked-actions.ts";
import { json, type AuthenticatedContext } from "../_shared/http.ts";
import { settleMatch } from "../_shared/settlement.ts";
import {
  findOldestEligiblePartner,
  trialClientCompatibilityError,
  type QueueCandidate,
} from "./matchmaking.ts";
import { MatchStartFailure, startProgressiveRankedMatch } from "./start.ts";
import {
  MATCH_COLUMNS,
  type JoinInput, type MatchMoveRow, type MatchRow, type ProfileSummary,
} from "../_shared/types.ts";

const QUEUE_STALE_MS = 2 * 60 * 1000;
const STALL_MS = 30 * 1000;
const ACTION_COLUMNS = "idx, move_idx, who, kind, rune_id, target_col, placed_col, die_before, die_after";

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
    const compatibilityError = trialClientCompatibilityError(match, input);
    if (compatibilityError) return json({ error: compatibilityError }, 409);
    const myIdx: Player = match.p1 === uid ? ME : AI;
    let honestRejoin = rejoined;
    if (honestRejoin === undefined) {
      const { count, error } = await svc.from(
        match.format === RUNE_TRIAL_FORMAT ? "match_actions" : "match_moves",
      )
        .select("*", { count: "exact", head: true }).eq("match_id", match.id).eq("who", myIdx);
      if (error) return json({ error: "match-read-failed" }, 500);
      honestRejoin = (count ?? 0) > 0;
    }
    let privateMatch = match;
    let trial: unknown;
    if (match.format === RUNE_TRIAL_FORMAT) {
      const { data: trialData, error: trialError } = await svc.rpc("rune_trial_state", {
        p_match_id: match.id,
        p_actor: uid,
      });
      if (trialError || !trialData || typeof trialData !== "object" || Array.isArray(trialData)) {
        return json({ error: "match-read-failed" }, 500);
      }
      const payload = trialData as { match?: MatchRow; trial?: unknown };
      if (!payload.match) return json({ error: "match-read-failed" }, 500);
      privateMatch = payload.match;
      trial = payload.trial;
    }
    return json({
      status: "matched",
      ...(honestRejoin === null ? {} : { rejoined: honestRejoin }),
      match: privateMatch,
      ...(trial === undefined ? {} : { trial }),
      you: privateMatch.p1 === uid ? 1 : 0,
      names: await names(privateMatch.p1, privateMatch.p2),
    });
  };

  // A bot has no client to claim a human's abandoned match, so matchmaking
  // applies the same loss lazily when that human returns.
  const forfeitStalledBotMatch = async (match: MatchRow): Promise<boolean> => {
    const oppId = match.p1 === uid ? match.p2 : match.p1;
    const myIdx: Player = match.p1 === uid ? ME : AI;
    if (match.phase !== "playing" || match.turn !== myIdx) return false;
    if (Date.now() - new Date(match.last_move_at).getTime() < STALL_MS) return false;
    const { data: opponentData, error: opponentError } = await svc.from("profiles")
      .select("is_bot").eq("id", oppId).maybeSingle();
    if (opponentError || !(opponentData as { is_bot?: boolean } | null)?.is_bot) return false;
    let outcome;
    try { outcome = rankedOutcomeByMatch(match.format, match.modifier); }
    catch { return false; }
    const [{ data: moveData, error: moveError }, { data: actionData, error: actionError },
      { data: seedData, error: seedError }] = await Promise.all([
      svc.from("match_moves").select("idx, who, col").eq("match_id", match.id),
      svc.from("match_actions").select(ACTION_COLUMNS).eq("match_id", match.id),
      svc.from("match_seeds").select("seed").eq("match_id", match.id).single(),
    ]);
    if (moveError || actionError || seedError) return false;
    const moves = (moveData ?? []) as MatchMoveRow[];
    const seedRow = seedData as { seed: string } | null;
    if (!seedRow) return false;
    let p1Score: number, p2Score: number, moveCount: number;
    if (match.format === RUNE_TRIAL_FORMAT) {
      if (!match.p1_rune || !match.p2_rune) return false;
      const actions = (actionData ?? []) as RankedActionRow[];
      const state = rebuildRankedActions(
        seedRow.seed, actions, outcome.mode, [match.p2_rune, match.p1_rune],
      );
      if (!state || state.actionCount !== match.action_version || state.turn !== match.turn
          || state.nextDie !== match.next_die || state.moveCount !== moves.length
          || state.pendingAim !== match.pending_aim) return false;
      p1Score = rankedActionTotal(state, ME, outcome.mode);
      p2Score = rankedActionTotal(state, AI, outcome.mode);
      moveCount = state.moveCount;
    } else {
      const state = rebuild(seedRow.seed, moves, outcome.mode);
      if (!state || state.moveCount !== moves.length || state.turn !== match.turn
          || state.nextDie !== match.next_die) return false;
      p1Score = matchTotal(state, ME, outcome.mode);
      p2Score = matchTotal(state, AI, outcome.mode);
      moveCount = moves.length;
    }
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
      moveCount,
    });
    return result.match.status !== "active";
  };

  const { data: activeData, error: activeError } = await svc.from("matches")
    .select(MATCH_COLUMNS).eq("status", "active")
    .or(`p1.eq.${uid},p2.eq.${uid}`).limit(1).maybeSingle();
  if (activeError) return json({ error: "match-read-failed" }, 500);
  const active = activeData as MatchRow | null;
  const compatibilityError = active && trialClientCompatibilityError(active, input);
  if (compatibilityError) return json({ error: compatibilityError }, 409);
  if (active && !(await forfeitStalledBotMatch(active))) return matched(active);

  const { error: staleError } = await svc.from("matchmaking_queue").delete()
    .lt("created_at", new Date(Date.now() - QUEUE_STALE_MS).toISOString());
  if (staleError) return json({ error: "queue-failed" }, 500);

  const { data: seasonNow, error: seasonError } = await svc.rpc("current_season");
  if (seasonError) return json({ error: "season-read-failed" }, 500);
  const season = (seasonNow as number) ?? 1;

  const { data: profileData, error: profileError } = await svc.from("profiles")
    .select("rating, ranked_pool_tier").eq("id", uid).single();
  if (profileError) return json({ error: "profile-read-failed" }, 500);
  const myProfile = profileData as {
    rating?: number | null;
    ranked_pool_tier?: RankedPoolTier | null;
  } | null;
  const myRating = myProfile?.rating ?? 0;
  const myTier = myProfile?.ranked_pool_tier ?? "stone";
  const { data: nearRaw, error: nearError } = await svc.rpc("players_near", { p: uid, band: 150 * SCALE });
  if (nearError) return json({ error: "ladder-read-failed" }, 500);
  const band = matchBand(Number(nearRaw ?? 0));

  const { data: queuedRaw, error: queueError } = await svc.rpc("enqueue_ranked_player_v2", {
    p_player: uid,
    p_protocol_version: input.protocolVersion,
    p_capabilities: input.capabilities,
  });
  if (queueError || !queuedRaw || typeof queuedRaw !== "object") {
    return json({ error: "queue-failed" }, 500);
  }
  const queueState = queuedRaw as { status?: string; match_id?: string };
  if (queueState.status === "deleting") return json({ error: "account-deleting" }, 409);
  if (queueState.status === "active" && queueState.match_id) {
    const { data: racedData, error: racedError } = await svc.from("matches")
      .select(MATCH_COLUMNS).eq("id", queueState.match_id).maybeSingle();
    if (racedError || !racedData) return json({ error: "match-read-failed" }, 500);
    return matched(racedData as MatchRow);
  }
  if (queueState.status !== "queued") return json({ error: "queue-failed" }, 500);

  /* Callers name the underdog, never raw seat order. */
  const startMatch = async (
    underdog: string,
    favourite: string,
    queuedOpponent: string | null,
    underdogAccess: RankedParticipantAccess,
    favouriteAccess: RankedParticipantAccess,
    bot?: { id: string; rating: number },
  ): Promise<MatchRow | null> => startProgressiveRankedMatch(svc, {
    requester: uid, season, underdog, favourite, queuedOpponent,
    underdogAccess, favouriteAccess, bot,
  });

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
      const myAccess: RankedParticipantAccess = {
        tier: myTier,
        capabilities: input.capabilities,
      };
      const partnerAccess: RankedParticipantAccess = {
        tier: partner.pool_tier ?? "stone",
        capabilities: partner.capabilities ?? [],
      };
      const match = await startMatch(
        underdog,
        favourite,
        partner.player_id,
        underdog === uid ? myAccess : partnerAccess,
        favourite === uid ? myAccess : partnerAccess,
      );
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
        const humanAccess: RankedParticipantAccess = {
          tier: myTier,
          capabilities: input.capabilities,
        };
        const botAccess: RankedParticipantAccess = {
          tier: myTier,
          capabilities: ALL_RANKED_CAPABILITIES,
        };
        const match = await startMatch(
          underdog,
          favourite,
          null,
          underdog === uid ? humanAccess : botAccess,
          favourite === uid ? humanAccess : botAccess,
          bot,
        );
        if (match) return matched(match, null);
      } catch (error) {
        if (error instanceof MatchStartFailure) return json({ error: "match-start-failed" }, 500);
        throw error;
      }
    }
  }
  return json({ status: "queued" });
}
