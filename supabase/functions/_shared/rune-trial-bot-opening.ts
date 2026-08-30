import { settle } from "../core/ladder.ts";
import {
  rebuildRankedActions,
  type RankedActionRow,
  type RankedRuneDeal,
} from "../core/ranked-actions.ts";
import { rankedIntentOf } from "../core/ranked-action-validation.ts";
import { appendRankedBotTurn } from "../core/ranked-bot-turn.ts";
import { rankedOutcomeByMatch, RUNE_TRIAL_FORMAT } from "../core/ranked-outcomes.ts";
import { ME } from "../core/rules.ts";
import type { AuthenticatedContext, EdgeClient } from "./http.ts";
import { commitMatchAction, MatchActionConflict } from "./match-action.ts";
import {
  MATCH_COLUMNS,
  type MatchActionRow,
  type MatchRow,
  type ProfileSummary,
} from "./types.ts";

const ACTION_COLUMNS = "idx, move_idx, who, kind, rune_id, target_col, placed_col, "
  + "die_before, die_after, created_at";

async function readMatch(service: EdgeClient, matchId: string): Promise<MatchRow> {
  const { data, error } = await service.from("matches")
    .select(MATCH_COLUMNS).eq("id", matchId).maybeSingle();
  if (error || !data) throw new Error("Rune Trial bot opener could not read its match");
  return data as unknown as MatchRow;
}

/**
 * If the underdog opening seat belongs to a bot, commit its first turn before
 * returning the revealed selection. Concurrent finalizers converge through
 * the action RPC's version check and then return the fresh projection.
 */
export async function ensureRuneTrialBotOpening<T extends { match: MatchRow }>(
  context: AuthenticatedContext,
  payload: T,
): Promise<T & { bot_actions?: MatchActionRow[] }> {
  const service = context.service();
  let match = await readMatch(service, payload.match.id);
  const current = (): T => ({ ...payload, match } as T);
  if (match.status !== "active" || match.format !== RUNE_TRIAL_FORMAT
      || match.phase !== "playing" || match.action_version > 0) return current();
  if (match.next_die === null || !match.p1_rune || !match.p2_rune) {
    throw new Error("Rune Trial bot opener received an incomplete reveal");
  }

  const { data: profileData, error: profileError } = await service.from("profiles")
    .select("id, is_bot, rating").eq("id", match.p1).single();
  if (profileError) throw new Error("Rune Trial bot opener could not read p1");
  const profile = profileData as ProfileSummary | null;
  if (!profile?.is_bot) return current();
  if (match.turn !== ME || match.action_version !== 0 || match.pending_aim !== null) {
    throw new Error("Rune Trial bot opener found an invalid opening projection");
  }

  const [{ data: actionData, error: actionError }, { data: seedData, error: seedError }] =
    await Promise.all([
      service.from("match_actions").select(ACTION_COLUMNS).eq("match_id", match.id).order("idx"),
      service.from("match_seeds").select("seed").eq("match_id", match.id).single(),
    ]);
  if (actionError || seedError) throw new Error("Rune Trial bot opener could not read replay");
  const rows = (actionData ?? []) as unknown as RankedActionRow[];
  const seed = (seedData as { seed?: string } | null)?.seed;
  if (!seed) throw new Error("Rune Trial bot opener received no private seed");
  let outcome: ReturnType<typeof rankedOutcomeByMatch>;
  try { outcome = rankedOutcomeByMatch(match.format, match.modifier); }
  catch { throw new Error("Rune Trial bot opener found invalid match rules"); }
  const dealt: RankedRuneDeal = [match.p2_rune, match.p1_rune];
  const before = rebuildRankedActions(seed, rows, outcome.mode, dealt);
  if (!before || before.over || before.turn !== match.turn || before.nextDie !== match.next_die
      || before.actionCount !== match.action_version || before.pendingAim !== match.pending_aim) {
    /* Match and action rows are separate PostgREST reads. Another selection or
       reconnect finalizer may commit the opener between them, leaving this
       invocation with the old version-0 match and the new action log. Converge
       on that fresh authoritative match instead of turning a won race into a
       500; a still-unopened projection remains a genuine replay failure. */
    match = await readMatch(service, match.id);
    if (match.status !== "active" || match.action_version > 0) return current();
    throw new Error("Rune Trial bot opener found a mismatched replay");
  }
  const turn = appendRankedBotTurn({
    seed,
    rows,
    state: before,
    mode: outcome.mode,
    dealt,
    rating: profile.rating ?? 0,
    random: Math.random,
  });
  const requestedAction = turn && rankedIntentOf(turn.actions[0]);
  if (!turn || !requestedAction || turn.state.over || turn.state.nextDie === null) {
    throw new Error("Rune Trial bot opener could not build a legal turn");
  }

  try {
    const response = await commitMatchAction(service, {
      match,
      commandId: crypto.randomUUID(),
      actor: match.p1,
      auto: false,
      expectedActionVersion: before.actionCount,
      expectedTurn: before.turn,
      expectedNextDie: before.nextDie,
      expectedLastMoveAt: null,
      requestedAction,
      actions: turn.actions as MatchActionRow[],
      nextTurn: turn.state.turn,
      nextDie: turn.state.nextDie,
      terminal: null,
      metadata: {
        your_die: before.nextDie,
        bot_actions: turn.actions as MatchActionRow[],
      },
    }, settle);
    match = response.match;
    /* SAY THAT A BOT JUST MOVED INSIDE THIS REQUEST. The rows are already in the
       command metadata above; the client needs them on the RESPONSE so its first
       read can perform the opening turn instead of painting it in one silent
       frame. It is the same `bot_actions` signal a mid-game reply carries, and
       the client spends it the same way (online/play botBeatDue).
       Only THIS branch emits it — the one that actually committed. Every early
       return above (a rejoin, a human opening seat, a log that already has rows)
       stays silent, which is what stops a reconnect replaying a whole match. */
    return { ...current(), bot_actions: turn.actions as MatchActionRow[] };
  } catch (error) {
    match = await readMatch(service, match.id);
    if (match.status !== "active" || match.action_version > 0) return current();
    if (error instanceof MatchActionConflict) {
      throw new Error("Rune Trial bot opener lost its action race");
    }
    throw error;
  }
}
