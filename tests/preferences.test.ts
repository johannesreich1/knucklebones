import assert from 'node:assert/strict';
import {
  captureUserPreferences,
  parseUserPreferences,
  userPreferences,
  userPreferencesRevision,
  type UserPreferences,
} from '../src/preferences.ts';
import { loadStats, saveStats } from '../src/persist.ts';
import { HUE_IDS, S } from '../src/state.ts';
import { AV_HUES } from '../src/ui/avatar.ts';
import { createAccountPreferenceSync } from '../src/online/preferences.ts';
import { SUPPORTED_LOCALES } from '../src/i18n/index.ts';
import { enOnline } from '../src/i18n/locales/en/online.ts';

const valid: UserPreferences = {
  localeOverride: null,
  sound: false,
  numerals: true,
  p1Hue: 'blue',
  p2Hue: 'gold',
  colorblind: true,
  reducedMotion: null,
};

assert.deepEqual(parseUserPreferences(valid), valid);
for (const localeOverride of SUPPORTED_LOCALES) {
  assert.deepEqual(parseUserPreferences({ ...valid, localeOverride }), { ...valid, localeOverride });
}
assert.equal(parseUserPreferences({ ...valid, localeOverride: 'system' }), null);
assert.equal(parseUserPreferences({ ...valid, localeOverride: 'en-US' }), null);
assert.equal(parseUserPreferences({ ...valid, localeOverride: 'pt-BR' }), null);
assert.equal(parseUserPreferences({ ...valid, localeOverride: 'nl' }), null);
assert.equal(parseUserPreferences({ ...valid, sound: 'off' }), null);
assert.equal(parseUserPreferences({ ...valid, p1Hue: 'pink' }), null);
assert.equal(parseUserPreferences({ ...valid, p2Hue: 'blue' }), null);
assert.equal(parseUserPreferences({ ...valid, reducedMotion: 'device' }), null);

/* Local records before localization have no override and therefore keep the
   automatic default. Concrete supported overrides round-trip; malformed or
   regional values never enter runtime state. */
let stored = '';
(globalThis as any).localStorage = {
  getItem: () => stored || null,
  setItem: (_key: string, value: string) => { stored = value; },
  removeItem: () => undefined,
};
S.localeOverride = 'de';
saveStats();
assert.equal(JSON.parse(stored).localeOverride, 'de');
S.localeOverride = null;
loadStats();
assert.equal(S.localeOverride, 'de');
stored = JSON.stringify({ sound: true });
S.localeOverride = null;
loadStats();
assert.equal(S.localeOverride, null);
stored = JSON.stringify({ localeOverride: 'en-US' });
loadStats();
assert.equal(S.localeOverride, null);
stored = JSON.stringify({ spell: 'random2' });
S.spell = '';
loadStats();
assert.equal(S.spell, 'random2');
stored = JSON.stringify({ spell: 'not-a-rune' });
loadStats();
assert.equal(S.spell, 'random2', 'an unknown rune selector replaced the last valid pick');

/* A legacy single setup seeds both new contexts once. New records keep CPU
   and shared-phone choices independent, including the Rune Trial promise. */
