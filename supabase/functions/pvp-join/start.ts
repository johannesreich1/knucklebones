import { diceStream, poolSequence } from "./core/dice.ts";
import { botMove } from "./core/bot.ts";
import { rebuild } from "./core/match.ts";
import { LIMITED, ME, type Player } from "./core/rules.ts";
import {
  RANKED_POOL_TIERS,
  RUNE_TRIAL_FORMAT,
  pickRankedOutcome,
  type RankedParticipantAccess,
  type RankedPoolTier,
} from "./core/ranked-outcomes.ts";
import {
  RUNE_TRIAL_PICK_SECS,
  seededRuneTrialAutoPick,
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
  bot?: { id: string; rating: number };
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
  const seed = newSeed();
  const accesses = [input.underdogAccess, input.favouriteAccess] as const;
  const spec = pickRankedOutcome(seed, accesses);
  const protocolVersion = negotiatedProtocolVersion(accesses);
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
      state0.st, ME, state0.nextDie, input.bot.rating, spec.mode, Math.random,
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
  const deadline = offer
    ? new Date(Date.now() + RUNE_TRIAL_PICK_SECS * 1000).toISOString()
    : null;
  const { data: started, error } = await svc.rpc("start_ranked_match_v3", {
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
  });
  if (error?.code === "P0001") return null;
  if (error) throw new MatchStartFailure(error.message);
  const startedMatch = matchPayload(started);
  if (!startedMatch) throw new MatchStartFailure("invalid start_ranked_match_v3 payload");
  return {
    match: startedMatch,
    botMove: openingCol === null ? null : { col: openingCol, die: firstDie },
  };
}
