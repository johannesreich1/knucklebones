import assert from 'node:assert/strict';
import { createCollectionRefreshGuard } from '../src/online/runes/rune-collection-guard.ts';
import { acknowledgeRuneRewardForAccount } from '../src/online/runes/rune-reward-ack.ts';
import { withRuneRewardAcknowledgementDeadline } from '../src/online/runes/rune-reward-ack.ts';

const guard = createCollectionRefreshGuard();
const accountA = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const accountB = '11111111-2222-4333-8444-555555555555';

const delayedA = guard.begin(accountA);
guard.invalidate(); // sign-out happens while A's reads are pending
assert.equal(guard.owns(delayedA, accountA), false);

const activeB = guard.begin(accountB);
assert.equal(guard.owns(delayedA, accountB), false);
assert.equal(guard.owns(activeB, accountB.toUpperCase()), true);

const newerB = guard.begin(accountB);
assert.equal(guard.owns(activeB, accountB), false, 'an older same-account refresh won the race');
assert.equal(guard.owns(newerB, accountB), true);
assert.equal(guard.owns(newerB, null), false);
assert.deepEqual(guard.settle(activeB, accountB, accountB), {
  owns: false,
  discardRetained: false,
}, 'an older failed B refresh discarded the newer B refresh\'s confirmed cache');
assert.deepEqual(guard.settle(newerB, accountA, accountB), {
  owns: false,
  discardRetained: true,
}, 'a successful or failed B read retained B runes after the session became A');
assert.deepEqual(guard.settle(newerB, accountA, accountA), {
  owns: false,
  discardRetained: false,
}, 'a stale B refresh discarded the active A refresh\'s cache');

/* The refresh token is acquired before an ACK barrier. A can wake only after
   B has completed, but that must not let A become the newest revision. */
const barrierGuard = createCollectionRefreshGuard();
let releaseHeldA!: () => void;
const heldA = new Promise<void>((resolve) => { releaseHeldA = resolve; });
const waitingA = barrierGuard.begin(accountA);
const staleA = heldA.then(() => barrierGuard.settle(waitingA, accountB, accountB));
const completedB = barrierGuard.begin(accountB);
releaseHeldA();
assert.deepEqual(await staleA, { owns: false, discardRetained: false },
  'A superseded B after waking from A\'s held acknowledgement');
assert.equal(barrierGuard.owns(completedB, accountB), true,
  'A waking from its acknowledgement invalidated B\'s current refresh');

let activeAccount: string | null = accountB;
const acknowledgements: string[] = [];
const acknowledgementPorts = {
  activeAccount: async () => activeAccount
    ? { accountId: activeAccount, accessToken: `token:${activeAccount}` }
    : null,
  acknowledge: async (runeId: string, account: { accessToken: string }) => {
    acknowledgements.push(`${runeId}@${account.accessToken}`);
    return true;
  },
};
assert.equal(await acknowledgeRuneRewardForAccount(
  accountA, 'fate', acknowledgementPorts,
), false, 'an A reward was acknowledged with B active');
assert.deepEqual(acknowledgements, []);
activeAccount = accountA.toUpperCase();
assert.equal(await acknowledgeRuneRewardForAccount(
  accountA, 'fate', acknowledgementPorts,
), true, 'the expected account could not acknowledge its presented reward');
assert.deepEqual(acknowledgements, [`fate@token:${accountA.toUpperCase()}`],
  'the acknowledgement did not keep the credential from the final account check');

let releaseSessionCheck!: (account: { accountId: string; accessToken: string } | null) => void;
const delayedSessionCheck = new Promise<{ accountId: string; accessToken: string } | null>(
  (resolve) => { releaseSessionCheck = resolve; },
);
const racedAcknowledgements: string[] = [];
const raced = acknowledgeRuneRewardForAccount(accountA, 'ward', {
  activeAccount: () => delayedSessionCheck,
  acknowledge: async (runeId) => { racedAcknowledgements.push(runeId); return true; },
});
releaseSessionCheck({ accountId: accountB, accessToken: 'token:b' });
// the session changed while the final check was pending
assert.equal(await raced, false);
assert.deepEqual(racedAcknowledgements, [], 'a delayed A acknowledgement reached B\'s RPC');

let ambientAccount = accountA;
const boundCredentials: string[] = [];
assert.equal(await acknowledgeRuneRewardForAccount(accountA, 'nudge', {
  activeAccount: async () => {
    const checked = { accountId: accountA, accessToken: 'token:a' };
    ambientAccount = accountB; // replacement immediately after the final check
    return checked;
  },
  acknowledge: async (_runeId, checked) => {
    boundCredentials.push(`${checked.accessToken}/${ambientAccount}`);
    return true;
  },
}), true);
assert.deepEqual(boundCredentials, [`token:a/${accountB}`],
  'a post-check A -> B replacement retargeted the write away from A\'s captured token');

let deadlineAborted = false;
const deadlineStarted = Date.now();
assert.equal(await withRuneRewardAcknowledgementDeadline(
  () => new Promise<boolean>(() => undefined),
  10,
  () => { deadlineAborted = true; },
), false, 'a hanging session lookup kept the reward acknowledgement alive forever');
assert.equal(deadlineAborted, true, 'the whole-ack deadline did not cancel its transport');
assert.ok(Date.now() - deadlineStarted < 1000,
  'the whole-ack deadline did not release collection refreshes promptly');

console.log(JSON.stringify({ problems: [] }));
