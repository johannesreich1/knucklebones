import assert from 'node:assert/strict';
import { createCollectionRefreshGuard } from '../src/online/rune-collection-guard.ts';

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

console.log(JSON.stringify({ problems: [] }));
