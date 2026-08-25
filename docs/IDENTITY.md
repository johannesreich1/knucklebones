# Identity: the ladder

*Written 2026-08-19, when guest accounts shipped.*

A player's account lives on the server until they delete it — a row in
`auth.users`, a profile, a nickname, and ladder points. Moving between identity
rungs never replaces that row. The only question this system answers is **how
the app proves that row is theirs**, and there are three rungs:

| Rung | The proof is… | Survives reinstall? | Costs the player |
|---|---|---|---|
| **Guest** | a token in this device's storage | **no** | nothing — it is silent |
| **Attached** (email / Apple) | an identity someone else vouches for | yes | one tap, or an email + password |
| **Game Center** | Apple vouching automatically | yes | nothing at all |

Everything below the "guest" line is the same code path for every rung: the
profile trigger, the RLS policies, matchmaking and ladder policy never learn which rung a
player is standing on. That is why guests cost no schema — an anonymous user
takes the `authenticated` role and has a normal `auth.uid()`.

## Where it lives

| Piece | File |
|---|---|
| The rungs, and what each can do | `src/online/session.ts` (guest + email) and `src/online/identity.ts` (one-tap providers) |
| The one modal sheet that serves attach *and* restore | `AUTH` in `src/online/auth-screen.ts` over the shared `src/ui/sheet.ts` |
| Game Center → a session | `supabase/functions/gc-auth/` (`verify.ts` is the pure crypto) |
| The native bridges | `@capawesome/capacitor-apple-sign-in` plus `native/plugins/gamecenter/` |
| Tests | `tests/apple-identity.test.ts`, `tests/browser/online-ui/run.mjs`, and `tests/gcauth.test.ts` |

A new provider is a registry entry in `identity.ts` with `available()`,
`restore()` and `attach()`. The panel renders whatever is available and never
learns a provider's name; the web build finds none.

Attach and restore repaint one stable form inside the shared modal sheet, so
switching steps or opening the nested Privacy page does not clear the email or
password fields. Dismissing a sheet opened from a guest profile returns to that
profile; initial sessionless fallback, sign-out, and deletion return Home. The
Privacy door uses the legal publication gate and therefore remains absent while
the checked-in notice still has release-blocking facts. On success the sheet
retires before profile loading begins: Profile-origin restore refreshes Profile,
while Home-origin auth continues the destination the player originally
requested. Back cancels that pending destination rather than allowing it to
route later under Home.

## State, and what is left

**Rung 1 — guest: LIVE.** Verified against production on 2026-08-19: a guest
joined ranked and matched a bot with no email anywhere.

**Rung 2 — Apple: core attach/restore path implemented; release work resumed.**
On 2026-08-25 the owner confirmed the paid Developer Program membership is
active, Sign in with Apple and Game Center are enabled on the existing App ID,
the App Store Connect record exists, and repository entitlement wiring is
authorized. Device, provisioning, Supabase, and deletion-revocation acceptance
remain open. iOS uses native AuthenticationServices. Android initializes the same bridge
with Services ID `com.appavaria.knucklebones.web` and uses its HTTPS WebView
flow. Every attempt creates a raw nonce and state; Apple receives
`SHA-256(rawNonce)`, Supabase receives the raw nonce, and Android results must
return an exact state match before any Supabase call. Restore uses
`signInWithIdToken`; attach uses typed `linkIdentity` when a session exists and
falls back to `signInWithIdToken` only for sessionless account creation. A link
conflict never replaces the current guest. Client-decoded Apple claims are not
trusted.

Before this rung can ship, replace the current text-only Apple action with an
Apple-compliant button and complete deletion-time Apple token revocation. The
plugin returns an authorization code, but the current client discards it and
`account-delete` removes only the Supabase account. Code exchange and revocation
must happen server-side with an owner-held Apple `.p8` key; no Apple secret may
enter the app bundle.

**Rung 3 — Game Center: code complete, deliberately NOT deployed.** The
signature verification is tested against Apple's real production certificates,
but nothing has run on a device. The Edge Function, migration 0014, and its
`20260823132611_game_center_service_grants.sql` companion stay un-deployed
until a signed build can exercise them — an auth endpoint that has never
answered a real request does not belong in production.

### Apple owner/release checklist

Work resumed on 2026-08-25. Checked items below are owner-confirmed portal state
or repository state; they do not imply that a provisioning profile, signed
archive, device authentication, or production backend rollout succeeded.

- [x] **Anonymous sign-ins → ON** — done 2026-08-19.
- [ ] **Confirm email → OFF**, or configure SMTP. Until then "Keep it forever"
      can only get as far as *"confirm the link we sent"* — and no link is sent.
      Guest play is unaffected.
- [x] **Paid Apple Developer Program membership** for team `4RKFC79X48` — owner
      confirmed active 2026-08-25.
