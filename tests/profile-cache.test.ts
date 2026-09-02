import assert from 'node:assert/strict';
import {
  ACCOUNT_PROFILE_CACHE_KEY,
  ACCOUNT_PROFILE_CACHE_VERSION,
  ACCOUNT_PROFILE_REQUIRED_EQUIPMENT_FIELDS,
  ACCOUNT_PROFILE_REQUIRED_FIELDS,
  ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS,
  cacheAccountProfile,
  cacheProfileAvatar,
  cacheProfileClaim,
  cacheProfileIdentity,
  cacheStanding,
  clearProfileCache,
  readAccountProfileCache,
  readProfileCache,
  readProfileCacheForAccount,
} from '../src/profile-cache.ts';
import { cacheAccountView } from '../src/online/screens/account-profile-cache.ts';

const values = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};

const accountId = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const normalized = accountId.toLowerCase();
const eagerProfileKey = 'knucklebones.online.profile';
const snapshot = {
  accountId,
  profile: {
    id: accountId,
    nickname: 'CachedPlayer',
    rating: 465,
    created_at: '2026-08-01T00:00:00Z',
    avatar: 'die:5:cy',
    named_at: null,
  },
  user: { id: accountId, guest: true, email: null },
  ladder: {
    points: 465, peak: 700, wins: 42, losses: 61, draws: 0,
    runeSeatUnlocked: false,
  },
  standing: { points: 465, rank: 7, population: 199, percentile: 4 },
  standingKnown: true,
  curveVersion: 2 as const,
  streak: 4,
  recent: [{
    id: 'match-1', when: '2026-08-31T12:00:00Z', opponent: 'Nova', mode: 'classic',
    mine: 21, theirs: 18, delta: 12,
    baseDelta: 9, finishDelta: 3, scoringVersion: 2, result: 'win' as const,
  }],
  identity: {
    gameCenterLinked: false,
    appleLinked: false,
    appleRevocationReady: false,
  },
  runes: ['fate'],
  runeRows: [{
    rune_id: 'fate', collected_at: '2026-08-20T00:00:00Z',
    source_match_id: null, seen_at: '2026-08-21T00:00:00Z',
  }],
  equipment: { kind: 'fixed' as const, runeId: 'fate' },
};

values.set(eagerProfileKey, JSON.stringify({
  accountId: 42,
  nickname: 'Malformed',
  rating: 10,
}));
assert.equal(readProfileCache(), null, 'a non-string eager-cache account id was accepted');
assert.doesNotThrow(() => readProfileCacheForAccount(accountId),
  'a malformed eager-cache account id crashed an account-bound read');
values.delete(eagerProfileKey);

assert.equal(cacheAccountProfile(snapshot), true);
const cached = readAccountProfileCache(normalized);
assert.equal(cached?.version, ACCOUNT_PROFILE_CACHE_VERSION);
assert.equal(cached?.accountId, normalized);
assert.equal(cached?.profile.nickname, 'CachedPlayer');
assert.equal(cached?.standing?.rank, 7);
assert.equal(readAccountProfileCache('11111111-2222-4333-8444-555555555555'), null,
  'another account read the active profile snapshot');
assert.doesNotThrow(() => readAccountProfileCache(42 as any),
  'a non-string requested account id crashed the complete-cache reader');
assert.equal(readAccountProfileCache(42 as any), null,
  'a non-string requested account id matched a complete profile snapshot');

cacheProfileIdentity({
  accountId, nickname: 'CachedPlayer', rating: 465, avatar: 'die:5:cy',
});
cacheStanding('11111111-2222-4333-8444-555555555555', {
  points: 1400, rank: 2, population: 100, percentile: 2,
}, true);
assert.equal(readProfileCache()?.rank, undefined,
  'a delayed standing response updated another account\'s Home badge');
const refreshedStanding = { ...snapshot.standing, points: 500, rank: 5, percentile: 3 };
cacheStanding(accountId, refreshedStanding, false);
assert.deepEqual(readProfileCache(), {
  accountId: normalized, nickname: 'CachedPlayer', rating: 500,
  avatar: 'die:5:cy', rank: 5, apex: false,
});
assert.deepEqual(readAccountProfileCache()?.standing, refreshedStanding,
  'a standing confirmed outside Profile left its complete fallback stale');
assert.equal(readAccountProfileCache()?.ladder.points, refreshedStanding.points,
  'a fresh standing rank was paired with stale complete Profile points');
cacheProfileIdentity({ accountId, nickname: 'RenamedAfterStanding', rating: 465 });
assert.equal(readProfileCache()?.rating, refreshedStanding.points,
  'a late profile mirror split Home\'s newer rank from its standing points');
assert.equal(readProfileCache()?.nickname, 'RenamedAfterStanding',
  'preserving a standing tuple blocked a later identity refresh');
