import {
  authenticatedPost, commandId, json, UUID,
  type Authenticate, type AuthenticatedContext,
} from "../_shared/http.ts";
import type { MoveInput } from "../_shared/types.ts";

export type MoveOperation = (context: AuthenticatedContext, input: MoveInput) => Promise<Response>;

export interface MoveDependencies {
  authenticate: Authenticate;
  operation: MoveOperation;
}

export function createPvpMoveHandler(dependencies: MoveDependencies) {
  return async (request: Request): Promise<Response> => {
    const prologue = await authenticatedPost(request, dependencies.authenticate);
    if (prologue instanceof Response) return prologue;
    const { context, body } = prologue;
    const matchId = body?.match_id;
    const auto = Boolean(body?.auto);
    const col = body?.col;
    const expectedMoveCount = body?.expected_move_count;
    const suppliedCommand = commandId(body, request);
    if (typeof matchId !== "string") return json({ error: "bad-request" }, 400);
    if (!auto && !Number.isInteger(col)) return json({ error: "bad-request" }, 400);
    if (suppliedCommand !== undefined
      && (typeof suppliedCommand !== "string" || !UUID.test(suppliedCommand))) {
      return json({ error: "bad-request" }, 400);
    }
    const hasExpected = expectedMoveCount !== undefined;
    if (hasExpected !== (suppliedCommand !== undefined)
      || (hasExpected && (!Number.isInteger(expectedMoveCount)
        || (expectedMoveCount as number) < 0))) {
      return json({ error: "bad-request" }, 400);
    }
    return dependencies.operation(context, {
      matchId,
      col: Number.isInteger(col) ? col as number : -1,
      auto,
      commandId: suppliedCommand ?? crypto.randomUUID(),
      expectedMoveCount: hasExpected ? expectedMoveCount as number : null,
    });
  };
}
