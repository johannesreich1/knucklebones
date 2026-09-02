import { settle, type Score } from "./core/ladder.ts";
import {
  appendRankedAction,
  rankedActionTotal,
  rebuildRankedActions,
  type RankedActionIntent,
  type RankedActionRow,
  type RankedRuneDeal,
} from "./core/ranked-actions.ts";
import { appendRankedBotTurn } from "./core/ranked-bot-turn.ts";
import {
  RUNE_TRIAL_FORMAT,
  rankedOutcomeByMatch,
  usesRankedActionProtocol,
} from "./core/ranked-outcomes.ts";
import { AI, ME, legalCols, type Player } from "./core/rules.ts";
import { json, type AuthenticatedContext } from "../_shared/http.ts";
import {
  commitMatchAction,
  committedMatchAction,
  MatchActionConflict,
  type ActionMetadata,
} from "../_shared/match-action.ts";
import { autoForfeitsNow, settleAutoForfeit } from "../_shared/auto-forfeit.ts";
import { AUTO_MS } from "../_shared/match-timing.ts";
import type { TerminalMatch } from "../_shared/settlement.ts";
import {
  MATCH_COLUMNS,
  type ActionInput,
  type MatchActionRow,
  type MatchRow,
  type ProfileSummary,
} from "../_shared/types.ts";

const ACTION_COLUMNS = "idx, move_idx, who, kind, rune_id, target_col, placed_col, "
  + "die_before, die_after, created_at";

function terminalMatch(match: MatchRow, state: NonNullable<ReturnType<typeof rebuildRankedActions>>,
  mode: ReturnType<typeof rankedOutcomeByMatch>["mode"]): TerminalMatch {
  const p1Score = rankedActionTotal(state, ME, mode);
  const p2Score = rankedActionTotal(state, AI, mode);
  const p1Result: Score = p1Score > p2Score ? 1 : p1Score < p2Score ? 0 : 0.5;
  return {
    status: "done",
    winner: p1Result === 1 ? match.p1 : p1Result === 0 ? match.p2 : null,
    p1Score,
    p2Score,
    p1Result,
  };
}

