import { AI, ME, type Player } from "./core/rules.ts";
import {
  LADDER_CURVE_V1,
  LADDER_CURVE_V2,
  botPairBand,
  matchBand,
  SCALE,
  type BotStanding,
  type LadderCurveVersion,
} from "./core/ladder.ts";
import {
  ALL_RANKED_CAPABILITIES,
  RUNE_TRIAL_FORMAT,
  usesRankedActionProtocol,
  type RankedParticipantAccess,
  type RankedPoolTier,
} from "./core/ranked-outcomes.ts";
import { json, type AuthenticatedContext } from "../_shared/http.ts";
import { botStanding, BotStandingUnavailable } from "../_shared/bot-standing.ts";
import { ensureRankedActionBotOpening } from "../_shared/rune-trial-bot-opening.ts";
import {
  findOldestEligiblePartner,
  findRankedBotOpponent,
  rankedBotSides,
  rankedClientCompatibilityError,
  type QueueCandidate,
} from "./matchmaking.ts";
import { MatchStartFailure, startProgressiveRankedMatch, type StartedRankedMatch } from "./start.ts";
import { settleAbandonedBotMatch } from "./stalled-bot-match.ts";
import { classifyEnqueueFailure, type EnqueueFailure } from "./enqueue-refusal.ts";
import {
  MATCH_COLUMNS,
  type JoinInput, type MatchActionRow, type MatchRow, type ProfileSummary,
} from "../_shared/types.ts";

const QUEUE_STALE_MS = 2 * 60 * 1000;

