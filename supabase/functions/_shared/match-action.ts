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
import type { MatchActionInput, MatchActionRow, MatchRow, PlayerIndex } from "./types.ts";

export interface ActionMetadata {
  your_die: number;
  bot_actions?: MatchActionRow[];
  auto?: boolean;
}

export interface MatchActionCommand {
  match: MatchRow;
  commandId: string;
  actor: string;
  auto: boolean;
  expectedActionVersion: number;
  expectedTurn: PlayerIndex;
  expectedNextDie: number;
  expectedLastMoveAt: string | null;
  requestedAction: MatchActionInput | null;
  actions: MatchActionRow[];
  nextTurn: PlayerIndex | null;
  nextDie: number | null;
  terminal: TerminalMatch | null;
  metadata: ActionMetadata;
}

export interface MatchActionResponse extends ActionMetadata {
  match: MatchRow;
  actions: MatchActionRow[];
  action_version: number;
  reward?: { rune_id: string; newly_collected: boolean };
}

export class MatchActionConflict extends Error {}

const COMMAND_CONFLICT = "P0001";
const COMMAND_REUSE = "22023";

const message = (error: { message?: string } | null | undefined): string =>
  error?.message ?? "unknown database error";

function parsedResponse(value: unknown): MatchActionResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!candidate.match || typeof candidate.match !== "object" || Array.isArray(candidate.match)
      || !Array.isArray(candidate.actions)
      || !Number.isInteger(candidate.action_version)
      || !Number.isInteger(candidate.your_die)) return null;
  const match = candidate.match as Partial<MatchRow>;
  if (typeof match.id !== "string") return null;
  return candidate as unknown as MatchActionResponse;
}

export async function committedMatchAction(
  service: EdgeClient,
  input: Pick<MatchActionCommand,
    "commandId" | "actor" | "auto" | "expectedActionVersion" | "requestedAction">
    & { matchId: string },
): Promise<MatchActionResponse | null> {
  const { data, error } = await service.rpc("match_action_result", {
    p_match_id: input.matchId,
    p_command_id: input.commandId,
    p_actor: input.actor,
    p_auto: input.auto,
    p_expected_action_version: input.expectedActionVersion,
    p_requested_action: input.requestedAction,
  });
  if (error?.code === COMMAND_REUSE) throw new MatchActionConflict(message(error));
  if (error) throw new Error(`match action lookup failed: ${message(error)}`);
  if (data == null) return null;
  const parsed = parsedResponse(data);
  if (!parsed) throw new Error("match action lookup returned an invalid payload");
  return parsed;
}

export async function commitMatchAction(
  service: EdgeClient,
  command: MatchActionCommand,
  calculate: LadderSettlement,
): Promise<MatchActionResponse> {
  return retryOnSerialization(async (isFinal) => {
    let settlement: SettlementSnapshot | null = null;
    if (command.terminal) {
      settlement = await buildSettlementSnapshot(
        service, command.match, command.terminal, calculate,
      );
    }

    const { data, error } = await service.rpc("commit_match_action", {
      p_match_id: command.match.id,
      p_command_id: command.commandId,
      p_actor: command.actor,
      p_auto: command.auto,
      p_expected_action_version: command.expectedActionVersion,
      p_expected_turn: command.expectedTurn,
      p_expected_next_die: command.expectedNextDie,
      p_expected_last_move_at: command.expectedLastMoveAt,
      p_requested_action: command.requestedAction,
      p_actions: command.actions,
      p_next_turn: command.nextTurn,
      p_next_die: command.nextDie,
      p_settlement: settlement,
      p_response_meta: command.metadata,
    });
    if (error?.code === SERIALIZATION_FAILURE && command.terminal && !isFinal) {
      return RETRY_SETTLEMENT;
    }
    if (error?.code === COMMAND_CONFLICT || error?.code === COMMAND_REUSE) {
      throw new MatchActionConflict(message(error));
    }
    if (error) throw new Error(`atomic match action failed: ${message(error)}`);
    const parsed = parsedResponse(data);
    if (!parsed) throw new Error("atomic match action returned an invalid payload");
    return parsed;
  }, "atomic match action retry budget exhausted");
}