cacheAccountView({
  profile: { ...snapshot.profile },
  user: { ...snapshot.user },
  ladder: { ...snapshot.ladder },
  standing: { ...snapshot.standing },
  standingKnown: true,
  curveVersion: 2 as const,
  streak: snapshot.streak,
  identity: { ...snapshot.identity },
  runes: [...snapshot.runes],
  runeRows: snapshot.runeRows.map((row) => ({ ...row })),
  equipment: { ...snapshot.equipment },
}, snapshot.recent.map((row) => ({ ...row })));
assert.equal(readAccountProfileCache()?.standing?.rank, refreshedStanding.rank,
  'a later non-standing Profile write overwrote a newer cross-surface standing');
assert.equal(readAccountProfileCache()?.ladder.points, refreshedStanding.points,
  'a later non-standing Profile write split a newer standing from its points');

const complete = JSON.parse(values.get(ACCOUNT_PROFILE_CACHE_KEY)!);
for (const field of ACCOUNT_PROFILE_REQUIRED_FIELDS) {
  const missing = { ...complete };
  delete missing[field];
  values.set(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify(missing));
  assert.equal(readAccountProfileCache(), null,
    `a snapshot missing the visible field ${field} was treated as complete`);
}
for (const [section, fields] of Object.entries(ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS)) {
  for (const field of fields) {
    const missing = JSON.parse(JSON.stringify(complete));
    const sectionValue = missing[section];
    const target = Array.isArray(sectionValue) ? sectionValue[0] : sectionValue;
    delete target[field];
    values.set(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify(missing));
    assert.equal(readAccountProfileCache(), null,
      `a snapshot missing the visible field ${section}.${field} was treated as complete`);
  }
}
const equipmentVariants = {
  none: { kind: 'none' },
  random: { kind: 'random' },
  fixed: { kind: 'fixed', runeId: 'fate' },
};
for (const [variant, fields] of Object.entries(ACCOUNT_PROFILE_REQUIRED_EQUIPMENT_FIELDS)) {
  for (const field of fields) {
    const missing = JSON.parse(JSON.stringify(complete));
    missing.equipment = { ...equipmentVariants[variant as keyof typeof equipmentVariants] };
    delete missing.equipment[field];
    values.set(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify(missing));
    assert.equal(readAccountProfileCache(), null,
      `a snapshot missing the visible field equipment.${variant}.${field} was complete`);
  }
}
values.set(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify({ ...complete, identity: null }));
assert.equal(readAccountProfileCache(), null,
  'an unavailable identity presentation was treated as a complete snapshot');

const invalidCachedDates = [
  ['profile.created_at', (candidate: any) => { candidate.profile.created_at = 'not-a-date'; }],
  ['profile.named_at', (candidate: any) => { candidate.profile.named_at = 'not-a-date'; }],
  ['recent.when', (candidate: any) => { candidate.recent[0].when = 'not-a-date'; }],
  ['runeRows.collected_at', (candidate: any) => {
    candidate.runeRows[0].collected_at = 'not-a-date';
  }],
  ['runeRows.seen_at', (candidate: any) => { candidate.runeRows[0].seen_at = 'not-a-date'; }],
] as const;
for (const [field, invalidate] of invalidCachedDates) {
  const invalidDate = JSON.parse(JSON.stringify(complete));
  invalidate(invalidDate);
  values.set(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify(invalidDate));
  assert.equal(readAccountProfileCache(), null,
    `an invalid cached ${field} reached Profile's date formatter`);
}

values.set(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify({ ...complete, version: 0 }));
assert.equal(readAccountProfileCache(), null, 'an old snapshot version was accepted');
values.set(ACCOUNT_PROFILE_CACHE_KEY, '{broken');
assert.equal(readAccountProfileCache(), null, 'corrupt profile JSON was accepted');

values.set(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify(complete));
const invalid = { ...snapshot, recent: [{ ...snapshot.recent[0], result: 'unknown' as any }] };
assert.equal(cacheAccountProfile(invalid), false, 'an invalid refresh replaced the cache');
assert.equal(readAccountProfileCache()?.profile.nickname, 'CachedPlayer');

values.set(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify(complete));
cacheProfileClaim(accountId, 'ClaimedPlayer');
cacheProfileAvatar(accountId, 'die:2:mg');
assert.equal(readAccountProfileCache()?.profile.nickname, 'ClaimedPlayer',
  'a successful claim was lost when the next full refresh was unavailable');
assert.ok(readAccountProfileCache()?.profile.named_at,
  'a successful claim left the cached one-time claim action visible');
assert.equal(readAccountProfileCache()?.profile.avatar, 'die:2:mg',
  'a successful avatar save was lost when the next full refresh was unavailable');
assert.equal(readProfileCache()?.nickname, 'ClaimedPlayer');
assert.equal(readProfileCache()?.avatar, 'die:2:mg');

clearProfileCache();
assert.equal(values.has(ACCOUNT_PROFILE_CACHE_KEY), false,
  'sign-out cache clearing retained the complete profile snapshot');

console.log(JSON.stringify({ problems: [] }));
