import { json, postOnly, record, type Authenticate, type AuthenticatedContext } from "../_shared/http.ts";
import type { RuneTrialSelectInput } from "../_shared/types.ts";

export type RuneSelectOperation = (
  context: AuthenticatedContext,
  input: RuneTrialSelectInput,
) => Promise<Response>;

export interface RuneSelectDependencies {
  authenticate: Authenticate;
  operation: RuneSelectOperation;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUNES = new Set(["fate", "nudge", "ward", "sunder", "pilfer", "anvil"]);

export function createPvpRuneSelectHandler(dependencies: RuneSelectDependencies) {
  return async (request: Request): Promise<Response> => {
    const early = postOnly(request);
    if (early) return early;
    const context = await dependencies.authenticate(request);
    if (!context) return json({ error: "unauthorized" }, 401);

    let body: Record<string, unknown> | null;
    try { body = record(await request.json()); } catch { return json({ error: "bad-json" }, 400); }
    const matchId = body?.match_id;
    if (typeof matchId !== "string") return json({ error: "bad-request" }, 400);
    if (body?.read === true) {
      if (body.command_id !== undefined || body.rune_id !== undefined
          || body.auto !== undefined) return json({ error: "bad-request" }, 400);
      return dependencies.operation(context, { kind: "read", matchId });
    }
    const commandId = body?.command_id ?? request.headers.get("Idempotency-Key");
    const auto = body?.auto === true;
    const runeId = body?.rune_id;
    if (typeof commandId !== "string" || !UUID.test(commandId)) {
      return json({ error: "bad-request" }, 400);
    }
    if (auto ? runeId !== undefined : typeof runeId !== "string" || !RUNES.has(runeId)) {
      return json({ error: "bad-request" }, 400);
    }
    return dependencies.operation(context, {
      kind: "commit",
      matchId,
      commandId,
      runeId: auto ? null : runeId as string,
      auto,
    });
  };
}
