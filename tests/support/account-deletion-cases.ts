// ACCOUNT DELETION'S CONTRACT WITH SETTLEMENT AND WITH APPLE REVOCATION.
//
// Deleting an account is a settlement event: every match the leaver is still in
// pays its opponent out, and only then may the auth identity go. Get that order
// wrong and the opponent's ladder points vanish with the row that owed them.
// The second half is the Apple side of the same one-way door — the revocation
// this deletion stages must never outlive a deletion that failed.
import { readFileSync } from 'node:fs';
import type {
  AuthenticatedContext, EdgeClient,
} from '../../supabase/functions/_shared/http.ts';
import { deleteAccountWithSettlement } from '../../supabase/functions/_shared/account-deletion.ts';
import { standardMatch } from './edge-operations.ts';
import { SettlementService, createRecordingSettlement } from './edge-settlement-doubles.ts';

type Check = (ok: boolean, message: string) => void;

/** The pins that read the shipped source, not a double: no future edit may
    reintroduce a sequential payout, reorder the delete ahead of the payout, or
    let a staged Apple revocation be dropped on the floor. */
export function assertDeletionSourceContract(check: Check) {
  const terminalOperations = [
    'supabase/functions/_shared/account-deletion.ts',
  ];
  for (const file of terminalOperations) {
    const source = readFileSync(file, 'utf8');
    check(source.includes('settleMatch('), `${file} does not route its terminal path through settleMatch()`);
    check(!/\.from\("season_ratings"\)\s*\.update|\.from\("profiles"\)\s*\.update/.test(source),
      `${file} still performs a sequential ladder/profile payout outside the atomic RPC`);
  }
  const deletion = readFileSync('supabase/functions/_shared/account-deletion.ts', 'utf8');
  check(deletion.indexOf('settleMatch(') < deletion.indexOf('deleteUser('),
    'account deletion removes auth identity before settling active opponents');

  const accountDeleteOperation = readFileSync('supabase/functions/account-delete/operation.ts', 'utf8');
  const stageFailureGuard = accountDeleteOperation.indexOf(
    'if (error) throw new Error("apple-revocation-stage-failed")',
  );
  const stagedCredentialReturn = accountDeleteOperation.indexOf(
    'return { appleLinked, credentialId: data }',
  );
  check(stageFailureGuard !== -1 && stageFailureGuard < stagedCredentialReturn
    && accountDeleteOperation.includes('data !== null && typeof data !== "number"'),
    'account deletion can discard an Apple revocation staging failure before deleting auth identity');
  check(accountDeleteOperation.includes('undoBeforeDelete')
    && accountDeleteOperation.includes('unstage_apple_revocation'),
    'a failed auth deletion leaves the staged Apple revocation for the retry cron to execute');
  const unstageMigration = readFileSync(
    'supabase/migrations/20260826181000_apple_revocation_unstage.sql', 'utf8',
  );
  check(unstageMigration.includes('create function public.unstage_apple_revocation(p_user uuid)')
    && /set state = 'active'/.test(unstageMigration)
    && /state = 'pending'/.test(unstageMigration)
    && unstageMigration.includes(
      'grant execute on function public.unstage_apple_revocation(uuid) to service_role',
    ),
    'the unstage RPC does not return a pending revocation credential to active for the service role');
}

/** The live lifecycle, driven through the recording client: a clean delete, a
    delete whose opponent payout failed, a delete whose provider-revocation
    state could not be prepared, and the two compensation paths. */
export async function assertDeletionLifecycle(check: Check) {
  const match = standardMatch({
    turn: 0, p1_score: 0, p2_score: 0, last_move_at: '2026-08-23T10:00:00.000Z',
  });
  const { calculate } = createRecordingSettlement();
  const deleting = new SettlementService();
  deleting.activeMatches = [{ ...match }];
  deleting.replies = [{
    data: { applied: true, match: { ...match, status: 'forfeit', winner: match.p2 } },
  }];
  const deletingContext = {
    user: { id: match.p1 },
    authed: {},
    service: () => deleting as unknown as EdgeClient,
  } as unknown as AuthenticatedContext;
  const deletedResponse = await deleteAccountWithSettlement(deletingContext, calculate);
  check(deletedResponse.status === 200 && deleting.deleteCalls === 1,
    'account deletion did not remove auth identity after a successful payout');
  check(deleting.events.join(',') === 'prepare-delete,settle-match,delete-user',
    'account deletion did not commit opponent payout before deleting auth identity');

  const payoutFailure = new SettlementService();
  payoutFailure.activeMatches = [{ ...match }];
  payoutFailure.replies = [{ error: { code: 'XX000', message: 'payout failed' } }];
  const failedDelete = await deleteAccountWithSettlement({
    ...deletingContext,
    service: () => payoutFailure as unknown as EdgeClient,
  }, calculate);
  check(failedDelete.status === 500
    && (await failedDelete.json()).error === 'settlement-failed'
    && payoutFailure.deleteCalls === 0,
    'account deletion removed identity after an opponent payout failure');

  const lifecycleFailure = new SettlementService();
  const failedLifecycle = await deleteAccountWithSettlement({
    ...deletingContext,
    service: () => lifecycleFailure as unknown as EdgeClient,
  }, calculate, { beforeDelete: async () => { throw new Error('vault unavailable'); } });
  check(failedLifecycle.status === 500 && lifecycleFailure.deleteCalls === 0,
    'account deletion continued after its provider-revocation state could not be prepared');

  /* The missing branch: staging succeeded but deleteUser failed. The account
     lives on, so the staged revocation must be compensated before the retry
     cron can revoke a live user's Sign in with Apple grant. */
  const failedAuthDelete = new SettlementService();
  failedAuthDelete.deleteError = { message: 'auth 502' };
  const undoStates: unknown[] = [];
  const compensated = await deleteAccountWithSettlement({
    ...deletingContext,
    service: () => failedAuthDelete as unknown as EdgeClient,
  }, calculate, {
    beforeDelete: async () => 'staged-credential',
    undoBeforeDelete: async (state) => { undoStates.push(state); },
  });
  check(compensated.status === 500
    && (await compensated.json()).error === 'delete-failed'
    && failedAuthDelete.deleteCalls === 1
    && undoStates.length === 1 && undoStates[0] === 'staged-credential',
    'a failed auth deletion did not unstage the provider revocation it had staged');

  const throwingUndo = new SettlementService();
  throwingUndo.deleteError = { message: 'auth 502' };
  const undoFailure = await deleteAccountWithSettlement({
    ...deletingContext,
    service: () => throwingUndo as unknown as EdgeClient,
  }, calculate, {
    beforeDelete: async () => 'staged-credential',
    undoBeforeDelete: async () => { throw new Error('unstage unavailable'); },
  });
  check(undoFailure.status === 500 && (await undoFailure.json()).error === 'delete-failed',
    'a failed compensation changed the delete-failed contract');
}
