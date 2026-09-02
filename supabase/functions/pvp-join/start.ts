import { diceStream, poolSequence } from "./core/dice.ts";
import { botMove } from "./core/bot.ts";
import type { BotStanding } from "./core/ladder.ts";
import { rebuild } from "./core/match.ts";
import { LIMITED, ME, type Player } from "./core/rules.ts";
import {
  RANKED_POOL_TIERS,
  RUNE_TRIAL_FORMAT,
  legacyRankedOutcomeEntitlementsForPeak,
  pickRankedOutcome,
  rankedOutcomeById,
  rankedOutcomePool,
  type RankedParticipantAccess,
  type RankedPoolTier,
} from "./core/ranked-outcomes.ts";
import {
  RUNE_TRIAL_PICK_SECS,
  RUNE_TRIAL_CLAIM_REWARD_V2,
  RUNE_TRIAL_SELECTED_REWARD_V1,
  seededRuneTrialAutoPick,
  seededRuneTrialClaim,
  seededRuneTrialOffer,
} from "./core/rune-trial-offer.ts";
import type { EdgeClient } from "../_shared/http.ts";
import type { MatchRow } from "../_shared/types.ts";
import {
  negotiatedEquippedRuneProtocol,
  negotiatedProtocolVersion,
  rankedSeatOrder,
} from "./matchmaking.ts";

export class MatchStartFailure extends Error {}

interface ProgressiveMatchStart {
  requester: string;
  season: number;
  underdog: string;
  favourite: string;
  queuedOpponent: string | null;
  underdogAccess: RankedParticipantAccess;
  favouriteAccess: RankedParticipantAccess;
  bot?: BotStanding & { id: string };
  curveVersion: 1 | 2;
  scoringVersion: 1 | 2;
  entryKind: "ordinary" | "weekly";
  weeklyRotationId: string | null;
  botDebutOutcome: string | null;
}

const newSeed = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");

function matchPayload(value: unknown): MatchRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const match = (value as Record<string, unknown>).match;
  return match && typeof match === "object" && !Array.isArray(match)
    && typeof (match as Record<string, unknown>).id === "string"
    ? match as MatchRow
    : null;
}

/** Pick the shared pool outcome and persist its complete atomic start record. */
/** The started match, plus the bot opening this call baked into it (if any). */
export interface StartedRankedMatch {
  match: MatchRow;
  /* THE OPENING THE BOT JUST PLAYED. Written into the match by the start RPC,
     so the client's first read finds it already on the board and cannot tell it
     apart from history — which is how a bot's opener came to appear in one
     silent frame while its mid-game replies were performed. Saying so here is
     the legacy-standard half of the `bot_actions` signal used by every action
     match. Null whenever the human opens, or on a rejoin. */
  botMove: { col: number; die: number } | null;
}

