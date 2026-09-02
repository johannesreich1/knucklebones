import assert from 'node:assert/strict';
import {
  DEFAULT_ICON_PAIR,
  ICON_PAIRS,
  alternateAppIconForPair,
  appIconIdForPair,
  displayedIconPair,
  iconPairFromId,
  pairIconName,
  type AlternateAppIcon,
} from '../src/app-icon-registry.ts';
import { HUE_IDS } from '../src/state.ts';
import {
  APP_ICON_COLOURS_ENABLED_KEY,
  appIconAvailable,
  appIconColoursEnabled,
  createAppIconSynchronizer,
  resetAppIcon,
  setAppIconColoursEnabled,
  syncAppIconColours,
  type AppIconBridge,
  type AppIconId,
} from '../src/native/app-icon.ts';

/* ---- the registry: every ordered pair of distinct duel hues, once ---- */
assert.equal(ICON_PAIRS.length, 42, 'the 7 × 6 colour-pair launcher set drifted');
assert.equal(new Set(ICON_PAIRS.map(pairIconName)).size, 42, 'launcher pairs are not unique');
assert.ok(ICON_PAIRS.every(({ p1, p2 }) => p1 !== p2
  && (HUE_IDS as readonly string[]).includes(p1) && (HUE_IDS as readonly string[]).includes(p2)),
'a launcher pair names a hue outside DUELHUES or repeats a hue');
assert.deepEqual(DEFAULT_ICON_PAIR, { p1: 'cy', p2: 'mg' });
assert.equal(alternateAppIconForPair(DEFAULT_ICON_PAIR), null,
  'the compiled cyan-magenta primary was exposed as an alternate');
assert.equal(appIconIdForPair(DEFAULT_ICON_PAIR), 'primary');
assert.equal(appIconIdForPair({ p1: 'green', p2: 'violet' }), 'split-green-violet');
assert.equal(ICON_PAIRS.filter((pair) => alternateAppIconForPair(pair) !== null).length, 41,
  'the primary/null mapping did not leave exactly 41 alternates');
const acceptAlternate = (icon: AlternateAppIcon): AlternateAppIcon => icon;
// @ts-expect-error cyan-magenta is the primary catalog, never a native alternate id
acceptAlternate('split-cy-mg');

/* the icon follows the pair the player SEES */
assert.deepEqual(displayedIconPair('green', 'violet', false), { p1: 'green', p2: 'violet' });
assert.deepEqual(displayedIconPair('green', 'violet', true), { p1: 'cy', p2: 'gold' },
  'colour-blind mode pins cyan-vs-gold and the launcher must follow it');
assert.deepEqual(displayedIconPair('green', 'green', false), DEFAULT_ICON_PAIR,
  'an impossible equal pair falls back to the primary rather than a missing catalog');
assert.deepEqual(displayedIconPair('nope', 'mg', false), DEFAULT_ICON_PAIR);
assert.deepEqual(iconPairFromId('primary'), DEFAULT_ICON_PAIR);
assert.deepEqual(iconPairFromId('split-gold-blue'), { p1: 'gold', p2: 'blue' });
assert.equal(iconPairFromId('split-gold-gold'), null);
assert.equal(iconPairFromId('die-5-cy'), null, 'the retired avatar-driven ids must not resolve');

/* ---- the synchronizer: serialized, latest wins, failure isolated ---- */
const unavailable = createAppIconSynchronizer(() => undefined);
assert.deepEqual(await unavailable.syncPair({ p1: 'mg', p2: 'cy' }), {
  status: 'unavailable', icon: 'split-mg-cy',
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
const sync = createAppIconSynchronizer(() => bridge);
assert.deepEqual(await sync.syncPair({ p1: 'green', p2: 'violet' }),
  { status: 'changed', icon: 'split-green-violet' });
assert.deepEqual(await sync.syncPair({ p1: 'green', p2: 'violet' }),
  { status: 'unchanged', icon: 'split-green-violet' });
const [stale, latest] = await Promise.all([sync.syncPair({ p1: 'gold', p2: 'blue' }), sync.reset()]);
assert.equal(stale.status, 'superseded', 'an older pair request must lose to the newer reset');
assert.deepEqual(latest, { status: 'changed', icon: 'primary' });
assert.equal(current, 'primary');
assert.deepEqual(changes, ['split-green-violet', 'primary'],
  'the superseded request must never reach the OS');

const broken = createAppIconSynchronizer(() => ({
  getState: async () => { throw new Error('bridge down'); },
  setIcon: async () => { throw new Error('bridge down'); },
}));
assert.deepEqual(await broken.syncPair({ p1: 'orange', p2: 'cy' }),
  { status: 'failed', icon: 'split-orange-cy' });
assert.deepEqual(await broken.reset(), { status: 'failed', icon: 'primary' },
  'a throwing bridge must not poison later requests');

const unsupported = createAppIconSynchronizer(() => ({
  getState: async () => ({ supported: false, icon: 'primary' }),
  setIcon: async ({ icon }) => ({ supported: false, icon, changed: false }),
}));
assert.deepEqual(await unsupported.syncPair({ p1: 'blue', p2: 'gold' }),
  { status: 'unavailable', icon: 'split-blue-gold' });

/* ---- the device preference: OFF by default, never read from a profile ---- */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
};
assert.equal(APP_ICON_COLOURS_ENABLED_KEY, 'knucklebones.native.app-icon-colours.enabled');
assert.equal(appIconColoursEnabled(), false, 'absence of the preference must read as OFF');
assert.equal(appIconAvailable(), false, 'without Capacitor there is no launcher bridge');
const settings = { p1Hue: 'green', p2Hue: 'violet', colorblind: false };
assert.deepEqual(await syncAppIconColours(settings),
  { status: 'disabled', icon: 'split-green-violet' },
  'a colour change while OFF must not touch the launcher');

current = 'primary';
changes.length = 0;
(globalThis as { Capacitor?: unknown }).Capacitor = { Plugins: { AppIcon: bridge } };
assert.equal(appIconAvailable(), true);
assert.deepEqual(await setAppIconColoursEnabled(true, settings),
  { status: 'changed', icon: 'split-green-violet' });
assert.equal(store.get(APP_ICON_COLOURS_ENABLED_KEY), '1');
assert.deepEqual(await syncAppIconColours({ ...settings, p1Hue: 'blue' }),
  { status: 'changed', icon: 'split-blue-violet' },
  'a new "your colour" must move the launcher while ON');
assert.deepEqual(await syncAppIconColours({ ...settings, colorblind: true }),
  { status: 'changed', icon: 'split-cy-gold' },
  'colour-blind mode must move the launcher to the pinned pair');
assert.deepEqual(await setAppIconColoursEnabled(false, settings),
  { status: 'changed', icon: 'primary' });
assert.equal(store.get(APP_ICON_COLOURS_ENABLED_KEY), undefined,
  'OFF must remove the preference rather than store a second falsy shape');
assert.deepEqual(await resetAppIcon(), { status: 'unchanged', icon: 'primary' });
assert.deepEqual(changes, ['split-green-violet', 'split-blue-violet', 'split-cy-gold', 'primary']);
delete (globalThis as { Capacitor?: unknown }).Capacitor;

console.log(JSON.stringify({ ok: true, pairs: ICON_PAIRS.length, changes }));
