import { AI, ME, isFull, legalCols, type Player, type Mode } from "./core/rules.ts";
import { rebuild, matchTotal, type MatchState } from "./core/match.ts";
import { settle, type Score } from "./core/ladder.ts";
import { botMove } from "./core/bot.ts";
import { rankedOutcomeByMatch } from "./core/ranked-outcomes.ts";
import { json, type AuthenticatedContext, type EdgeClient } from "../_shared/http.ts";
import {
  commitMatchCommand,
  committedMatchCommand,
  MatchCommandConflict,
  type CommandMetadata,
  type CommandMove,
} from "../_shared/match-command.ts";
import { autoForfeitsNow, settleAutoForfeit } from "../_shared/auto-forfeit.ts";
import { AUTO_MS } from "../_shared/match-timing.ts";
import type { TerminalMatch } from "../_shared/settlement.ts";
import { MATCH_COLUMNS, type MatchMoveRow, type MatchRow, type MoveInput } from "../_shared/types.ts";

interface Replay {
  seed: string;
  moves: MatchMoveRow[];
  state: MatchState;
}

async function loadReplay(svc: EdgeClient, matchId: string, mode: Mode): Promise<Replay | null> {
  const [{ data: moveData, error: moveError }, { data: seedData, error: seedError }] = await Promise.all([
    svc.from("match_moves").select("idx, who, col").eq("match_id", matchId),
    svc.from("match_seeds").select("seed").eq("match_id", matchId).single(),
  ]);
  if (moveError || seedError) return null;
  const moves = (moveData ?? []) as MatchMoveRow[];
  const seed = (seedData as { seed?: string } | null)?.seed;
  if (!seed) return null;
  const state = rebuild(seed, moves, mode);
  return state ? { seed, moves, state } : null;
}

function terminalMatch(match: MatchRow, state: MatchState, mode: Mode): TerminalMatch {
  const p1Score = matchTotal(state, ME, mode), p2Score = matchTotal(state, AI, mode);
  const p1Result: Score = p1Score > p2Score ? 1 : p1Score < p2Score ? 0 : 0.5;
  return {
    status: "done",
    winner: p1Result === 1 ? match.p1 : p1Result === 0 ? match.p2 : null,
    p1Score,
    p2Score,
    p1Result,
  };
}

