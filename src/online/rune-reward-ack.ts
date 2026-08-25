// Account identity is part of a reward acknowledgement, not ambient context.
// Keeping this comparison pure makes the A -> B session race testable without
// constructing Supabase in Node; the production adapter performs the RPC in
// the same turn as the final session check.
export interface ActiveRuneRewardAccount {
  readonly accountId: string;
  /** The credential captured by the final identity check, never ambient auth. */
  readonly accessToken: string;
}

export interface RuneRewardAcknowledgementPorts {
  activeAccount(): Promise<ActiveRuneRewardAccount | null>;
  acknowledge(runeId: string, account: ActiveRuneRewardAccount): Promise<boolean>;
}

export async function acknowledgeRuneRewardForAccount(
  expectedAccountId: string,
  runeId: string,
  ports: RuneRewardAcknowledgementPorts,
): Promise<boolean> {
  const activeAccount = await ports.activeAccount();
  if (!activeAccount
      || activeAccount.accountId.toLowerCase() !== expectedAccountId.toLowerCase()) return false;
  // No await or callback boundary may sit between this comparison and the
  // request. The adapter also receives the token captured by this exact check,
  // so a later A -> B session replacement cannot retarget the request to B.
  return ports.acknowledge(runeId, activeAccount);
}
