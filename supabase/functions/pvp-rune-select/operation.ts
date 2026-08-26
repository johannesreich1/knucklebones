import { json, type AuthenticatedContext } from "../_shared/http.ts";
import type { MatchRow, RuneTrialSelectInput } from "../_shared/types.ts";

export interface RuneTrialSelectionPayload {
  match: MatchRow;
  trial?: unknown;
}

export type RuneTrialSelectionFinalizer = (
  context: AuthenticatedContext,
  payload: RuneTrialSelectionPayload,
) => Promise<RuneTrialSelectionPayload>;

const keepSelectionPayload: RuneTrialSelectionFinalizer = async (_context, payload) => payload;

export async function selectRuneTrial(
  context: AuthenticatedContext,
  input: RuneTrialSelectInput,
  finalize: RuneTrialSelectionFinalizer = keepSelectionPayload,
): Promise<Response> {
  const { data, error } = input.kind === "read"
    ? await context.service().rpc("rune_trial_state", {
      p_match_id: input.matchId,
      p_actor: context.user.id,
    })
    : await context.service().rpc("commit_rune_trial_choice", {
      p_match_id: input.matchId,
      p_command_id: input.commandId,
      p_actor: context.user.id,
      p_rune_id: input.runeId,
      p_auto: input.auto,
    });
  if (error?.code === "P0002") return json({ error: "no-match" }, 404);
  if (error?.code === "42501") return json({ error: "no-match" }, 404);
  if (error?.code === "22023") return json({ error: "selection-conflict" }, 409);
  if (error?.code === "P0001" && error.message?.includes("deadline")) {
    return json({ error: "not-stalled-yet" }, 425);
  }
  if (error?.code === "P0001") return json({ error: "selection-over" }, 409);
  if (error) return json({ error: "selection-failed" }, 500);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ error: "selection-failed" }, 500);
  }
  const match = (data as { match?: unknown }).match;
  if (!match || typeof match !== "object" || Array.isArray(match)) {
    return json({ error: "selection-failed" }, 500);
  }
  if ((match as { rune_rules_version?: unknown }).rune_rules_version !== 1) {
    return json({ error: "unsupported-rune-rules" }, 409);
  }
  try {
    const finalized = await finalize(context, data as unknown as RuneTrialSelectionPayload);
    if (!finalized?.match || typeof finalized.match !== "object") {
      return json({ error: "selection-failed" }, 500);
    }
    return json(finalized);
  } catch {
    return json({ error: "selection-failed" }, 500);
  }
}
