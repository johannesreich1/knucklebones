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
  } catch {
    return json({ error: "settlement-failed" }, 500);
  }

  let lifecycleState: unknown;
  try { lifecycleState = await lifecycle.beforeDelete?.(); }
  catch { return json({ error: "delete-failed" }, 500); }

  const { error } = await service.auth.admin.deleteUser(user.id);
  if (error) return json({ error: "delete-failed" }, 500);
  let extra: Record<string, unknown> = {};
  try { extra = await lifecycle.afterDelete?.(lifecycleState) ?? {}; }
  catch { extra = { appleRevocation: "pending" }; }
  return json({ deleted: true, ...extra });
}
