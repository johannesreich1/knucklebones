import assert from 'node:assert/strict';
import {
  DEFAULT_AVATAR,
  PROFILE_AVATARS,
  alternateAppIconForAvatar,
  appIconIdForAvatar,
  canonicalProfileAvatar,
  isProfileAvatar,
  parseAvatar,
  type AlternateAppIcon,
} from '../src/profile-avatar.ts';
import {
  PROFILE_APP_ICON_ENABLED_KEY,
  createAppIconSynchronizer,
  profileAppIconAvailable,
  profileAppIconEnabled,
  setProfileAppIconEnabled,
  syncProfileAppIcon,
  type AppIconBridge,
  type AppIconId,
} from '../src/native/app-icon.ts';
import {
  cacheProfileAvatar,
  cacheProfileIdentity,
  cacheStanding,
  clearProfileCache,
  readProfileCache,
  readProfileCacheForAccount,
} from '../src/profile-cache.ts';

assert.equal(PROFILE_AVATARS.length, 42, 'the six-by-seven profile avatar set drifted');
assert.equal(new Set(PROFILE_AVATARS).size, 42, 'profile avatar variants are not unique');
assert.equal(PROFILE_AVATARS.every(isProfileAvatar), true, 'a canonical avatar fails its parser');
assert.deepEqual(parseAvatar('die:6:blue'), { face: 6, hue: 'blue' });
assert.deepEqual(parseAvatar('img:future'), { face: 5, hue: 'cy' });
assert.equal(canonicalProfileAvatar(null), DEFAULT_AVATAR);
assert.equal(alternateAppIconForAvatar(DEFAULT_AVATAR), null,
  'the compiled cyan-five primary was exposed as an alternate');
assert.equal(appIconIdForAvatar(DEFAULT_AVATAR), 'primary');
assert.equal(appIconIdForAvatar('die:4:violet'), 'die-4-violet');
assert.equal(appIconIdForAvatar('die:5:unknown'), 'primary');
assert.equal(PROFILE_AVATARS.filter((avatar) => alternateAppIconForAvatar(avatar) !== null).length, 41,
  'the primary/null mapping did not leave exactly 41 alternates');
const acceptAlternate = (icon: AlternateAppIcon): AlternateAppIcon => icon;
// @ts-expect-error cyan-five is the primary catalog, never a native alternate id
acceptAlternate('die-5-cy');

const unavailable = createAppIconSynchronizer(() => undefined);
assert.deepEqual(await unavailable.syncAvatar('die:2:mg'), {
  status: 'unavailable', icon: 'die-2-mg',
});

let current: AppIconId = 'primary';
const changes: AppIconId[] = [];
const bridge: AppIconBridge = {
  getState: async () => ({ supported: true, icon: current }),
  setIcon: async ({ icon }) => {
    const changed = current !== icon;
    current = icon;
    changes.push(icon);
    return { supported: true, icon, changed };
  },
};
const icons = createAppIconSynchronizer(() => bridge);
assert.deepEqual(await icons.reset(), { status: 'unchanged', icon: 'primary' });
assert.equal(changes.length, 0, 'idempotent state still called the native setter');
assert.deepEqual(await icons.syncAvatar('die:3:gold'), {
  status: 'changed', icon: 'die-3-gold',
});
assert.deepEqual(changes, ['die-3-gold']);
assert.deepEqual(await icons.syncAvatar('die:3:gold'), {
  status: 'unchanged', icon: 'die-3-gold',
});
assert.deepEqual(changes, ['die-3-gold'], 'a repeated profile selection reached the OS twice');

/* Two requests made in one turn coalesce before native work starts. */
current = 'primary';
changes.length = 0;
const coalesced = createAppIconSynchronizer(() => bridge);
const obsolete = coalesced.syncAvatar('die:1:orange');
const newest = coalesced.syncAvatar('die:2:green');
assert.deepEqual(await obsolete, { status: 'superseded', icon: 'die-1-orange' });
assert.deepEqual(await newest, { status: 'changed', icon: 'die-2-green' });
assert.deepEqual(changes, ['die-2-green']);

