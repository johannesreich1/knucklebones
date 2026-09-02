import { authenticatedPost, json, type Authenticate, type AuthenticatedContext } from "../_shared/http.ts";
import type { JoinInput } from "../_shared/types.ts";

/* Keep this runtime-free HTTP boundary directly importable under Node. The
   same wire literals are asserted against the core registry by its owner test. */
const RUNE_TRIAL_CAPABILITY = "rune_trial_v1";
const EQUIPPED_RUNE_CAPABILITY = "equipped_rune_v1";
const CURVE_V2_CAPABILITY = "curve_v2";
const RUNE_TRIAL_CLAIM_CAPABILITY = "rune_trial_claim_v2";

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
    const suppliedEntryKind = body?.entry_kind;
    const entryKind = suppliedEntryKind === undefined ? "ordinary" : suppliedEntryKind;
    const knownCapabilities = new Set([
      RUNE_TRIAL_CAPABILITY,
      EQUIPPED_RUNE_CAPABILITY,
      CURVE_V2_CAPABILITY,
      RUNE_TRIAL_CLAIM_CAPABILITY,
    ]);
    if ((protocolVersion !== 1 && protocolVersion !== 2)
        || (entryKind !== "ordinary" && entryKind !== "weekly")
        || !Array.isArray(capabilities)
        || !capabilities.every((capability) => knownCapabilities.has(capability))
        || new Set(capabilities).size !== capabilities.length
        || (capabilities.length > 0 && protocolVersion !== 2)
        /* Equipped standard play reuses the Trial action engine. Requiring the
           older capability alongside the new one preserves the invariant that
           protocol v2 still implies the reveal roster may include Trial. */
        || (capabilities.includes(EQUIPPED_RUNE_CAPABILITY)
          && !capabilities.includes(RUNE_TRIAL_CAPABILITY))
        || (capabilities.includes(RUNE_TRIAL_CLAIM_CAPABILITY)
          && (!capabilities.includes(RUNE_TRIAL_CAPABILITY)
            || !capabilities.includes(CURVE_V2_CAPABILITY)))
        || (entryKind === "weekly" && !capabilities.includes(CURVE_V2_CAPABILITY))) {
      return json({ error: "bad-request" }, 400);
    }
    return dependencies.operation(context, {
      allowBot: body?.allow_bot === true,
      protocolVersion,
      capabilities,
      entryKind,
    });
  };
}
