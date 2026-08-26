import { json, type AuthenticatedContext } from "./http.ts";
import {
  settleMatch,
  type LadderSettlement,
  type SettlementScore,
} from "./settlement.ts";
import type { MatchRow } from "./types.ts";

/** Pay active opponents first, then perform the privacy deletion cascade. */
export async function deleteAccountWithSettlement(
  context: AuthenticatedContext,
  calculate: LadderSettlement,
  lifecycle: {
    beforeDelete?(): Promise<unknown>;
    undoBeforeDelete?(state: unknown): Promise<void>;
    afterDelete?(state: unknown): Promise<Record<string, unknown>>;
  } = {},
): Promise<Response> {
  const { user } = context;
  const service = context.service();

  const { data, error: activeError } = await service.rpc("prepare_account_deletion", {
    p_player: user.id,
  });
  if (activeError || !Array.isArray(data)) return json({ error: "delete-failed" }, 500);

  // If payout cannot be committed atomically, keep the account so the owner
  // can retry and no opponent silently loses a win. Auth deletion later
  // cascades the deleting player's profile and private match history; the
  // opponent's already-updated ladder/profile rows survive that cascade.
  try {
    for (const active of data as MatchRow[]) {
      const opponent = active.p1 === user.id ? active.p2 : active.p1;
      const p1Result: SettlementScore = opponent === active.p1 ? 1 : 0;
      await settleMatch(service, active, {
        status: "forfeit",
        winner: opponent,
        p1Score: active.p1_score ?? 0,
        p2Score: active.p2_score ?? 0,
        p1Result,
      }, calculate);
    }
  } catch (settlementError) {
    console.error("account deletion payout failed:", settlementError);
    return json({ error: "settlement-failed" }, 500);
  }

  let lifecycleState: unknown;
  try { lifecycleState = await lifecycle.beforeDelete?.(); }
  catch (lifecycleError) {
    console.error("account deletion staging failed:", lifecycleError);
    return json({ error: "delete-failed" }, 500);
  }

  const { error } = await service.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("auth user deletion failed:", error.message);
    // The account lives on, so compensate whatever beforeDelete staged — a
    // still-staged Apple revocation would otherwise be executed by the retry
    // cron against a live user.
    try { await lifecycle.undoBeforeDelete?.(lifecycleState); }
    catch (undoError) { console.error("account deletion compensation failed:", undoError); }
    return json({ error: "delete-failed" }, 500);
  }
  let extra: Record<string, unknown> = {};
  try { extra = await lifecycle.afterDelete?.(lifecycleState) ?? {}; }
  catch (afterError) {
    console.error("account deletion revocation follow-up failed:", afterError);
    extra = { appleRevocation: "pending" };
  }
  return json({ deleted: true, ...extra });
}