/* An OS call already in flight cannot be cancelled. The reset queues behind
   it and must be the final native state after sign-out. */
current = 'primary';
changes.length = 0;
let releaseFirst!: () => void;
let markStarted!: () => void;
const firstStarted = new Promise<void>((resolve) => { markStarted = resolve; });
const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
let setterCalls = 0;
const delayedBridge: AppIconBridge = {
  getState: async () => ({ supported: true, icon: current }),
  setIcon: async ({ icon }) => {
    setterCalls++;
    if (setterCalls === 1) {
      markStarted();
      await release;
    }
    const changed = current !== icon;
    current = icon;
    changes.push(icon);
    return { supported: true, icon, changed };
  },
};
const delayed = createAppIconSynchronizer(() => delayedBridge);
const oldAccount = delayed.syncAvatar('die:6:blue');
await firstStarted;
const signedOut = delayed.reset();
releaseFirst();
assert.deepEqual(await oldAccount, { status: 'superseded', icon: 'die-6-blue' });
assert.deepEqual(await signedOut, { status: 'changed', icon: 'primary' });
assert.equal(current, 'primary', 'an old account icon won after sign-out');
assert.deepEqual(changes, ['die-6-blue', 'primary']);

let fail = true;
const retryBridge: AppIconBridge = {
  getState: async () => {
    if (fail) {
      fail = false;
      throw new Error('native bridge refused');
    }
    return { supported: true, icon: 'primary' };
  },
  setIcon: async ({ icon }) => ({ supported: true, icon, changed: true }),
};
const retry = createAppIconSynchronizer(() => retryBridge);
assert.deepEqual(await retry.syncAvatar('die:4:mg'), { status: 'failed', icon: 'die-4-mg' });
assert.deepEqual(await retry.syncAvatar('die:4:mg'), { status: 'changed', icon: 'die-4-mg' },
  'a rejected attempt poisoned later reconciliation');

assert.deepEqual(await createAppIconSynchronizer(() => ({
  getState: async () => ({ supported: false, icon: 'primary' }),
  setIcon: async ({ icon }) => ({ supported: false, icon, changed: false }),
})).syncAvatar('die:2:cy'), { status: 'unavailable', icon: 'die-2-cy' });
assert.deepEqual(await createAppIconSynchronizer(() => { throw new Error('bad getter'); })
  .syncAvatar('die:2:cy'), { status: 'failed', icon: 'die-2-cy' });

/* The eager profile cache never merges presentation across accounts. */
const storage = new Map<string, string>();
(globalThis as typeof globalThis & { localStorage: Storage }).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
};

/* Alternate launcher art is an explicit device choice. A profile refresh or
   avatar save must not reach the OS until the player has opted in from
   Settings; absence of the preference is the off-by-default state. */
let gatedCurrent: AppIconId = 'primary';
const gatedChanges: AppIconId[] = [];
let gatedReads = 0;
(globalThis as typeof globalThis & {
  Capacitor: { Plugins: { AppIcon: AppIconBridge } };
}).Capacitor = {
  Plugins: {
    AppIcon: {
      getState: async () => {
        gatedReads++;
        return { supported: true, icon: gatedCurrent };
      },
      setIcon: async ({ icon }) => {
        gatedCurrent = icon;
        gatedChanges.push(icon);
        return { supported: true, icon, changed: true };
      },
    },
  },
};
assert.deepEqual(await syncProfileAppIcon('die:4:green'), {
  status: 'disabled', icon: 'die-4-green',
});
assert.equal(gatedReads, 0,
  'disabled profile sync still read native launcher state');
assert.deepEqual(gatedChanges, [],
  'a profile refresh changed the native launcher before the player opted in');
assert.equal(profileAppIconAvailable(), true);
assert.equal(profileAppIconEnabled(), false);

