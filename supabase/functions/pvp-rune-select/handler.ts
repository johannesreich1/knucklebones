import {
  authenticatedPost, commandId, json, UUID,
  type Authenticate, type AuthenticatedContext,
} from "../_shared/http.ts";
import { RUNE_IDS } from "../_shared/rune-ids.ts";
import type { RuneTrialSelectInput } from "../_shared/types.ts";

export type RuneSelectOperation = (
  context: AuthenticatedContext,
  input: RuneTrialSelectInput,
) => Promise<Response>;

export interface RuneSelectDependencies {
  authenticate: Authenticate;
  operation: RuneSelectOperation;
}

const RUNES = new Set(RUNE_IDS);

export function createPvpRuneSelectHandler(dependencies: RuneSelectDependencies) {
  return async (request: Request): Promise<Response> => {
    const prologue = await authenticatedPost(request, dependencies.authenticate);
    if (prologue instanceof Response) return prologue;
    const { context, body } = prologue;
    const matchId = body?.match_id;
    if (typeof matchId !== "string") return json({ error: "bad-request" }, 400);
    if (body?.read === true) {
      if (body.command_id !== undefined || body.rune_id !== undefined
          || body.auto !== undefined) return json({ error: "bad-request" }, 400);
      return dependencies.operation(context, { kind: "read", matchId });
    }
    const suppliedCommand = commandId(body, request);
    const auto = body?.auto === true;
    const runeId = body?.rune_id;
    if (typeof suppliedCommand !== "string" || !UUID.test(suppliedCommand)) {
      return json({ error: "bad-request" }, 400);
    }
    if (auto ? runeId !== undefined : typeof runeId !== "string" || !RUNES.has(runeId)) {
      return json({ error: "bad-request" }, 400);
    }
    return dependencies.operation(context, {
      kind: "commit",
      matchId,
      commandId: suppliedCommand,
      runeId: auto ? null : runeId as string,
      auto,
    });
  };
}