- [x] **Apple App ID capabilities:** Sign in with Apple is enabled and configured
      as Primary App ID; Game Center is enabled on
      `com.appavaria.knucklebones` — owner confirmed 2026-08-25.
- [x] **App Store Connect record:** **Knucklebones Neon**, Apple app id
      `6804966098`, SKU `knucklebones-ios-001`, bundle id
      `com.appavaria.knucklebones`. The native app bundle deliberately keeps
      `CFBundleDisplayName` as **Knucklebones** for the Home Screen. The record
      exists, but store-name/trademark clearance remains open.
- [x] **Repository entitlements:** `App.entitlements` is wired into the App
      target's Debug and Release configurations and requests both confirmed
      capabilities. The iOS shell contract rejects partial or stale wiring.
- [ ] **Provisioning and signed acceptance:** let automatic signing regenerate
      or select profiles containing both capabilities, then prove a signed
      physical-device build and Release archive contain both entitlements.
- [ ] **Apple Services ID:** create `com.appavaria.knucklebones.web`, associate
      it with that App ID, and register website domain
      `euzjcejbkxvqfrttgaxu.supabase.co` with return URL
      `https://euzjcejbkxvqfrttgaxu.supabase.co/auth/v1/callback`.
- [ ] **Supabase Apple provider → ON:** list
      `com.appavaria.knucklebones.web` first and
      `com.appavaria.knucklebones` second under Client IDs.
- [ ] **Supabase Manual Linking → ON** (Authentication → Sign In / Providers),
      so a guest can attach Apple without losing its existing user and rating.

This client sends Apple's ID token directly to Supabase
`signInWithIdToken`/`linkIdentity`; it does not use Supabase's Apple OAuth code
exchange. Do not create or configure an Apple OAuth client secret for this
sign-in/linking flow. That is separate from deletion-time Apple token
revocation, which does require a server-side Apple client secret and remains
deferred. None of the unchecked items above is implied complete by repository
tests.

### Android/Play owner release

This signing/upload rehearsal was explicitly deferred on 2026-08-24. Keep the
guardrails below as the resumption checklist; no unsigned CI artifact may be
uploaded in its place.

- [ ] Install Android Studio Otter or newer, JDK 21, and Android SDK 36 before
      local device testing or signed bundling.
- [ ] Create the Play listing under unchanged package id
      `com.appavaria.knucklebones` and set the listing name to
      **Knucklebones Neon**.
- [ ] Enroll in Play App Signing, keep a distinct owner-held upload key, and
      configure only the ignored `native/android/keystore.properties` locally.
- [ ] Run `mise exec -- npm run native:bundle:android` and manually upload its
      signed AAB.
      Do not add Play API credentials or automated publishing to CI.

Apple requires an App Store app using Sign in with Apple before the associated
service can be offered on other platforms. Android Apple sign-in is therefore
release-blocked until the associated iOS app is live; a locally successful
WebView does not remove that requirement. Using **Knucklebones Neon** for the
store listing while the installed label remains **Knucklebones** also does not
resolve store-name legal/trademark clearance.

### Then, in the repo

```bash
mise exec -- npm --prefix native ci
mise exec -- npm run native:verify:ios
mise exec -- npm run native:verify:android
# or: mise exec -- npm run native:verify
```

The native package installs `plugins/gamecenter` through its tracked local
`knucklebones-game-center` dependency. Sync registers that Swift bridge and the
Capawesome Apple plugin; verification fails unless the platform manifests,
plugins, assets, ids, versions, and synced web bytes agree. The Apple button
appears in native builds only because `available()` looks for the global
Capacitor bridge; web code imports no native plugin.

Game Center remains one held owner rollout, in this order:

1. apply pending migration `0014_game_center_ids.sql`;
2. immediately apply `20260823132611_game_center_service_grants.sql`, which
   narrows that table to the service-role reads/inserts the function needs;
3. configure a durable gateway/deployment-layer rate limit for `gc-auth` — its
   Apple assertion is the authentication boundary, so Supabase JWT verification
   is deliberately off;
4. deploy `gc-auth`, then exercise attach and restore with a signed device.

Hold the whole sequence until the device and rate-limit prerequisite exist.
Repository tests do not mean any of these production actions happened.

## Housekeeping this creates

Supabase does not clean up anonymous users, so guests accumulate. Ones that
never played are pure noise:

```sql
delete from auth.users u
where u.is_anonymous is true
  and u.created_at < now() - interval '30 days'
  and not exists (select 1 from public.matches m where m.p1 = u.id or m.p2 = u.id);
```

Guests **with** matches are real players with real ratings — deleting those
would silently vandalise the ladder. The rate limit on anonymous sign-ins is 30
per hour per IP; if that is ever not enough, Turnstile on that one call is the
lever, not a signup wall.
