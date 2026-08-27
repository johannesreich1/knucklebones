import type { OnlineState } from './play-types.ts';

/**
 * Mark a projection read as mandatory. A known action version is monotonic:
 * a later generic recovery request must never weaken an already-confirmed
 * command response into "any coherent snapshot will do".
 */
export function requireProjectionRecovery(
  online: OnlineState,
  actionVersion: number | null = null,
): void {
  online.recoverySync = true;
  if (actionVersion !== null) {
    online.recoveryActionVersion = Math.max(
      online.recoveryActionVersion ?? actionVersion,
      actionVersion,
    );
  }
}

/** Clear recovery only when the authoritative projection reached its target. */
export function completeProjectionRecovery(
  online: OnlineState,
  synced: boolean,
): boolean {
  const complete = synced
    && (!online.trial || online.recoveryActionVersion === null
      || online.actionApplied >= online.recoveryActionVersion);
  if (complete) {
    online.recoverySync = false;
    online.recoveryActionVersion = null;
  }
  return complete;
}

export function projectionRecoveryVersionReached(online: OnlineState): boolean {
  return online.recoveryActionVersion === null
    || online.actionApplied >= online.recoveryActionVersion;
}
