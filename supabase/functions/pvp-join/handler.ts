import { authenticatedPost, json, type Authenticate, type AuthenticatedContext } from "../_shared/http.ts";
import type { JoinInput } from "../_shared/types.ts";

export type JoinOperation = (context: AuthenticatedContext, input: JoinInput) => Promise<Response>;

export interface JoinDependencies {
  authenticate: Authenticate;
  operation: JoinOperation;
}

export function createPvpJoinHandler(dependencies: JoinDependencies) {
  return async (request: Request): Promise<Response> => {
    /* an empty body is valid: a legacy client joins with no payload at all */
    const prologue = await authenticatedPost(request, dependencies.authenticate, { optionalBody: true });
    if (prologue instanceof Response) return prologue;
    const { context, body } = prologue;
    const suppliedProtocol = body?.protocol_version;
    const protocolVersion = suppliedProtocol === undefined ? 1 : suppliedProtocol;
    const suppliedCapabilities = body?.capabilities;
    const capabilities = suppliedCapabilities === undefined ? [] : suppliedCapabilities;
    if ((protocolVersion !== 1 && protocolVersion !== 2)
        || !Array.isArray(capabilities)
        || !capabilities.every((capability) => capability === "rune_trial_v1")
        || new Set(capabilities).size !== capabilities.length
        || (capabilities.includes("rune_trial_v1") && protocolVersion !== 2)) {
      return json({ error: "bad-request" }, 400);
    }
    return dependencies.operation(context, {
      allowBot: body?.allow_bot === true,
      protocolVersion,
      capabilities,
    });
  };
}