export async function actionMatch(context: AuthenticatedContext, input: ActionInput): Promise<Response> {
  const svc = context.service();
  try {
    const prior = await committedMatchAction(svc, {
      matchId: input.matchId,
      commandId: input.commandId,
      actor: context.user.id,
      auto: input.auto,
      expectedActionVersion: input.expectedActionVersion,
      requestedAction: input.action,
    });
    if (prior) return json(prior);
  } catch (error) {
    if (error instanceof MatchActionConflict) return json({ error: "command-conflict" }, 409);
    console.error("pvp-action command lookup failed:", error);
    return json({ error: "command-lookup-failed" }, 500);
  }

  const { data: matchData, error: matchError } = await svc.from("matches")
    .select(MATCH_COLUMNS).eq("id", input.matchId).maybeSingle();
  if (matchError) return json({ error: "match-read-failed" }, 500);
  const match = matchData as MatchRow | null;
  if (!match || (match.p1 !== context.user.id && match.p2 !== context.user.id)) {
    return json({ error: "no-match" }, 404);
  }
  if (match.status !== "active") return json({ error: "match-over" }, 409);
  if ((match.format === RUNE_TRIAL_FORMAT && match.rune_rules_version !== 1)
      || (match.rune_rules_version !== null && match.rune_rules_version !== 1)) {
    return json({ error: "unsupported-rune-rules" }, 409);
  }
  if (!usesRankedActionProtocol(match)) {
    return json({ error: "wrong-protocol" }, 409);
  }
  if (match.curve_version !== 1 && match.curve_version !== 2) {
    return json({ error: "corrupt-state" }, 500);
  }
  const curveVersion = match.curve_version;
  if (match.phase !== "playing") return json({ error: "selection-in-progress" }, 409);
  if (match.next_die == null) {
    return json({ error: "corrupt-state" }, 500);
  }

  const myIdx: Player = match.p1 === context.user.id ? ME : AI;
  const mover: Player = input.auto ? match.turn : myIdx;
  /* Recovering somebody ELSE's turn needs proof their app is gone. Placing for
     yourself because your own turn clock ran out needs no such proof, so it
     carries no stall precondition and is gated only by owning the turn. */
  const recovery = input.auto && mover !== myIdx;
  if (recovery) {
    if (Date.now() - new Date(match.last_move_at).getTime() < AUTO_MS) {
      return json({ error: "not-stalled-yet" }, 425);
    }
  } else if (match.turn !== myIdx) {
    return json({ error: "not-your-turn" }, 409);
  }

  let outcome;
  try { outcome = rankedOutcomeByMatch(match.format, match.modifier); }
  catch (error) {
    console.error("pvp-action found an unknown ranked outcome:", error);
    return json({ error: "corrupt-state" }, 500);
  }
  const [{ data: actionData, error: actionError }, { data: seedData, error: seedError }] =
    await Promise.all([
      svc.from("match_actions").select(ACTION_COLUMNS).eq("match_id", match.id).order("idx"),
      svc.from("match_seeds").select("seed").eq("match_id", match.id).single(),
    ]);
  if (actionError || seedError) return json({ error: "match-read-failed" }, 500);
  const rows = (actionData ?? []) as unknown as RankedActionRow[];
  const seed = (seedData as { seed?: string } | null)?.seed;
  const dealt: RankedRuneDeal = [match.p2_rune, match.p1_rune];
  const before = seed && rebuildRankedActions(seed, rows, outcome.mode, dealt);
  if (!before || before.over || before.turn !== mover || before.nextDie !== match.next_die
      || before.pendingAim !== match.pending_aim
      || before.actionCount !== match.action_version
      || input.expectedActionVersion !== before.actionCount) {
    return json({ error: "race-lost" }, 409);
  }

  /* Two automatic actions already covered this absence, so the third is the
     loss instead of an action. Same decision and same settlement contract as
     the classic path — see _shared/auto-forfeit.ts. */
  if (input.auto && autoForfeitsNow(match, mover)) {
    const forfeited = await settleAutoForfeit(
      svc,
      match,
      mover,
      rankedActionTotal(before, ME, outcome.mode),
      rankedActionTotal(before, AI, outcome.mode),
      { turn: match.turn, lastMoveAt: match.last_move_at, moveCount: before.moveCount },
      settle,
    );
    if (!forfeited.applied && forfeited.match.status === "active") {
      return json({ error: "race-lost" }, 409);
    }
    return json({
      match: forfeited.match,
      ...(forfeited.reward ? { reward: forfeited.reward } : {}),
    });
  }

  let requested: RankedActionIntent = input.action!;
  let appended: ReturnType<typeof appendRankedAction> = null;
  if (input.auto && before.pendingAim) {
    for (let col = 0; col < 3 && !appended; col++) {
      requested = { kind: "cast", rune_id: before.pendingAim, target_col: col };
      appended = appendRankedAction(seed, rows, outcome.mode, dealt, requested);
    }
  } else if (input.auto) {
    const legal = legalCols(before.st[mover]);
    if (!legal.length) return json({ error: "corrupt-state" }, 500);
    requested = {
      kind: "place",
      placed_col: legal[Math.floor(Math.random() * legal.length)],
    };
  }
  appended ??= appendRankedAction(seed, rows, outcome.mode, dealt, requested);
  if (!appended) return json({ error: "illegal-action" }, 422);
  const committed: RankedActionRow[] = [appended.row];
  const allRows = [...rows, appended.row];
  let state = appended.state;
  let placedThisCommand = requested.kind === "place";

  if (input.auto && before.pendingAim && !state.over) {
    const legal = legalCols(state.st[mover]);
    if (!legal.length) return json({ error: "corrupt-state" }, 500);
    const place = appendRankedAction(seed, allRows, outcome.mode, dealt, {
      kind: "place",
      placed_col: legal[Math.floor(Math.random() * legal.length)],
    });
    if (!place) return json({ error: "corrupt-state" }, 500);
    committed.push(place.row);
    allRows.push(place.row);
    state = place.state;
    placedThisCommand = true;
  }

  // A bot has no request loop. Once a human placement hands it the turn, its
  // optional cast and placement join the same atomic action command.
  const botActions: RankedActionRow[] = [];
  if (placedThisCommand && !state.over) {
    const nextId = state.turn === ME ? match.p1 : match.p2;
    const { data: profileData, error: profileError } = await svc.from("profiles")
      .select("id, is_bot, rating").eq("id", nextId).single();
    if (profileError) return json({ error: "profile-read-failed" }, 500);
    const profile = profileData as ProfileSummary | null;
    if (profile?.is_bot) {
      const turn = appendRankedBotTurn({
        seed,
        rows: allRows,
        state,
        mode: outcome.mode,
        dealt,
        rating: profile.rating ?? 0,
        curveVersion,
        random: Math.random,
      });
      if (!turn) return json({ error: "corrupt-state" }, 500);
      committed.push(...turn.actions);
      botActions.push(...turn.actions);
      allRows.push(...turn.actions);
      state = turn.state;
    }
  }

  const metadata: ActionMetadata = {
    your_die: before.nextDie,
    ...(input.auto ? { auto: true } : {}),
    ...(botActions.length ? { bot_actions: botActions as MatchActionRow[] } : {}),
  };
  const terminal = state.over ? terminalMatch(match, state, outcome.mode) : null;
  try {
    const response = await commitMatchAction(svc, {
      match,
      commandId: input.commandId,
      actor: context.user.id,
      auto: input.auto,
      expectedActionVersion: input.expectedActionVersion,
      expectedTurn: before.turn,
      expectedNextDie: before.nextDie,
      // Only a recovery proves a stall; a self placement is checked for turn
      // ownership by the RPC instead. See pvp-move for the same split.
      expectedLastMoveAt: recovery ? match.last_move_at : null,
      requestedAction: input.action,
      actions: committed as MatchActionRow[],
      nextTurn: terminal ? null : state.turn,
      nextDie: terminal ? null : state.nextDie,
      terminal,
      metadata,
    }, settle);
    return json(response);
  } catch (error) {
    if (error instanceof MatchActionConflict) {
      return json({ error: error.message.includes("stalled") ? "not-stalled-yet" : "race-lost" },
        error.message.includes("stalled") ? 425 : 409);
    }
    console.error("pvp-action command commit failed:", error);
    return json({ error: "command-failed" }, 500);
  }
}