export async function startProgressiveRankedMatch(
  svc: EdgeClient,
  input: ProgressiveMatchStart,
): Promise<StartedRankedMatch | null> {
  if (input.scoringVersion !== input.curveVersion) {
    throw new MatchStartFailure("ranked curve/scoring contract is inconsistent");
  }
  const seed = newSeed();
  const legacyPeak = (tier: RankedPoolTier) => tier === "stone" ? 0
    : tier === "bone" ? 300 : 720;
  const effectiveAccess = (access: RankedParticipantAccess): RankedParticipantAccess => {
    const entitlements = input.curveVersion === 1
      ? legacyRankedOutcomeEntitlementsForPeak(legacyPeak(access.tier))
      : (access.entitlementIds ?? []);
    return {
      ...access,
      entitlementIds: input.curveVersion === 2
        ? entitlements.filter((id) => id !== RUNE_TRIAL_FORMAT
          || access.capabilities.includes("rune_trial_claim_v2"))
        : entitlements,
    };
  };
  const accesses = [
    effectiveAccess(input.underdogAccess),
    effectiveAccess(input.favouriteAccess),
  ] as const;
  let weeklyModifier: string | null = null;
  if (input.entryKind === "weekly") {
    if (!input.weeklyRotationId) throw new MatchStartFailure("weekly rotation is missing");
    const { data, error } = await svc.from("ranked_weekly_rotations")
      .select("modifier").eq("id", input.weeklyRotationId).single();
    if (error || !data || typeof (data as { modifier?: unknown }).modifier !== "string") {
      throw new MatchStartFailure("weekly rotation read failed");
    }
    weeklyModifier = (data as { modifier: string }).modifier;
  }
  const ordinaryRoster = rankedOutcomePool(accesses).map(({ outcome }) => outcome.id);
  /* A pending debut is a promise, not authority to violate this client's
     negotiated capabilities. Leave an unsupported Rune Trial pending by
     sending null; a later capable bot game will consume it. */
  const requestedBotDebut = input.entryKind === "ordinary"
    ? input.botDebutOutcome : null;
  const botDebutOutcome = requestedBotDebut
      && ordinaryRoster.includes(requestedBotDebut)
    ? requestedBotDebut : null;
  const spec = weeklyModifier
    ? rankedOutcomeById(weeklyModifier)
    : botDebutOutcome
    ? rankedOutcomeById(botDebutOutcome)
    : pickRankedOutcome(seed, accesses);
  if (!weeklyModifier && !ordinaryRoster.includes(spec.id)) {
    throw new MatchStartFailure("forced ranked outcome is outside negotiated roster");
  }
  const outcomeRoster = weeklyModifier ? [spec.id] : ordinaryRoster;
  /* Curve v2 is itself a protocol-v2 wire contract, even when this particular
     standard/weekly outcome has no Rune Trial or equipped-rune capability. */
  const protocolVersion = input.curveVersion === 2
    ? 2 : negotiatedProtocolVersion(accesses);
  const equippedRuneProtocol = negotiatedEquippedRuneProtocol(spec.format, accesses);
  const { p1, p2 } = rankedSeatOrder(input.underdog, input.favourite);
  const firstDie = spec.mode === LIMITED ? poolSequence(seed)[0] : diceStream(seed)();
  let openingCol: number | null = null;
  let afterTurn: Player | null = null;
  let afterDie: number | null = null;
  /* An equipped-capable standard match always uses the action log, including
     when both server snapshots are bare. Its bot opening is committed through
     the shared action opener after the database returns the locked snapshots;
     only the legacy placement protocol can bake an opening move here. */
  if (input.bot && spec.format !== RUNE_TRIAL_FORMAT
      && !equippedRuneProtocol && p1 === input.bot.id) {
    const state0 = rebuild(seed, [], spec.mode);
    if (!state0) return null;
    openingCol = botMove(
      state0.st, ME, state0.nextDie, input.bot, spec.mode,
      input.curveVersion, Math.random,
    );
    const state1 = openingCol >= 0
      ? rebuild(seed, [{ idx: 0, who: ME, col: openingCol }], spec.mode)
      : null;
    if (!state1) return null;
    afterTurn = state1.turn;
    afterDie = state1.nextDie;
  }
  const tierIndex = (tier: RankedPoolTier) =>
    RANKED_POOL_TIERS.findIndex((candidate) => candidate.id === tier);
  const sharedTier = tierIndex(input.underdogAccess.tier)
      <= tierIndex(input.favouriteAccess.tier)
    ? input.underdogAccess.tier : input.favouriteAccess.tier;
  const offer = spec.format === RUNE_TRIAL_FORMAT ? seededRuneTrialOffer(seed) : null;
  const claim = offer && input.curveVersion === 2
    ? seededRuneTrialClaim(seed, offer) : null;
  const deadline = offer
    ? new Date(Date.now() + RUNE_TRIAL_PICK_SECS * 1000).toISOString()
    : null;
  const startRpc = input.curveVersion === 2 ? "start_ranked_match_v4" : "start_ranked_match_v3";
  const { data: started, error } = await svc.rpc(startRpc, {
    p_requester: input.requester,
    p_p1: p1,
    p_p2: p2,
    p_seed: seed,
    p_next_die: firstDie,
    p_modifier: spec.modifier,
    p_season_id: input.season,
    p_queued_opponent: input.queuedOpponent,
    p_opening_col: openingCol,
    p_opening_die: openingCol == null ? null : firstDie,
    p_after_turn: afterTurn,
    p_after_next_die: afterDie,
    p_protocol_version: protocolVersion,
    p_pool_tier: sharedTier,
    p_format: spec.format,
    p_trial_offer: offer,
    p_selection_deadline: deadline,
    p_p1_auto_rune: offer ? seededRuneTrialAutoPick(seed, p1, offer) : null,
    p_p2_auto_rune: offer ? seededRuneTrialAutoPick(seed, p2, offer) : null,
    p_equipped_rune_protocol: equippedRuneProtocol,
    ...(input.curveVersion === 2 ? {
      p_curve_version: input.curveVersion,
      p_entry_kind: input.entryKind,
      p_weekly_rotation_id: input.weeklyRotationId,
      p_outcome_roster: outcomeRoster,
      p_reward_version: claim
        ? RUNE_TRIAL_CLAIM_REWARD_V2 : RUNE_TRIAL_SELECTED_REWARD_V1,
      p_claim_slot: claim?.slot ?? null,
      p_claim_rune: claim?.rune ?? null,
      p_bot_debut_outcome: botDebutOutcome,
    } : {}),
  });
  if (error?.code === "P0001") return null;
  if (error) throw new MatchStartFailure(error.message);
  const startedMatch = matchPayload(started);
  if (!startedMatch) throw new MatchStartFailure(`invalid ${startRpc} payload`);
  return {
    match: startedMatch,
    botMove: openingCol === null ? null : { col: openingCol, die: firstDie },
  };
}
