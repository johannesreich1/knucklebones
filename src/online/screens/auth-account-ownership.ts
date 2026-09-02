import { currentUser } from '../identity/session.ts';
import type { OneTap, OneTapRestoreLifecycle } from '../identity/identity-provider.ts';
import type { AuthMode } from './auth-specs.ts';

export interface AuthOwnership { view: number; operation: number }

/** Account-origin attach actions retain the Profile owner through every
 * credential/native wait. A restore action intentionally changes accounts. */
export async function routeChangedAttachOwner(
  mode: AuthMode,
  expectedAccountId: string | undefined,
  active: () => boolean,
  leave: () => Promise<void>,
): Promise<boolean> {
  if (mode !== 'attach' || !expectedAccountId) return false;
  if (!active()) return true;
  const user = await currentUser();
  if (!active()) return true;
  if (user?.id.toLowerCase() === expectedAccountId.toLowerCase()) return false;
  await leave();
  return true;
}

export async function runOneTapFromAuthSheet(
  method: Pick<OneTap, 'id' | 'restore' | 'attach'>,
  mode: AuthMode,
  readCurrentUser: typeof currentUser = currentUser,
  lifecycle?: OneTapRestoreLifecycle,
  expectedAccountId?: string,
): Promise<string | null> {
  /* Home's sessionless CREATE ACCOUNT sheet uses attach copy, but Game Center
     has no account to attach to there. Restore its authenticated native player
     instead; a real guest/account session keeps the explicit attach path. */
  const effectiveMode = method.id === 'gamecenter' && mode === 'attach'
    && !(await readCurrentUser()) ? 'restore' : mode;
  return effectiveMode === 'restore'
    ? method.restore(lifecycle) : method.attach(expectedAccountId);
}
