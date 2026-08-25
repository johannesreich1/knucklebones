import type { EdgeClient } from "./http.ts";
import {
  loadLadderRow,
  type LadderSettlement,
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

const SERIALIZATION_FAILURE = "40001";
const COMMAND_CONFLICT = "P0001";
const COMMAND_REUSE = "22023";
const MAX_ATTEMPTS = 3;

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
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let settlement: Record<string, unknown> | null = null;
    if (command.terminal) {
      const season = command.match.season_id ?? 1;
      const [p1, p2] = await Promise.all([
        loadLadderRow(service, season, command.match.p1),
        loadLadderRow(service, season, command.match.p2),
      ]);
      const next = calculate(p1, p2, command.terminal.p1Result);
      settlement = {
        status: command.terminal.status,
        winner: command.terminal.winner,
        p1_score: command.terminal.p1Score,
        p2_score: command.terminal.p2Score,
        p1_delta: next.da,
        p2_delta: next.db,
        expected_p1: p1,
        expected_p2: p2,
        next_p1: next.a,
        next_p2: next.b,
      };
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
    if (error?.code === SERIALIZATION_FAILURE && command.terminal && attempt < MAX_ATTEMPTS) continue;
    if (error?.code === COMMAND_CONFLICT || error?.code === COMMAND_REUSE) {
      throw new MatchActionConflict(message(error));
    }
    if (error) throw new Error(`atomic match action failed: ${message(error)}`);
    const parsed = parsedResponse(data);
    if (!parsed) throw new Error("atomic match action returned an invalid payload");
    return parsed;
  }
  throw new Error("atomic match action retry budget exhausted");
}
