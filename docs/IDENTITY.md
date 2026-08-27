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
| Game Center lifecycle + proof bridge | `src/native/game-center.ts` and `native/plugins/gamecenter/` |
| Public rate-limit boundary | `cloudflare/identity-gateway/` |
| Apple code exchange + deletion revocation | `supabase/functions/apple-token-register/`, `apple-revocation-retry/`, and `_shared/apple.ts` |
| The native bridges | `@capawesome/capacitor-apple-sign-in` plus `native/plugins/gamecenter/` |
| Tests | `tests/apple-identity.test.ts`, `tests/browser/online-ui/run.mjs`, and `tests/gcauth.test.ts` |

A new provider is a registry entry in `identity.ts` with `available()`,
`restore()` and `attach()`. The panel renders whatever is available and never
learns a provider's name; the web build finds none.

Attach and restore repaint one stable form inside the shared modal sheet, so
switching steps or opening the nested Privacy page does not clear the email or
password fields. Dismissing a sheet opened from a guest profile returns to that
profile; initial sessionless fallback, sign-out, and deletion return Home.
Privacy uses the owner-approved in-app placeholder door while public legal URLs
remain gated by `LEGAL_RELEASE.status`. On success the sheet retires before profile
loading begins: Profile-origin restore refreshes Profile, while Home-origin
auth continues the destination the player originally requested. Back cancels
that pending destination rather than allowing it to route later under Home.

## State, and what is left

**Rung 1 — guest: LIVE.** Verified against production on 2026-08-19: a guest
joined ranked and matched a bot with no email anywhere.

**Rung 2 — Apple: repository implementation complete; rollout pending.**
On 2026-08-25 the owner confirmed the paid Developer Program membership is
active, Sign in with Apple and Game Center are enabled on the existing App ID,
the App Store Connect record exists, and repository entitlement wiring is
authorized. Device, provisioning, Supabase, and deletion-revocation acceptance
remain open. This first release is deliberately iOS-only and uses native
AuthenticationServices; Android does not expose an Apple action. Every attempt
creates a raw nonce; Apple receives `SHA-256(rawNonce)` and Supabase receives
the raw nonce. Restore uses
`signInWithIdToken`; attach uses typed `linkIdentity` when a session exists and
falls back to `signInWithIdToken` only for sessionless account creation. A link
conflict never replaces the current guest. Client-decoded Apple claims are not
trusted.

After Supabase accepts the Apple proof, `apple-token-register` exchanges the
single-use authorization code server-side, verifies that Apple's signed subject
matches the Apple identity attached to the current Supabase user, and stores
only the resulting refresh token in Supabase Vault. `account-delete` stages the
credential before deleting the user, attempts revocation immediately, and
queues transient failures for the cron-secret retry worker. Terminal or missing
credentials produce localized manual-removal instructions. The owner-held
Apple `.p8` key and generated client secrets never enter the app bundle.

The client posts that code through the shared `callFunction` seam in
`src/online/api/client.ts`, never through supabase-js `functions.invoke`: its
`FunctionsClient` adds an `x-client-info` header, and any request header the
Edge CORS allow-list does not name makes the browser pass the preflight and
then drop the POST with no request, error, or log. `tests/architecture.test.ts`
forbids `functions.invoke` anywhere under `src/`, and `_shared/http.ts` now
allow-lists `x-client-info` as a second line of defence. A registration that
does not answer 2xx is reported to the player (`errors.appleRevocationSetup`)
rather than swallowed, and the profile's REPAIR APPLE ACCESS button runs the
Apple provider directly (`src/online/screens/account-apple-repair.ts`) instead
of opening the guest-upgrade sheet — the account already has Apple, so only the
credential is missing. Success re-reads `identity-status` and repaints, so the
warning clears without a reload.

**Rung 3 — Game Center: repository implementation complete, not deployed.** The
signature verification is tested against Apple's real production certificates,
but nothing has run on a device. The Edge Function and the held
`20260826153100_game_center_ids.sql` plus
`20260826153101_game_center_service_grants.sql` migrations stay un-deployed
until a signed build can exercise them — an auth endpoint that has never
answered a real request does not belong in production. Native authentication
is initialized once at launch and published as state; online restore consumes
that state without installing a second `authenticateHandler`. Only the stable
`teamPlayerID` is accepted. A linked session is reasserted before each new duel;
an Apple Game Center account change fails closed and returns to account restore.

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
- [ ] **Apple key:** create/download the owner-held Sign in with Apple `.p8`
      key and configure `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and
      `APPLE_PRIVATE_KEY` only as Edge Function secrets.
- [ ] **Supabase Apple provider → ON:** configure native client ID
      `com.appavaria.knucklebones`.
- [ ] **Supabase Manual Linking → ON** (Authentication → Sign In / Providers),
      so a guest can attach Apple without losing its existing user and rating.

This client sends Apple's ID token directly to Supabase
`signInWithIdToken`/`linkIdentity`. The separate server-side authorization-code
exchange exists solely to retain Apple's revocation credential for account
deletion. None of the unchecked items above is implied complete by repository
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

Android Apple sign-in is intentionally outside this release. Using
**Knucklebones Neon** for the store listing while the installed label remains
**Knucklebones** also does not resolve store-name legal/trademark clearance.

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

1. preview `mise exec -- npm run db:production:apple-game-center`, then apply
   the guarded `apple-game-center` allow-list with the explicit production
   opt-in. It contains `20260826153100_game_center_ids.sql`,
   `20260826153101_game_center_service_grants.sql`, and
   `20260826153102_apple_identity_credentials.sql` in that order;
2. deploy `cloudflare/identity-gateway`, configure its strict web/native origin
   allow-list, rate-limit binding, upstream URL/publishable key, and a shared
   `GC_AUTH_ORIGIN_SECRET` also set on `gc-auth`;
3. deploy `identity-status`, `apple-token-register`, `apple-revocation-retry`,
   and the updated `account-delete`, then schedule the retry function with its
   secret;
4. deploy `gc-auth`, then exercise launch restore, attach, account switching,
   Apple repair, deletion, and revocation with a signed physical device.

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
