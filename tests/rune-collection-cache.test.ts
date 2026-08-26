import assert from 'node:assert/strict';
import {
  RUNE_COLLECTION_CACHE_KEY,
  clearRuneCollectionSnapshot,
  collectedRuneCount,
  collectedRuneIds,
  confirmedRankedPoolTier,
  hasCollectedRune,
  readRuneCollectionSnapshot,
  subscribeRuneCollection,
  writeRuneCollectionSnapshot,
} from '../src/rune-collection-cache.ts';

const values = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};

const account = '11111111-2222-4333-8444-555555555555';
const other = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
assert.deepEqual(collectedRuneIds(), []);
assert.equal(collectedRuneCount(), 0);
assert.equal(writeRuneCollectionSnapshot('not-an-account', ['fate']), false);
assert.equal(writeRuneCollectionSnapshot(account, ['fate', 'fate', 'ward'], 123, 'bone'), true);
assert.deepEqual(readRuneCollectionSnapshot(), {
  version: 1,
  accountId: account,
  verifiedAt: 123,
  collected: ['fate', 'ward'],
  poolTier: 'bone',
});
assert.equal(confirmedRankedPoolTier(), 'bone');
assert.equal(hasCollectedRune('fate'), true);
assert.equal(hasCollectedRune('pilfer'), false);
assert.equal(collectedRuneCount(), 2);

assert.equal(writeRuneCollectionSnapshot(account, ['unknown']), false);
assert.deepEqual(collectedRuneIds(), ['fate', 'ward'], 'an invalid write replaced the verified cache');
values.set(RUNE_COLLECTION_CACHE_KEY, '{broken');
assert.equal(readRuneCollectionSnapshot(), null);
values.set(RUNE_COLLECTION_CACHE_KEY, JSON.stringify({
  version: 1, accountId: account, verifiedAt: 5, collected: ['fate', 'unknown'],
}));
assert.deepEqual(collectedRuneIds(), [], 'a partly valid collection did not fail closed');

values.set(RUNE_COLLECTION_CACHE_KEY, JSON.stringify({
  version: 1, accountId: account, verifiedAt: 6, collected: [],
}));
assert.equal(confirmedRankedPoolTier(), null, 'a pre-v2 cache fabricated permanent tier access');
assert.equal(writeRuneCollectionSnapshot(account, [], 6, 'silver' as any), false);

assert.equal(writeRuneCollectionSnapshot(account, ['anvil'], 456), true);
assert.equal(clearRuneCollectionSnapshot(other), false, 'a stale account cleared the active snapshot');
assert.deepEqual(collectedRuneIds(), ['anvil']);
let published: readonly string[] | null = null;
const unsubscribe = subscribeRuneCollection((snapshot) => { published = snapshot?.collected ?? null; });
assert.equal(writeRuneCollectionSnapshot(other, ['nudge'], 789), true);
assert.deepEqual(published, ['nudge']);
assert.equal(clearRuneCollectionSnapshot(other), true);
assert.equal(published, null);
unsubscribe();

console.log(JSON.stringify({ problems: [] }));
