// DELETING THE CURRENT ACCOUNT.
//
// The Edge Function acts on auth.uid(), so the bearer captured for the request
// must belong to the Profile account that opened the destructive question.
// Session routing stays in session.ts; this module owns the delete lifecycle.
import { callFunction } from '../api/client.ts';
import { onlineMessage } from '../message-copy.ts';
import { forgetDeletedAccount } from './deleted-account-cleanup.ts';
import {
  forgetPersistedAuthAccount,
  persistedAuthAccountId,
  readAuthSession,
} from './session-read.ts';

export type AppleRevocationState = 'complete' | 'pending' | 'manual-required';
export interface AccountDeletionResult {
  readonly error: string | null;
  readonly appleRevocation: AppleRevocationState | null;
  readonly accountMismatch?: true;
}

export async function deleteAccount(accountId: string): Promise<AccountDeletionResult> {
  const expectedAccountId = accountId.toLowerCase();
  const result = await callFunction<{
    deleted?: boolean;
    error?: string;
    appleRevocation?: AppleRevocationState;
  }>('account-delete', {}, { expectedAccountId });
  if (result.accountMismatch) {
    return { error: null, appleRevocation: null, accountMismatch: true };
  }
  if (result.status === 200 && result.data?.deleted) {
    /* Server deletion succeeded for A even if its now-invalid local session
       can no longer be read. Clean A regardless. If B replaced it meanwhile,
       preserve B's session/cache and let the caller route that account. */
    const session = await readAuthSession();
    const activeAccountId = session.kind === 'authenticated'
      ? session.session.user.id.toLowerCase() : null;
    const persistedAccountId = persistedAuthAccountId();
    const replacementAccount = [activeAccountId, persistedAccountId]
      .find((id) => id !== null && id !== expectedAccountId) ?? null;
    forgetPersistedAuthAccount(expectedAccountId);
    forgetDeletedAccount(expectedAccountId, !!replacementAccount);
    if (replacementAccount) {
      return { error: null, appleRevocation: null, accountMismatch: true };
    }
    return { error: null, appleRevocation: result.data.appleRevocation ?? null };
  }
  /* A refused request leaves A untouched. If B appeared while it was in
     flight, the stale Profile may not display A's failure over B. */
  const session = await readAuthSession();
  if (session.kind === 'authenticated'
      && session.session.user.id.toLowerCase() !== expectedAccountId) {
    return { error: null, appleRevocation: null, accountMismatch: true };
  }
  return {
    error: result.status === 401
      ? onlineMessage('errors.notSignedIn')
      : onlineMessage('errors.deleteFailed'),
    appleRevocation: null,
  };
}