stored = JSON.stringify({ mode: 'cpu', localMode: 4, spell: 'ward' });
loadStats();
assert.deepEqual(S.localChoices, {
  cpu: { localMode: 4, spell: 'ward' },
  duo: { localMode: 4, spell: 'ward' },
});
stored = JSON.stringify({
  mode: 'duo',
  localMode: 0,
  spell: '',
  localChoices: {
    cpu: { localMode: 1, spell: 'fate' },
    duo: { localMode: -2, spell: 'pilfer' },
  },
});
loadStats();
assert.equal(S.mode, 'duo');
assert.equal(S.localMode, -2);
assert.equal(S.spell, 'pilfer');
assert.deepEqual(S.localChoices.cpu, { localMode: 1, spell: 'fate' });
saveStats();
assert.deepEqual(JSON.parse(stored).localChoices, {
  cpu: { localMode: 1, spell: 'fate' },
  duo: { localMode: -2, spell: 'pilfer' },
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function state(value: UserPreferences): void {
  S.localeOverride = value.localeOverride;
  S.sound = value.sound;
  S.numerals = value.numerals;
  S.p1Hue = value.p1Hue;
  S.p2Hue = value.p2Hue;
  S.colorblind = value.colorblind;
  S.reducedMotion = value.reducedMotion;
}

/* Reproduce the old race deterministically: hydration is held after its
   remote read starts, then a tap captures and queues a write. The stale read
   may neither repaint the tap nor become the value written afterward. */
state({ ...valid, sound: true });
const remoteGate = deferred<UserPreferences | null>();
const readStarted = deferred<void>();
const writes: Array<Readonly<UserPreferences>> = [];
const applied: UserPreferences[] = [];
const sync = createAccountPreferenceSync({
  currentUser: async () => ({ id: 'player-1' }),
  readLocal: userPreferences,
  currentRevision: userPreferencesRevision,
  seed: async () => true,
  load: async () => { readStarted.resolve(); return remoteGate.promise; },
  write: async (_userId, value) => { writes.push(value); },
  apply: (value) => { applied.push(value); state(value); },
});
const hydration = sync.sync();
await readStarted.promise;
S.sound = false;
const tapped = captureUserPreferences();
assert.ok(Object.isFrozen(tapped) && Object.isFrozen(tapped.value));
const saved = sync.save(tapped);
remoteGate.resolve({ ...valid, sound: true, localeOverride: 'fr' });
await Promise.all([hydration, saved]);
assert.equal(S.sound, false);
assert.equal(applied.length, 0);
assert.deepEqual(writes, [tapped.value]);

/* Multiple taps retain invocation order and the last complete snapshot wins,
   even though both writes waited behind the same hydration. */
state({ ...valid, sound: true });
const secondRemoteGate = deferred<UserPreferences | null>();
const secondReadStarted = deferred<void>();
const orderedWrites: Array<Readonly<UserPreferences>> = [];
let staleApplies = 0;
const ordered = createAccountPreferenceSync({
  currentUser: async () => ({ id: 'player-1' }),
  readLocal: userPreferences,
  currentRevision: userPreferencesRevision,
  seed: async () => true,
  load: async () => { secondReadStarted.resolve(); return secondRemoteGate.promise; },
  write: async (_userId, value) => { orderedWrites.push(value); },
  apply: () => { staleApplies++; },
});
const orderedHydration = ordered.sync();
await secondReadStarted.promise;
S.sound = false;
const firstTap = captureUserPreferences();
const firstSave = ordered.save(firstTap);
S.sound = true;
const secondTap = captureUserPreferences();
const secondSave = ordered.save(secondTap);
secondRemoteGate.resolve({ ...valid, sound: false });
await Promise.all([orderedHydration, firstSave, secondSave]);
assert.equal(staleApplies, 0);
assert.deepEqual(orderedWrites.map((value) => value.sound), [false, true]);
assert.deepEqual(orderedWrites.at(-1), secondTap.value,
  'the final write was not the complete latest preference snapshot');
assert.equal(S.sound, true);

/* Boot captures its untouched revision before the lazy online chunk resolves.
   A tap made while that import is still pending is already newer when the
   remote fetch begins, so it must receive the same protection as a tap made
   during the fetch itself. */
state({ ...valid, sound: true });
const bootRevision = userPreferencesRevision();
S.sound = false;
captureUserPreferences();
let prefetchApply = 0;
const delayedModuleStart = createAccountPreferenceSync({
  currentUser: async () => ({ id: 'player-1' }),
  readLocal: userPreferences,
  currentRevision: userPreferencesRevision,
  seed: async () => true,
  load: async () => ({ ...valid, sound: true, localeOverride: 'fr' }),
  write: async () => undefined,
  apply: () => { prefetchApply++; },
});
await delayedModuleStart.sync(bootRevision);
assert.equal(prefetchApply, 0,
  'a tap made before the lazy hydration module started was overwritten by remote state');
assert.equal(S.sound, false);

/* With no intervening mutation, an established account's remote row still
   wins. With no row, the first device seeds and re-applies its local value. */
const remoteApplied: UserPreferences[] = [];
const ordinaryRemote = { ...valid, localeOverride: 'fr' as const, sound: true };
const ordinary = createAccountPreferenceSync({
  currentUser: async () => ({ id: 'player-1' }),
  readLocal: userPreferences,
  currentRevision: userPreferencesRevision,
  seed: async () => true,
  load: async () => ordinaryRemote,
  write: async () => undefined,
  apply: (value) => { remoteApplied.push(value); },
});
await ordinary.sync();
assert.deepEqual(remoteApplied, [ordinaryRemote]);

/* A completed A read may not repaint after auth storage changes to B while
   hydration is still resolving. */
let preferenceAccount = 'player-a';
let crossAccountApplies = 0;
const switchedAccount = createAccountPreferenceSync({
  currentUser: async () => ({ id: preferenceAccount }),
  readLocal: userPreferences,
  currentRevision: userPreferencesRevision,
  seed: async () => true,
  load: async () => {
    preferenceAccount = 'player-b';
    return ordinaryRemote;
  },
  write: async () => undefined,
  apply: () => { crossAccountApplies++; },
});
await switchedAccount.sync();
assert.equal(crossAccountApplies, 0,
  'account A preferences painted after the active session changed to B');

state({ ...valid, localeOverride: 'de', sound: true });
let initialized: Readonly<UserPreferences> | null = null;
// Reading through a function restores the declared type: the assignment in
// the seed fake below is invisible to control-flow narrowing.
const seededPreferences = (): Readonly<UserPreferences> | null => initialized;
const firstDevice = createAccountPreferenceSync({
  currentUser: async () => ({ id: 'player-2' }),
  readLocal: userPreferences,
  currentRevision: userPreferencesRevision,
  seed: async (_userId, value) => { initialized ??= value; return true; },
  load: async () => initialized as UserPreferences | null,
  write: async () => undefined,
  apply: state,
});
await firstDevice.sync();
assert.equal(seededPreferences()?.localeOverride, 'de');
assert.equal(S.localeOverride, 'de');

/* Signed-out Settings stay fully functional locally, but neither hydration nor
   a captured tap may attempt a remote seed/write without an account. */
let signedOutRemoteCalls = 0;
const signedOut = createAccountPreferenceSync({
  currentUser: async () => null,
  readLocal: userPreferences,
  currentRevision: userPreferencesRevision,
  seed: async () => { signedOutRemoteCalls++; return true; },
  load: async () => { signedOutRemoteCalls++; return null; },
  write: async () => { signedOutRemoteCalls++; },
  apply: () => { signedOutRemoteCalls++; },
});
await signedOut.sync();
await signedOut.save(captureUserPreferences());
assert.equal(signedOutRemoteCalls, 0);

/* EVERY DUEL HUE IS AN AVATAR HUE. The two lists were written out separately,
   so BLUE — added to the duel palette on 2026-08-22 — never reached the avatar
   picker and a player simply could not choose it (reported from a device
   2026-08-30). Derived now; this is what stops them parting again, and it fails
   on the NEXT hue too, not just on blue. Since 2026-09-02 the avatar's hue is
   "your colour" from Settings, so the name that announces it is the Settings
   swatch label (settings:hues), checked by the picker's own tests. */
for (const id of HUE_IDS) {
  assert.equal(AV_HUES[id], `var(--${id})`,
    `the avatar palette does not carry the duel hue "${id}"`);
}
assert.equal(Object.keys(AV_HUES).length, HUE_IDS.length,
  'the avatar palette carries a hue the duel registry does not have');

console.log(JSON.stringify({ problems: [] }));
