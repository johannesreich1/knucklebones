import { authenticatedPost, json, type Authenticate, type AuthenticatedContext } from "../_shared/http.ts";
import type { ClaimInput } from "../_shared/types.ts";

export type ClaimOperation = (context: AuthenticatedContext, input: ClaimInput) => Promise<Response>;

export interface ClaimDependencies {
  authenticate: Authenticate;
  operation: ClaimOperation;
}

export function createPvpClaimHandler(dependencies: ClaimDependencies) {
  return async (request: Request): Promise<Response> => {
    const prologue = await authenticatedPost(request, dependencies.authenticate);
    if (prologue instanceof Response) return prologue;
    const { context, body } = prologue;
    const matchId = body?.match_id;
    if (typeof matchId !== "string") return json({ error: "bad-request" }, 400);
    return dependencies.operation(context, { matchId, resign: body?.resign === true });
  };
}
