# Knucklebones profile app icons

This local Capacitor plugin applies the signed-in profile avatar to the native
launcher. It does not choose an avatar or persist account state: the canonical
42-value registry lives in `src/profile-avatar.ts`, and `src/native/app-icon.ts`
only calls this bridge after a confirmed account-scoped profile value.

## Bridge contract

The injected plugin name is `AppIcon`.

- `getState()` resolves `{ supported, icon }`.
- `setIcon({ icon })` resolves `{ supported, icon, changed }`.
- `icon` is `primary` for `die:5:cy`; every other accepted value is the exact
  `die-<face>-<hue>` id generated from the profile registry.
- Repeating the selected value is idempotent. Profile persistence never rolls
  back when this cosmetic side effect is unavailable or rejected.

iOS maps `primary` to `UIApplication.setAlternateIconName(nil)` and the 41
other ids to asset-catalog names. UIKit owns the confirmation alert after a
real change. Android discovers 42 `activity-alias` components through their
`knucklebones.profileIcon` metadata; API 33+ changes them atomically, while API
24–32 enables the destination before disabling the old alias. Android alias
component names are installed compatibility identifiers and must not be
renamed after release.

## Generated inputs

Run these from the repository root with Node 24:

```text
mise exec -- node tools/appicon.mjs
mise exec -- npm run native:assets:android
```

The first command refreshes the fixed web primary plus all iOS catalogs. The
second refreshes Android legacy/adaptive/themed resources and finalizes all
aliases. Both update `native/profile-app-icons.manifest.json`; the finalized
manifest records all mappings and SHA-256 asset hashes without a timestamp.
Do not edit a catalog, alias block, or density resource by hand.

The native splash, in-app loading mark, PWA, standalone page, and widget remain
the fixed cyan five because they render before profile state exists or outside
the native launcher bridge.
