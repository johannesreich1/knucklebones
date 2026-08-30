import { AI, ME, type Player } from "./core/rules.ts";
import { botPairBand, matchBand, SCALE } from "./core/ladder.ts";
import {
  ALL_RANKED_CAPABILITIES,
  RUNE_TRIAL_FORMAT,
  type RankedParticipantAccess,
  type RankedPoolTier,
} from "./core/ranked-outcomes.ts";
import { json, type AuthenticatedContext } from "../_shared/http.ts";
import { ensureRuneTrialBotOpening } from "../_shared/rune-trial-bot-opening.ts";
import {
  findOldestEligiblePartner,
  findRankedBotOpponent,
  rankedBotSides,
  trialClientCompatibilityError,
  type QueueCandidate,
} from "./matchmaking.ts";
import { MatchStartFailure, startProgressiveRankedMatch, type StartedRankedMatch } from "./start.ts";
import { settleAbandonedBotMatch } from "./stalled-bot-match.ts";
import {
  MATCH_COLUMNS,
  type JoinInput, type MatchActionRow, type MatchRow, type ProfileSummary,
} from "../_shared/types.ts";

const QUEUE_STALE_MS = 2 * 60 * 1000;

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

  /* `botMove` is ordinary ranked's opening, handed in by the start that baked it.
     The Rune Trial's equivalent is produced inside this function instead, by
     ensureRuneTrialBotOpening, because its opener is committed here. Either way
     the client is told a bot moved inside THIS request, so its first read can
     perform that turn rather than paint it in one silent frame. */
  const matched = async (
    match: MatchRow,
    rejoined?: boolean | null,
    botMove?: { col: number; die: number } | null,
  ): Promise<Response> => {
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
    let openerActions: MatchActionRow[] | undefined;
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
      let opened: { match: MatchRow; trial?: unknown; bot_actions?: MatchActionRow[] };
      try {
        opened = await ensureRuneTrialBotOpening(context, {
          match: payload.match,
          trial: payload.trial,
        });
      } catch (error) {
        console.error("pvp-join bot opening failed:", error);
        return json({ error: "match-read-failed" }, 500);
      }
      privateMatch = opened.match;
      trial = opened.trial;
      openerActions = opened.bot_actions;
    }
    return json({
      status: "matched",
      ...(honestRejoin === null ? {} : { rejoined: honestRejoin }),
      match: privateMatch,
      ...(trial === undefined ? {} : { trial }),
      ...(openerActions?.length ? { bot_actions: openerActions } : {}),
      ...(botMove ? { bot_move: botMove } : {}),
      you: privateMatch.p1 === uid ? 1 : 0,
      names: await names(privateMatch.p1, privateMatch.p2),
    });
  };

  const { data: activeData, error: activeError } = await svc.from("matches")
    .select(MATCH_COLUMNS).eq("status", "active")
    .or(`p1.eq.${uid},p2.eq.${uid}`).limit(1).maybeSingle();
  if (activeError) return json({ error: "match-read-failed" }, 500);
  const active = activeData as MatchRow | null;
  const compatibilityError = active && trialClientCompatibilityError(active, input);
  if (compatibilityError) return json({ error: compatibilityError }, 409);
  if (active && !(await settleAbandonedBotMatch(svc, active, uid))) return matched(active);

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
    return matched(racedData as unknown as MatchRow);
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
  ): Promise<StartedRankedMatch | null> => startProgressiveRankedMatch(svc, {
    requester: uid, season, underdog, favourite, queuedOpponent,
    underdogAccess, favouriteAccess, bot,
  });

  let partner: QueueCandidate | null;
  try {
    partner = await findOldestEligiblePartner(svc, uid, myRating, band);
  } catch (error) {
    console.error("pvp-join partner search failed:", error);
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
      if (match) return matched(match.match, null, match.botMove);
    } catch (error) {
      if (error instanceof MatchStartFailure) {
        console.error("pvp-join match start failed:", error);
        return json({ error: "match-start-failed" }, 500);
      }
      throw error;
    }
  }

  if (input.allowBot) {
    const search = await findRankedBotOpponent(
      svc, myRating, Math.min(band, botPairBand(myRating)),
    );
    if (!search.ok) return json({ error: search.error }, 500);
    const bot = search.bot;
    if (bot) {
      const { underdog, favourite } = rankedBotSides(uid, myRating, bot.id, bot.rating);
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
        if (match) return matched(match.match, null, match.botMove);
      } catch (error) {
        if (error instanceof MatchStartFailure) {
          console.error("pvp-join match start failed:", error);
          return json({ error: "match-start-failed" }, 500);
        }
        throw error;
      }
    }
  }
  return json({ status: "queued" });
}