export async function joinMatch(context: AuthenticatedContext, input: JoinInput): Promise<Response> {
  const { user } = context;
  const svc = context.service();
  const uid = user.id;
  const entryKind = input.entryKind ?? "ordinary";
  const { data: runtimeRaw, error: runtimeError } = await svc.rpc("ranked_runtime_contract");
  if (runtimeError || !runtimeRaw || typeof runtimeRaw !== "object" || Array.isArray(runtimeRaw)) {
    return json({ error: "ranked-config-failed" }, 500);
  }
  const runtime = runtimeRaw as {
    curve_version?: number;
    scoring_version?: number;
    admission_paused?: boolean;
  };
  if ((runtime.curve_version !== LADDER_CURVE_V1
      && runtime.curve_version !== LADDER_CURVE_V2)
      || runtime.scoring_version !== runtime.curve_version) {
    return json({ error: "ranked-config-failed" }, 500);
  }
  const curveVersion = runtime.curve_version as LadderCurveVersion;
  const accessFor = async (player: string) => {
    const { data, error } = await svc.rpc("ranked_player_matchmaking_access", {
      p_player: player,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("ranked matchmaking access read failed");
    }
    return data as {
      outcomes?: string[];
      pending_bot_debut?: string | null;
      weekly_unlocked?: boolean;
    };
  };

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

  /* `botMove` is a legacy standard opening baked into the start RPC. Every
     action-protocol opening — Rune Trial or equipped ordinary ranked — is
     committed below by ensureRankedActionBotOpening. Either way the client is
     told a bot moved inside THIS request, so its first read performs that turn
     rather than painting it in one silent frame. */
  const matched = async (
    match: MatchRow,
    rejoined?: boolean | null,
    botMove?: { col: number; die: number } | null,
  ): Promise<Response> => {
    const compatibilityError = rankedClientCompatibilityError(match, input);
    if (compatibilityError) return json({ error: compatibilityError }, 409);
    const myIdx: Player = match.p1 === uid ? ME : AI;
    let honestRejoin = rejoined;
    if (honestRejoin === undefined) {
      const { count, error } = await svc.from(
        usesRankedActionProtocol(match) ? "match_actions" : "match_moves",
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
      privateMatch = payload.match;
      trial = payload.trial;
    }
    if (usesRankedActionProtocol(privateMatch)) {
      let opened: { match: MatchRow; trial?: unknown; bot_actions?: MatchActionRow[] };
      try {
        opened = await ensureRankedActionBotOpening(context, {
          match: privateMatch,
          ...(trial === undefined ? {} : { trial }),
        });
      } catch (error) {
        console.error("pvp-join action bot opening failed:", error);
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
  const compatibilityError = active && rankedClientCompatibilityError(active, input);
  if (compatibilityError) return json({ error: compatibilityError }, 409);
  if (active && !(await settleAbandonedBotMatch(svc, active, uid))) return matched(active);

  /* Pausing admission must not strand a player in an already-active match:
     the lookup and honest rejoin above remain available while the queue and
     every new start are closed. */
  if (runtime.admission_paused) return json({ error: "ranked-paused" }, 503);
  /* The same condition enqueue_ranked_player_v3 applies, stated here so a client
     it would refuse never reaches it. This used to test the capability alone
     while the RPC tests the protocol version too, which left a client claiming
     curve_v2 on protocol 1 to be refused a statement later — by an exception,
     where the reason does not survive (see the enqueue below). */
  if (curveVersion === LADDER_CURVE_V2
      && (input.protocolVersion !== 2 || !input.capabilities.includes("curve_v2"))) {
    return json({ error: "incompatible-client" }, 409);
  }

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

  const { data: queuedRaw, error: queueError } = await svc.rpc("enqueue_ranked_player_v3", {
    p_player: uid,
    p_protocol_version: input.protocolVersion,
    p_capabilities: input.capabilities,
    p_entry_kind: entryKind,
  });
  /* A refusal is not a failure, and the player is told which
     (./enqueue-refusal.ts). */
  if (queueError) {
    const refusal = classifyEnqueueFailure(queueError as EnqueueFailure);
    return json({ error: refusal.error }, refusal.status);
  }
  if (!queuedRaw || typeof queuedRaw !== "object") {
    return json({ error: "queue-failed" }, 500);
  }
  const queueState = queuedRaw as {
    status?: string;
    match_id?: string;
    weekly_rotation_id?: string | null;
  };
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
    bot?: BotStanding & { id: string },
    botDebutOutcome?: string | null,
  ): Promise<StartedRankedMatch | null> => startProgressiveRankedMatch(svc, {
    requester: uid, season, underdog, favourite, queuedOpponent,
    underdogAccess, favouriteAccess, bot,
    curveVersion,
    scoringVersion: runtime.scoring_version as 1 | 2,
    entryKind,
    weeklyRotationId: queueState.weekly_rotation_id ?? null,
    botDebutOutcome: botDebutOutcome ?? null,
  });

  let partner: QueueCandidate | null;
  try {
    partner = await findOldestEligiblePartner(
      svc, uid, myRating, band, curveVersion, entryKind,
      queueState.weekly_rotation_id ?? null,
    );
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
      const [myProgression, partnerProgression] = curveVersion === LADDER_CURVE_V2
        ? await Promise.all([accessFor(uid), accessFor(partner.player_id)])
        : [{ outcomes: undefined }, { outcomes: undefined }];
      const myAccess: RankedParticipantAccess = {
        tier: myTier,
        ...(myProgression.outcomes ? { entitlementIds: myProgression.outcomes } : {}),
        capabilities: input.capabilities,
      };
      const partnerAccess: RankedParticipantAccess = {
        tier: partner.pool_tier ?? "stone",
        ...(partnerProgression.outcomes
          ? { entitlementIds: partnerProgression.outcomes } : {}),
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
      svc, myRating, Math.min(band, botPairBand(myRating, curveVersion)),
    );
    if (!search.ok) return json({ error: search.error }, 500);
    const bot = search.bot;
    if (bot) {
      const { underdog, favourite } = rankedBotSides(uid, myRating, bot.id, bot.rating);
      /* NEON is a position: the bot's shape needs its board standing, not
         only its points. The projection is public to browser roles, so it is
         read through the caller's own client. */
      let standing: BotStanding;
      try {
        standing = await botStanding(context.authed, bot.id, bot.rating, curveVersion);
      } catch (error) {
        if (error instanceof BotStandingUnavailable) return json({ error: "ladder-read-failed" }, 500);
        throw error;
      }
      try {
        const progression = curveVersion === LADDER_CURVE_V2
          ? await accessFor(uid) : { outcomes: undefined, pending_bot_debut: null };
        const humanAccess: RankedParticipantAccess = {
          tier: myTier,
          ...(progression.outcomes ? { entitlementIds: progression.outcomes } : {}),
          capabilities: input.capabilities,
        };
        const botAccess: RankedParticipantAccess = {
          tier: myTier,
          ...(progression.outcomes ? { entitlementIds: progression.outcomes } : {}),
          capabilities: ALL_RANKED_CAPABILITIES,
        };
        const match = await startMatch(
          underdog,
          favourite,
          null,
          underdog === uid ? humanAccess : botAccess,
          favourite === uid ? humanAccess : botAccess,
          { ...standing, id: bot.id },
          progression.pending_bot_debut,
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
