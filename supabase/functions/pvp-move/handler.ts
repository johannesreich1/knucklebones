import { json, postOnly, record, type Authenticate, type AuthenticatedContext } from "../_shared/http.ts";
import type { MoveInput } from "../_shared/types.ts";

export type MoveOperation = (context: AuthenticatedContext, input: MoveInput) => Promise<Response>;

export interface MoveDependencies {
  authenticate: Authenticate;
  operation: MoveOperation;
}

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
    if (typeof matchId !== "string") return json({ error: "bad-request" }, 400);
    if (!auto && !Number.isInteger(col)) return json({ error: "bad-request" }, 400);
    return dependencies.operation(context, {
      matchId,
      col: Number.isInteger(col) ? col as number : -1,
      auto,
    });
  };
}
