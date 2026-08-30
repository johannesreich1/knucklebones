import type { EdgeClient } from "../_shared/http.ts";
import type { JoinInput, MatchRow, ProfileSummary } from "../_shared/types.ts";

/* This policy module is a pure Node-side test seam as well as deployed Edge
   source, so its protocol wire literals stay local just as the v1 literal did. */
const RUNE_TRIAL_CAPABILITY = "rune_trial_v1";
const EQUIPPED_RUNE_CAPABILITY = "equipped_rune_v1";
const usesRankedActionProtocol = (match: MatchRow): boolean =>
  match.protocol_version === 2 && match.rune_rules_version === 1;

export interface QueueCandidate {
  player_id: string;
  created_at: string;
  /** Defaults keep rows queued by an older function safely on protocol v1. */
  protocol_version?: 1 | 2;
  capabilities?: string[];
  pool_tier?: "stone" | "bone" | "ivory";
}

interface RatingRow {
  id: string;
  rating: number | null;
}

/** Ranked always seats the lower-rated participant as p1, including bots. */
export function rankedSeatOrder(underdog: string, favourite: string) {
  return { p1: underdog, p2: favourite } as const;
}

/** Lower rating opens; preserve the existing bot-opening tiebreak at equality.
 *
 * Opening balance belongs to the bot policy, not to a human-always-opens
 * exception. In particular, a 0–0 bot may still open against a newcomer. */
export function rankedBotSides(
  humanId: string,
  humanRating: number,
  botId: string,
  botRating: number,
) {
  const humanOpens = humanRating < botRating;
  return humanOpens
    ? { underdog: humanId, favourite: botId } as const
    : { underdog: botId, favourite: humanId } as const;
}

export function negotiatedProtocolVersion(
  accesses: readonly { capabilities?: readonly string[] }[],
): 1 | 2 {
  return accesses.every(({ capabilities }) => capabilities?.includes(RUNE_TRIAL_CAPABILITY)) ? 2 : 1;
}

/** Both seats must explicitly understand equipped runes in standard matches.
 * A bot advertises ALL_RANKED_CAPABILITIES, so its human controls this gate. */
export function negotiatedEquippedRuneProtocol(
  format: MatchRow["format"],
  accesses: readonly { capabilities?: readonly string[] }[],
): boolean {
  return format === "standard"
    && accesses.every(({ capabilities }) => capabilities?.includes(EQUIPPED_RUNE_CAPABILITY));
}

export function rankedClientCompatibilityError(
  match: MatchRow,
  input: JoinInput,
): "unsupported-rune-rules" | "incompatible-client" | null {
  if (match.rune_rules_version != null && match.rune_rules_version !== 1) {
    return "unsupported-rune-rules";
  }
  if (match.format === "rune_trial") {
    if (!usesRankedActionProtocol(match)) return "unsupported-rune-rules";
    return input.protocolVersion === 2 && input.capabilities.includes(RUNE_TRIAL_CAPABILITY)
      ? null : "incompatible-client";
  }
  if (!usesRankedActionProtocol(match)) return null;
  return input.protocolVersion === 2 && input.capabilities.includes(EQUIPPED_RUNE_CAPABILITY)
    ? null : "incompatible-client";
}

/* Compatibility export for focused callers while the wider name rolls out. */
export const trialClientCompatibilityError = rankedClientCompatibilityError;

/** Select the oldest queued player whose current rating is inside the band. */
export function oldestEligibleCandidate(
  queue: readonly QueueCandidate[],
  ratings: ReadonlyMap<string, number>,
  playerRating: number,
  band: number,
): QueueCandidate | null {
  return [...queue]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .find((candidate) => {
      const rating = ratings.get(candidate.player_id);
      return rating !== undefined && Math.abs(rating - playerRating) <= band;
    }) ?? null;
}

/**
 * Read the queue in age order, then apply the caller's computed rating band.
 * The eventual start_ranked_match RPC locks and consumes both queue rows in
 * the same transaction as match creation.
 */
export async function findOldestEligiblePartner(
  svc: EdgeClient,
  playerId: string,
  playerRating: number,
  band: number,
): Promise<QueueCandidate | null> {
  const { data: queueData, error: queueError } = await svc.from("matchmaking_queue")
    .select("player_id, created_at, protocol_version, capabilities, pool_tier")
    .neq("player_id", playerId)
    .order("created_at", { ascending: true });
  if (queueError) throw new Error(`queue read failed: ${queueError.message}`);
  const queue = (queueData ?? []) as QueueCandidate[];
  if (queue.length === 0) return null;

  const { data: profileData, error: profileError } = await svc.from("profiles")
    .select("id, rating")
    .in("id", queue.map((candidate) => candidate.player_id));
  if (profileError) throw new Error(`queued rating read failed: ${profileError.message}`);
  const ratings = new Map(
    ((profileData ?? []) as RatingRow[]).map((profile) => [profile.id, profile.rating ?? 0]),
  );
  return oldestEligibleCandidate(queue, ratings, playerRating, band);
}

