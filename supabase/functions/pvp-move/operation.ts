import { AI, ME, BOUNTY, isFull, legalCols, applyMove, type Player, type Mode } from "./core/rules.ts";
import { rebuild, matchTotal, type MatchState } from "./core/match.ts";
import { settle, type Score } from "./core/ladder.ts";
import { botMove } from "./core/bot.ts";
import { modeById } from "./core/modes.ts";
import { json, type AuthenticatedContext, type EdgeClient } from "../_shared/http.ts";
import { settleMatch } from "../_shared/settlement.ts";
import type { MatchMoveRow, MatchRow, MoveInput } from "../_shared/types.ts";

const MATCH_COLS = "id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier, season_id";

/* An honest visible client places for itself at 10s. The extra two seconds let
   the server recover a turn only after its own clock proves the app is gone. */
const AUTO_MS = 12 * 1000;

async function loadState(svc: EdgeClient, matchId: string, mode: Mode): Promise<MatchState | null> {
  const { data: moveData } = await svc.from("match_moves").select("idx, who, col").eq("match_id", matchId);
  const moves = (moveData ?? []) as MatchMoveRow[];
  const { data: seedData } = await svc.from("match_seeds").select("seed").eq("match_id", matchId).single();
  const seedRow = seedData as { seed: string } | null;
  if (!seedRow) return null;
  return rebuild(seedRow.seed, moves, mode);
}

/* Scores and points come from shared core; the shared settlement boundary
   compare-and-sets the match, ladder rows, and profile mirrors together. */
async function finish(
  svc: EdgeClient,
  match: MatchRow,
  state: MatchState,
  mode: Mode,
  status: "done" | "forfeit",
  forfeitWinner?: Player,
): Promise<MatchRow | null> {
  const p1Score = matchTotal(state, ME, mode), p2Score = matchTotal(state, AI, mode);
  const p1Result: Score = status === "forfeit"
    ? (forfeitWinner === ME ? 1 : 0)
    : (p1Score > p2Score ? 1 : p1Score < p2Score ? 0 : 0.5);
  const winner = p1Result === 1 ? match.p1 : p1Result === 0 ? match.p2 : null;
  const result = await settleMatch(svc, match, {
    status,
    winner,
    p1Score,
    p2Score,
    p1Result,
  }, settle);
  return result.match;
}

export async function moveMatch(context: AuthenticatedContext, input: MoveInput): Promise<Response> {
  const { user } = context;
  const svc = context.service();
  const { data } = await svc.from("matches").select(MATCH_COLS).eq("id", input.matchId).maybeSingle();
  const match = data as MatchRow | null;
  if (!match || (match.p1 !== user.id && match.p2 !== user.id)) return json({ error: "no-match" }, 404);
  if (match.status !== "active") return json({ error: "match-over" }, 409);
  const myIdx: Player = match.p1 === user.id ? ME : AI;
  const mover: Player = input.auto ? match.turn as Player : myIdx;
  if (input.auto) {
    if (Date.now() - new Date(match.last_move_at).getTime() < AUTO_MS) {
      return json({ error: "not-stalled-yet" }, 425);
    }
  } else if (match.turn !== myIdx) {
    return json({ error: "not-your-turn" }, 409);
  }
  const mode: Mode = modeById(match.modifier).mode;

  let state = await loadState(svc, input.matchId, mode);
  if (!state || state.over || state.turn !== mover) return json({ error: "corrupt-state" }, 500);
  const legal = legalCols(state.st[mover]);
  const chosen = input.auto ? legal[Math.floor(Math.random() * legal.length)] : input.col;
  if (!legal.includes(chosen)) return json({ error: "illegal-move" }, 422);

  const myDie = state.nextDie;
  const { error: insertError } = await svc.from("match_moves")
    .insert({ match_id: input.matchId, idx: state.moveCount, who: mover, col: chosen, die: myDie });
  if (insertError) return json({ error: "race-lost" }, 409);
  const myHits = applyMove(state.st, mover, chosen, myDie, mode);
  if (mode === BOUNTY) state.bounty[mover] += myHits;

  if (isFull(state.st[mover])) {
    const updated = await finish(svc, match, state, mode, "done");
    return json({ match: updated, your_die: myDie, auto: input.auto });
  }

  const oppId = myIdx === ME ? match.p2 : match.p1;
  const { data: profileData } = await svc.from("profiles").select("is_bot, rating").eq("id", oppId).single();
  const oppProf = profileData as { is_bot?: boolean; rating?: number | null } | null;
  let botReply: { col: number; die: number } | null = null;
  state = (await loadState(svc, input.matchId, mode))!;
  if (mover === myIdx && oppProf?.is_bot && !state.over) {
    const botIdx = (1 - myIdx) as Player;
    const botDie = state.nextDie;
    const botCol = botMove(state.st, botIdx, botDie, oppProf.rating ?? 0, mode, Math.random);
    const { error: botError } = await svc.from("match_moves")
      .insert({ match_id: input.matchId, idx: state.moveCount, who: botIdx, col: botCol, die: botDie });
    if (!botError) {
      const botHits = applyMove(state.st, botIdx, botCol, botDie, mode);
      if (mode === BOUNTY) state.bounty[botIdx] += botHits;
      botReply = { col: botCol, die: botDie };
      if (isFull(state.st[botIdx])) {
        const updated = await finish(svc, match, state, mode, "done");
        return json({ match: updated, your_die: myDie, bot_move: botReply });
      }
      state = (await loadState(svc, input.matchId, mode))!;
    }
  }

  // LIMITED can exhaust its bag without filling a board.
  if (state.over) {
    const updated = await finish(svc, match, state, mode, "done");
    return json({ match: updated, your_die: myDie, bot_move: botReply });
  }

  const { data: updated } = await svc.from("matches").update({
    turn: state.turn, next_die: state.nextDie, last_move_at: new Date().toISOString(),
  }).eq("id", input.matchId).select(MATCH_COLS).single();
  return json({ match: updated as MatchRow | null, your_die: myDie, bot_move: botReply });
}