export async function moveMatch(context: AuthenticatedContext, input: MoveInput): Promise<Response> {
  const { user } = context;
  const svc = context.service();

  if (input.expectedMoveCount !== null) {
    try {
      const prior = await committedMatchCommand(svc, {
        matchId: input.matchId,
        commandId: input.commandId,
        actor: user.id,
        requestedCol: input.col,
        auto: input.auto,
        expectedMoveCount: input.expectedMoveCount,
      });
      if (prior) return json(prior);
    } catch (error) {
      if (error instanceof MatchCommandConflict) return json({ error: "command-conflict" }, 409);
      console.error("pvp-move command lookup failed:", error);
      return json({ error: "command-lookup-failed" }, 500);
    }
  }

  const { data, error: matchError } = await svc.from("matches")
    .select(MATCH_COLUMNS).eq("id", input.matchId).maybeSingle();
  if (matchError) return json({ error: "match-read-failed" }, 500);
  const match = data as MatchRow | null;
  if (!match || (match.p1 !== user.id && match.p2 !== user.id)) return json({ error: "no-match" }, 404);
  if (match.status !== "active") return json({ error: "match-over" }, 409);
  if (match.format !== "standard" || match.phase !== "playing"
      || match.rune_rules_version !== null) {
    return json({ error: "wrong-protocol" }, 409);
  }
  if (match.next_die == null) return json({ error: "corrupt-state" }, 500);

  const myIdx: Player = match.p1 === user.id ? ME : AI;
  const mover: Player = input.auto ? match.turn as Player : myIdx;
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

  let mode: Mode;
  try { mode = rankedOutcomeByMatch(match.format, match.modifier).mode; }
  catch (error) {
    console.error("pvp-move found an unknown ranked outcome:", error);
    return json({ error: "corrupt-state" }, 500);
  }
  const replay = await loadReplay(svc, input.matchId, mode);
  if (!replay || replay.state.over || replay.state.turn !== mover) {
    return json({ error: "corrupt-state" }, 500);
  }
  const expectedMoveCount = input.expectedMoveCount ?? replay.state.moveCount;
  if (replay.state.moveCount !== expectedMoveCount) {
    return json({ error: "race-lost" }, 409);
  }

  /* Two automatic placements already covered this absence, so the third is the
     loss instead of a move. Decided here rather than in the commit RPC because
     TypeScript owns the ladder arithmetic; the checked precondition makes a
     real move racing this decision win. */
  if (input.auto && autoForfeitsNow(match, mover)) {
    const forfeited = await settleAutoForfeit(
      svc,
      match,
      mover,
      matchTotal(replay.state, ME, mode),
      matchTotal(replay.state, AI, mode),
      { turn: match.turn, lastMoveAt: match.last_move_at, moveCount: replay.state.moveCount },
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

  const legal = legalCols(replay.state.st[mover]);
  const chosen = input.auto ? legal[Math.floor(Math.random() * legal.length)] : input.col;
  if (!legal.includes(chosen)) return json({ error: "illegal-move" }, 422);

  const yourDie = replay.state.nextDie;
  const commandMoves: CommandMove[] = [{
    idx: replay.state.moveCount,
    who: mover,
    col: chosen,
    die: yourDie,
  }];
  let state = rebuild(replay.seed, [...replay.moves, commandMoves[0]], mode);
  if (!state) return json({ error: "corrupt-state" }, 500);

  let botReply: { col: number; die: number } | null = null;
  // The former flow reached its generic LIMITED exhaustion branch (and thus
  // returned bot_move:null) unless the mover actually filled a board.
  let checkedBot = state.over && !isFull(state.st[mover]);
  if (!state.over) {
    const oppId = myIdx === ME ? match.p2 : match.p1;
    const { data: profileData, error: profileError } = await svc.from("profiles")
      .select("is_bot, rating").eq("id", oppId).single();
    if (profileError) return json({ error: "profile-read-failed" }, 500);
    const oppProf = profileData as { is_bot?: boolean; rating?: number | null } | null;
    checkedBot = true;
    if (mover === myIdx && oppProf?.is_bot) {
      const botIdx = (1 - myIdx) as Player;
      const botDie = state.nextDie;
      const botCol = botMove(state.st, botIdx, botDie, oppProf.rating ?? 0, mode, Math.random);
      if (botCol < 0) return json({ error: "corrupt-state" }, 500);
      const reply: CommandMove = {
        idx: state.moveCount,
        who: botIdx,
        col: botCol,
        die: botDie,
      };
      commandMoves.push(reply);
      botReply = { col: botCol, die: botDie };
      state = rebuild(replay.seed, [...replay.moves, ...commandMoves], mode);
      if (!state) return json({ error: "corrupt-state" }, 500);
    }
  }

  const metadata: CommandMetadata = {
    your_die: yourDie,
    ...(input.auto ? { auto: true } : {}),
    ...(checkedBot ? { bot_move: botReply } : {}),
  };
  const terminal = state.over ? terminalMatch(match, state, mode) : null;

  try {
    const committed = await commitMatchCommand(svc, {
      match,
      commandId: input.commandId,
      actor: user.id,
      requestedCol: input.col,
      auto: input.auto,
      expectedMoveCount,
      expectedTurn: replay.state.turn,
      expectedNextDie: replay.state.nextDie,
      // The database clock re-verifies the auto stall inside the locked
      // transaction, so a fast Edge clock cannot force a move early. Only a
      // recovery carries it; a null here tells the RPC this is a self
      // placement to be checked for turn ownership instead.
      expectedLastMoveAt: recovery ? match.last_move_at : null,
      moves: commandMoves,
      nextTurn: terminal ? null : state.turn,
      nextDie: terminal ? null : state.nextDie,
      terminal,
      metadata,
    }, settle);
    return json(committed);
  } catch (error) {
    if (error instanceof MatchCommandConflict) {
      return json({ error: error.message.includes("stalled") ? "not-stalled-yet" : "race-lost" },
        error.message.includes("stalled") ? 425 : 409);
    }
    console.error("pvp-move command commit failed:", error);
    return json({ error: "command-failed" }, 500);
  }
}
