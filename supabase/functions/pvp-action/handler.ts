import {
  authenticatedPost, commandId, json, record, UUID,
  type Authenticate, type AuthenticatedContext,
} from "../_shared/http.ts";
import { RUNE_IDS } from "../_shared/rune-ids.ts";
import type { ActionInput, MatchActionInput } from "../_shared/types.ts";

export type ActionOperation = (context: AuthenticatedContext, input: ActionInput) => Promise<Response>;

export interface ActionDependencies {
  authenticate: Authenticate;
  operation: ActionOperation;
}

const RUNES = new Set(RUNE_IDS);

function actionInput(value: unknown): MatchActionInput | null {
  const action = record(value);
  if (action?.kind === "aim" && typeof action.rune_id === "string"
      && RUNES.has(action.rune_id) && action.target_col === undefined
      && action.placed_col === undefined) {
    return { kind: "aim", rune_id: action.rune_id };
  }
  if (action?.kind === "place" && Number.isInteger(action.placed_col)
      && (action.placed_col as number) >= 0 && (action.placed_col as number) <= 2) {
    return { kind: "place", placed_col: action.placed_col as number };
  }
  if (action?.kind === "cast" && typeof action.rune_id === "string"
      && RUNES.has(action.rune_id) && Number.isInteger(action.target_col)
      && (action.target_col as number) >= -1 && (action.target_col as number) <= 2) {
    return {
      kind: "cast",
      rune_id: action.rune_id,
      target_col: action.target_col as number,
    };
  }
  return null;
}

export function createPvpActionHandler(dependencies: ActionDependencies) {
  return async (request: Request): Promise<Response> => {
    const prologue = await authenticatedPost(request, dependencies.authenticate);
    if (prologue instanceof Response) return prologue;
    const { context, body } = prologue;
    const matchId = body?.match_id;
    const suppliedCommand = commandId(body, request);
    const expected = body?.expected_action_version;
    const auto = body?.auto === true;
    const action = auto ? null : actionInput(body?.action);
    if (typeof matchId !== "string" || typeof suppliedCommand !== "string"
        || !UUID.test(suppliedCommand)
        || !Number.isInteger(expected) || (expected as number) < 0
        || (auto ? body?.action !== undefined : action === null)) {
      return json({ error: "bad-request" }, 400);
    }
    return dependencies.operation(context, {
      matchId,
      commandId: suppliedCommand,
      expectedActionVersion: expected as number,
      auto,
      action,
    });
  };
}
