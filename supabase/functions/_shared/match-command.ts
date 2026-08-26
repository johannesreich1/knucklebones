import type { EdgeClient } from "./http.ts";
import {
  buildSettlementSnapshot,
  RETRY_SETTLEMENT,
  retryOnSerialization,
  SERIALIZATION_FAILURE,
  type LadderSettlement,
  type SettlementSnapshot,
  type TerminalMatch,
} from "./settlement.ts";
import type { MatchRow, PlayerIndex } from "./types.ts";

export interface CommandMove {
  idx: number;
  who: PlayerIndex;
  col: number;
  die: number;
}

export interface CommandMetadata {
  your_die: number;
  bot_move?: { col: number; die: number } | null;
  auto?: boolean;
}

export interface MatchCommand {
  match: MatchRow;
  commandId: string;
  actor: string;
  requestedCol: number;
  auto: boolean;
  expectedMoveCount: number;
  expectedTurn: PlayerIndex;
  expectedNextDie: number;
  /** Auto recovery only: the projection the Edge clock judged stalled, so the
      database clock re-verifies the interval inside the locked transaction. */
  expectedLastMoveAt: string | null;
  moves: CommandMove[];
  nextTurn: PlayerIndex | null;
  nextDie: number | null;
  terminal: TerminalMatch | null;
  metadata: CommandMetadata;
}

export interface CommandResponse extends CommandMetadata {
  match: MatchRow;
}

export class MatchCommandConflict extends Error {}

const COMMAND_CONFLICT = "P0001";
const COMMAND_REUSE = "22023";

function message(error: { message?: string } | null | undefined): string {
  return error?.message ?? "unknown database error";
}

function response(value: unknown): CommandResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!candidate.match || typeof candidate.match !== "object" || Array.isArray(candidate.match)) return null;
  const match = candidate.match as Partial<MatchRow>;
  if (typeof match.id !== "string") return null;
  const yourDie = candidate.your_die;
  if (!Number.isInteger(yourDie) || (yourDie as number) < 1 || (yourDie as number) > 6) return null;
  const bot = candidate.bot_move;
  let botMove: { col: number; die: number } | null | undefined;
  if (bot === null) {
    botMove = null;
  } else if (bot !== undefined) {
    if (!bot || typeof bot !== "object" || Array.isArray(bot)) return null;
    const col = (bot as Record<string, unknown>).col;
    const die = (bot as Record<string, unknown>).die;
    if (!Number.isInteger(col) || (col as number) < 0 || (col as number) > 2
      || !Number.isInteger(die) || (die as number) < 1 || (die as number) > 6) return null;
    botMove = { col: col as number, die: die as number };
  }
  return {
    match: match as MatchRow,
    your_die: yourDie as number,
    ...(candidate.auto === true ? { auto: true } : {}),
    ...(botMove !== undefined ? { bot_move: botMove } : {}),
  };
}

/** Return the committed response for a caller-supplied idempotency key. */
export async function committedMatchCommand(
  service: EdgeClient,
  input: Pick<
    MatchCommand,
    "commandId" | "actor" | "requestedCol" | "auto" | "expectedMoveCount"
  > & { matchId: string },
): Promise<CommandResponse | null> {
  const { data, error } = await service.rpc("match_command_result", {
    p_match_id: input.matchId,
    p_command_id: input.commandId,
    p_actor: input.actor,
    p_requested_col: input.requestedCol,
    p_auto: input.auto,
    p_expected_move_count: input.expectedMoveCount,
  });
  if (error?.code === COMMAND_REUSE) throw new MatchCommandConflict(message(error));
  if (error) throw new Error(`match command lookup failed: ${message(error)}`);
  if (data == null) return null;
  const prior = response(data);
  if (!prior) throw new Error("match command lookup returned an invalid payload");
  return prior;
}

/**
 * Persist the complete move command. For a terminal move, ladder snapshots are
 * computed in shared TypeScript on every serialization retry; the database RPC
 * appends moves and invokes settle_match inside the same transaction.
 */
export async function commitMatchCommand(
  service: EdgeClient,
  command: MatchCommand,
  calculate: LadderSettlement,
): Promise<CommandResponse> {
  return retryOnSerialization(async (isFinal) => {
    let settlement: SettlementSnapshot | null = null;
    if (command.terminal) {
      settlement = await buildSettlementSnapshot(
        service, command.match, command.terminal, calculate,
      );
    }

    const { data, error } = await service.rpc("commit_match_command", {
      p_match_id: command.match.id,
      p_command_id: command.commandId,
      p_actor: command.actor,
      p_requested_col: command.requestedCol,
      p_auto: command.auto,
      p_expected_move_count: command.expectedMoveCount,
      p_expected_turn: command.expectedTurn,
      p_expected_next_die: command.expectedNextDie,
      p_expected_last_move_at: command.expectedLastMoveAt,
      p_moves: command.moves,
      p_next_turn: command.nextTurn,
      p_next_die: command.nextDie,
      p_settlement: settlement,
      p_response_meta: command.metadata,
    });
    if (error?.code === SERIALIZATION_FAILURE && command.terminal && !isFinal) {
      return RETRY_SETTLEMENT;
    }
    if (error?.code === COMMAND_CONFLICT || error?.code === COMMAND_REUSE) {
      throw new MatchCommandConflict(message(error));
    }
    if (error) throw new Error(`atomic match command failed: ${message(error)}`);
    const committed = response(data);
    if (!committed) throw new Error("atomic match command returned an invalid payload");
    return committed;
  }, "atomic match command retry budget exhausted");
}