assert.deepEqual(await setProfileAppIconEnabled(true, 'die:4:green'), {
  status: 'changed', icon: 'die-4-green',
});
assert.equal(storage.get(PROFILE_APP_ICON_ENABLED_KEY), '1');
assert.equal(profileAppIconEnabled(), true);
assert.deepEqual(gatedChanges, ['die-4-green']);

assert.deepEqual(await syncProfileAppIcon('die:4:green'), {
  status: 'unchanged', icon: 'die-4-green',
});
assert.deepEqual(gatedChanges, ['die-4-green'],
  'enabled reconciliation rewrote an already-selected icon');
assert.deepEqual(await syncProfileAppIcon('die:2:mg'), {
  status: 'changed', icon: 'die-2-mg',
});
assert.deepEqual(gatedChanges, ['die-4-green', 'die-2-mg']);

assert.deepEqual(await setProfileAppIconEnabled(false, 'die:2:mg'), {
  status: 'changed', icon: 'primary',
});
assert.equal(storage.has(PROFILE_APP_ICON_ENABLED_KEY), false);
assert.equal(profileAppIconEnabled(), false);
assert.equal(gatedCurrent, 'primary');
const readsAfterDisable = gatedReads;
assert.deepEqual(await syncProfileAppIcon('die:6:blue'), {
  status: 'disabled', icon: 'die-6-blue',
});
assert.equal(gatedReads, readsAfterDisable,
  'an avatar refresh reached native state after explicit OFF');

/* OFF persists before its primary reset enters the shared queue, so it wins
   even when the preceding ON request is already inside the OS. */
let raceCurrent: AppIconId = 'primary';
let releaseOptInRequest!: () => void;
let markOptInStarted!: () => void;
const optInStarted = new Promise<void>((resolve) => { markOptInStarted = resolve; });
const optInRelease = new Promise<void>((resolve) => { releaseOptInRequest = resolve; });
(globalThis as typeof globalThis & {
  Capacitor: { Plugins: { AppIcon: AppIconBridge } };
}).Capacitor.Plugins.AppIcon = {
  getState: async () => ({ supported: true, icon: raceCurrent }),
  setIcon: async ({ icon }) => {
    if (icon !== 'primary') {
      markOptInStarted();
      await optInRelease;
    }
    const changed = raceCurrent !== icon;
    raceCurrent = icon;
    return { supported: true, icon, changed };
  },
};
const enabling = setProfileAppIconEnabled(true, 'die:6:blue');
await optInStarted;
const disabling = setProfileAppIconEnabled(false, 'die:6:blue');
releaseOptInRequest();
assert.deepEqual(await enabling, { status: 'superseded', icon: 'die-6-blue' });
assert.deepEqual(await disabling, { status: 'changed', icon: 'primary' });
assert.equal(raceCurrent, 'primary', 'an in-flight opt-in icon won after OFF');
assert.equal(profileAppIconEnabled(), false);

const ACCOUNT_A = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const ACCOUNT_B = '11111111-2222-4333-8444-555555555555';
clearProfileCache();
cacheProfileIdentity({
  accountId: ACCOUNT_A, nickname: 'Alpha', rating: 1200, avatar: 'die:6:blue',
});
cacheStanding(7, false);
cacheProfileAvatar(ACCOUNT_A, 'die:2:mg');
assert.deepEqual(readProfileCacheForAccount(ACCOUNT_A), {
  accountId: ACCOUNT_A.toLowerCase(), nickname: 'Alpha', rating: 1200,
  avatar: 'die:2:mg', rank: 7, apex: false,
});
cacheProfileIdentity({
  accountId: ACCOUNT_B, nickname: 'Beta', rating: 300, avatar: 'die:1:green',
});
assert.deepEqual(readProfileCache(), {
  accountId: ACCOUNT_B.toLowerCase(), nickname: 'Beta', rating: 300, avatar: 'die:1:green',
}, 'the new account inherited presentation from the old account');
assert.equal(readProfileCacheForAccount(ACCOUNT_A), null);

console.log(JSON.stringify({ problems: [] }));
