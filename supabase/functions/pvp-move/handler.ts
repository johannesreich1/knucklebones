import { json, postOnly, record, type Authenticate, type AuthenticatedContext } from "../_shared/http.ts";
import type { MoveInput } from "../_shared/types.ts";

export type MoveOperation = (context: AuthenticatedContext, input: MoveInput) => Promise<Response>;

export interface MoveDependencies {
  authenticate: Authenticate;
  operation: MoveOperation;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createPvpMoveHandler(dependencies: MoveDependencies) {
  return async (request: Request): Promise<Response> => {
    const early = postOnly(request);
    if (early) return early;
    const context = await dependencies.authenticate(request);
    if (!context) return json({ error: "unauthorized" }, 401);

    let body: Record<string, unknown> | null;
    try { body = record(await request.json()); } catch { return json({ error: "bad-json" }, 400); }
    const matchId = body?.match_id;
    const auto = Boolean(body?.auto);
    const col = body?.col;
    const expectedMoveCount = body?.expected_move_count;
    const suppliedCommand = body?.command_id ?? request.headers.get("Idempotency-Key") ?? undefined;
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