/* ------------------------------------------------------------------------
 * The same question with a synthetic opponent: who does this player face
 * when no human is queued inside the band?
 * --------------------------------------------------------------------- */

export interface BotOpponent {
  id: string;
  rating: number;
}

export type BotOpponentChoice =
  /** A free bot sits inside the cap: play it. */
  | { kind: "pick"; bot: BotOpponent }
  /**
   * Nothing free sits inside the cap: mint one at `rating`. `nearest` is the
   * closest free bot of any rating, offered only if minting yields nothing.
   */
  | { kind: "mint"; rating: number; nearest: BotOpponent | null };

/**
 * Decide which bot a ranked player meets, given the roster that is free right
 * now. Pure so the sampling policy it carries can be measured; `random` is a
 * parameter for the same reason start.ts threads Math.random into botMove.
 */
export function botOpponentChoice(
  free: readonly ProfileSummary[],
  playerRating: number,
  cap: number,
  random: () => number,
): BotOpponentChoice {
  const inRange = free.filter((bot) => Math.abs(bot.rating! - playerRating) <= cap);
  if (inRange.length) {
    /* Sample the WHOLE eligible band. This used to sort by proximity and take
       one of the nearest three, which drove the median rating gap down to 37
       points — and since a ladder delta is a function of that gap, every win
       paid about +80 and the number stopped carrying information. Human
       pairing never had the problem: oldestEligibleCandidate takes the oldest
       queued player inside the band, never the nearest, and measures a median
       gap near 340 whether two players are queued or sixty. Uniform sampling
       gives bot matches that same spread (payout sd 5.1 -> 17.9) at no cost
       to skill fidelity (0.906, unchanged, because none of this touches
       delta()) and none to difficulty (human win rate 56.0% -> 56.2%).
       botPairBand still caps the distance, so a STONE player cannot be handed
       the IVORY bot that caused the 2026-08-20 report. */
    const picked = inRange[Math.floor(random() * inRange.length)];
    return { kind: "pick", bot: { id: picked.id, rating: picked.rating ?? 0 } };
  }
  const offset = Math.round(cap * (0.15 + random() * 0.35)) * (random() < 0.5 ? -1 : 1);
  /* Last resort, for a mint that comes back empty: nothing sits inside the cap,
     so the closest free bot is taken anyway. Spelled out because the pick
     above is deliberately uniform — this is the one place that still wants the
     nearest, and it used to ride on a sort that no longer exists. */
  const nearest = free.length
    ? free.reduce((best, candidate) =>
      Math.abs((candidate.rating ?? 0) - playerRating)
          < Math.abs((best.rating ?? 0) - playerRating)
        ? candidate
        : best)
    : null;
  return {
    kind: "mint",
    rating: Math.max(0, playerRating + offset),
    nearest: nearest ? { id: nearest.id, rating: nearest.rating ?? 0 } : null,
  };
}

export type BotSearch =
  | { ok: true; bot: BotOpponent | null }
  | { ok: false; error: "bot-read-failed" | "bot-create-failed" };

/**
 * Read the bots nobody is currently playing, apply the policy above, and mint
 * an opponent when the band is empty. The mint fallback stays inside this call
 * on purpose: a mint that returns no row must still be able to reach for the
 * nearest free bot, which a caller holding only the outcome could not do.
 *
 * `band` is the caller's already-narrowed bot pairing width, the same division
 * of labour findOldestEligiblePartner uses — and the reason this module stays
 * free of ./core, which resolves only in a deployed function tree.
 */
export async function findRankedBotOpponent(
  svc: EdgeClient,
  playerRating: number,
  band: number,
  random: () => number = Math.random,
): Promise<BotSearch> {
  const [{ data: botData, error: botError }, { data: busyData, error: busyError }] =
    await Promise.all([
      svc.from("profiles").select("id, rating").eq("is_bot", true),
      svc.from("matches").select("p1, p2").eq("status", "active"),
    ]);
  if (botError || busyError) return { ok: false, error: "bot-read-failed" };
  const bots = (botData ?? []) as ProfileSummary[];
  const busy = (busyData ?? []) as Array<Pick<MatchRow, "p1" | "p2">>;
  const busyIds = new Set(busy.flatMap((match) => [match.p1, match.p2]));
  const free = bots.filter((bot) => !busyIds.has(bot.id));
  const choice = botOpponentChoice(free, playerRating, band, random);
  if (choice.kind === "pick") return { ok: true, bot: choice.bot };

  const { data: mintedData, error: mintError } = await svc.rpc("mint_bot", {
    target_rating: choice.rating,
  });
  if (mintError) return { ok: false, error: "bot-create-failed" };
  const minted = mintedData as string | null;
  if (!minted) return { ok: true, bot: choice.nearest };
  const { data: mintedProfile, error: mintedError } = await svc.from("profiles")
    .select("rating").eq("id", minted).maybeSingle();
  if (mintedError) return { ok: false, error: "bot-read-failed" };
  const rating = (mintedProfile as { rating?: number | null } | null)?.rating ?? choice.rating;
  return { ok: true, bot: { id: minted, rating } };
}
