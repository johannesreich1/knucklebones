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
| The rungs, and what each can do | `src/online/identity/session.ts` (guest + email) and `src/online/identity/identity.ts` (one-tap providers) |
| The one modal sheet that serves attach *and* restore | `AUTH` in `src/online/screens/auth-specs.ts`, driven by `auth-screen.ts` over the shared `src/ui/sheet.ts` |
| Game Center → a session | `supabase/functions/gc-auth/` (`verify.ts` is the pure crypto) |
| Game Center lifecycle + proof bridge | `src/native/game-center.ts` and `native/plugins/gamecenter/` |
| Profile avatar vocabulary and account-scoped presentation | `src/profile-avatar.ts`, `src/profile-cache.ts`, and `src/online/identity/profile.ts` |
| Settings colour pair → native launcher | `src/app-icon-registry.ts`, `src/native/app-icon.ts` and `native/plugins/appicon/` |
| Public rate-limit boundary | `cloudflare/identity-gateway/` |
| Apple code exchange + deletion revocation | `supabase/functions/apple-token-register/`, `apple-revocation-retry/`, and `_shared/apple.ts` |
| The native bridges | `@capawesome/capacitor-apple-sign-in`, `native/plugins/gamecenter/`, and `native/plugins/appicon/` |
| Tests | `tests/apple-identity.test.ts`, `tests/app-icon.test.ts`, `tests/browser/online-ui/run.mjs`, and `tests/gcauth.test.ts` |

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

## Profile identity on this device

The profile avatar is presentation, not account proof. It is a die face the
player picks plus a hue that is not picked at all: since 2026-09-02 the hue is
"your colour" from Settings (cyan and gold while colour-blind mode is on), so
the avatar an opponent sees is the colour this player throws with. The server
row keeps the `die:<face>:<hue>` shape and its 42 values; the client writes
the hue on save and realigns a row whose hue drifted from Settings (a colour
changed offline, or another device wrote the row). Authentication still
depends only on the rung above.

The app icon is not profile identity. It is the split die of design study 56b:
one six-face die whose left pip column wears "your colour" and whose right
column wears the opponent's, fixed cyan-and-magenta for everyone. The
installed iOS and Android apps additionally bundle the same die in every
ordered pair of the seven duel hues (42 launchers, `src/app-icon-registry.ts`)
so that a device can opt into "App icon in my colours" in Settings. That choice
belongs to the installation: it is not profile data, is not synchronized
between devices, and is never written to Supabase. Enabling it applies the
pair the player currently sees; changing a colour or colour-blind mode while
it is on moves the launcher; disabling it restores the primary at once. Boot
performs one primary reconciliation while it is off. Sign-out, deletion and
account replacement leave the launcher alone — it is a colour setting, not
an account's. Public web/PWA/standalone/widget icons and loading screens stay
fixed, and their Settings surfaces do not expose the control.

Launcher selection is deliberately failure-isolated. An unavailable native
bridge, iOS rejection, Android component/configuration error, or delayed OEM
launcher refresh never changes a Settings write and never blocks startup. The
native coordinator serializes requests and lets only the latest revision
settle. iOS owns the confirmation alert for a real `setAlternateIconName`
change; Android can prove PackageManager alias state but cannot promise when
a launcher redraws it.

## Connection failures are not sign-out

Ranked entry keeps four identity outcomes separate: an authenticated session,
a definitively absent session, a verified Game Center account mismatch, and a
temporarily unreadable session/provider check. Only the absent or mismatched
outcomes open account restore. Airplane/offline state opens the shared
**YOU’RE OFFLINE** sheet; a transport or identity-service failure while the
device still reports online opens **CAN’T CONNECT**. Both stop matchmaking and
offer Retry without signing out, minting a guest, or clearing the last verified
account cache. The same boundary owns Home → Online, result → Next duel, and a
join request that loses connectivity after the queue has begun.

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

The profile's ACCOUNT ACCESS box (`src/online/screens/account-provider-view.ts`)
paints only what this build and device can actually perform. A row is a *driver*
when the player can act on it here — add Apple sign-in, repair its deletion
credential, link Game Center — and only a driver opens the box; a *passenger*
row reports a link that already works and never opens the box alone. Reach comes
from `availableTaps()`, the same capability list the auth sheet offers buttons
from, so the Apple row appears only where the Capacitor plugin does and the Game
Center row only once `VITE_IDENTITY_GATEWAY_URL` is set and GameKit is present.
A healthy Apple-linked account therefore sees no box at all, and no player is
told "Game Center not connected" while linking cannot succeed — iOS signing the
local player in at launch is a different fact from attaching that identity to a
Knucklebones account. `tests/apple-identity.test.ts` decides the whole matrix
without a device; `tests/browser/online-ui/scenarios/account-access.mjs` reads
the painted rows. The Game Center row carries its own connect control
(`src/online/screens/account-game-center-link.ts`), so it appears already
answerable the moment the gateway origin makes linking reachable.

**Rung 3 — Game Center: turned on; deploying.** The signature verification is
tested against Apple's real production certificates, and as of 2026-08-27 the
owner has lifted the hold: `20260826153100_game_center_ids.sql` and
`20260826153101_game_center_service_grants.sql` are applied, and the identity
gateway is deployed with a probe-verified origin allow-list. What remains is
the `gc-auth` deploy itself and the signed-device pass that accepts it — in
that order, because a device can only exercise a *deployed* function. See
[the Game Center rollout](#the-game-center-rollout). Native authentication
is initialized once at launch and published as state; online restore consumes
that state without installing a second `authenticateHandler`. Only the stable
`teamPlayerID` is accepted. A linked session is reasserted before each new duel;
an Apple Game Center account change fails closed and returns to account restore.

### Apple owner/release checklist

Work resumed on 2026-08-25. Checked items below are owner-confirmed portal state
or repository state; they do not imply that a provisioning profile, signed
archive, device authentication, or production backend rollout succeeded.

- [x] **Anonymous sign-ins → ON** — done 2026-08-19.
- [ ] **GO-LIVE BLOCKER — production SMTP:** configure Supabase Auth mail
      delivery through the owner-purchased IONOS Mail Basic 5 service for
      `knucklebones.gg`, including DNS/sender identity,
      credentials, rate limits, and the intended confirmation setting. Verify
      attach-email, confirmation, and recovery end to end. Until then "Keep it
      forever" cannot reliably deliver confirmation to the public: Supabase's
      default sender is restricted to project-team addresses. The September 5
      read-only audit confirmed no custom SMTP or send-email hook; see
      `docs/LEGAL.md`. Guest play is unaffected, but the account rollout must not ship.
- [x] **Auth sender mailbox created:** Johannes confirmed
      `noreply@knucklebones.gg` at IONOS on 2026-09-05. Supabase SMTP activation
      and auth-message delivery are separate, still-unverified steps. The public
      contact address selected for the legal pages is `support@knucklebones.gg`.
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

The native package installs `plugins/gamecenter` and `plugins/appicon` through
its tracked local `knucklebones-game-center` and `knucklebones-app-icon`
dependencies. Sync registers those native bridges and the Capawesome Apple
plugin; verification fails unless the platform manifests, plugins, profile-icon
provenance/assets, ids, versions, and synced web bytes agree. The Apple button
appears in native builds only because `available()` looks for the global
Capacitor bridge; web code imports no native plugin.

### The Game Center rollout

**The hold is lifted.** The owner turned Game Center sign-in on, and the three
prerequisites that blocked it were verified in production on 2026-08-27:

| Prerequisite | Verified state |
|---|---|
| Apple/Game Center migrations | **applied** — `20260826153100_game_center_ids.sql`, `20260826153101_game_center_service_grants.sql`, `20260826153102_apple_identity_credentials.sql`, `20260826181000_apple_revocation_unstage.sql` |
| `cloudflare/identity-gateway` | **deployed** at `https://knucklebones-identity-gateway.reichjoh.workers.dev`, with all four secrets/bindings configured: the rate-limit binding, the upstream URL, the upstream publishable key, and the shared `GC_AUTH_ORIGIN_SECRET` also set on `gc-auth` |
| Gateway origin allow-list | **corrected and probe-verified** — see below |

The allow-list is now this exact value:

```text
ALLOWED_ORIGINS=https://knucklebones-asg.pages.dev,https://localhost
```

and a live `OPTIONS` probe against the deployed Worker answered:

| `Origin:` sent | Response |
|---|---|
| `https://knucklebones-asg.pages.dev` | 200 |
| `https://localhost` | 200 |
| `capacitor://localhost` | **403** |
| anything else | **403** |

The third row is the point. The native entry is **derived, not chosen**:
Capacitor serves the WebView from `<scheme>://localhost`, where the scheme is
`server.iosScheme` / `server.androidScheme` in `native/capacitor.config.json`;
both are `https` here, so the shipped app's origin is `https://localhost` and
**not** `capacitor://localhost` — that is only iOS's default while `iosScheme`
is unset, and this repository overrides it. The Worker matches the `Origin`
header as an exact string, so allow-listing the wrong one is a silent 403
`origin-not-allowed` on every Game Center exchange from the shipped app while
the web build keeps working. Flip either scheme and this allow-list must move
with it. `tests/identity-gateway-origins.test.ts` pins that derivation against
this list and `cloudflare/identity-gateway/README.md`; no repository test can
read the deployed Worker, so the dashboard value is applied by hand and
re-probed as above.

`VITE_IDENTITY_GATEWAY_URL` must be set to that Worker origin where each
surface is *built* — the Cloudflare Pages project's environment variables for
web, the GitHub Actions build, and the shell that runs `npm run build` before
`native:sync:ios` / `native:sync:android` for an archive. An empty value leaves
`src/config.ts` posting to a relative `/v1/game-center` and simply never offers
the Game Center row.

#### Remaining steps, in this order

1. **Identity set.** Preview
   `mise exec -- npm run functions:production:identity`, then apply it with
   `KB_ALLOW_PRODUCTION_IDENTITY_FUNCTIONS=1 … -- --apply`. It deploys
   `identity-status`, `apple-token-register` and `apple-revocation-retry`. The
   updated `account-delete` is **not** in that set — it belongs to the ranked
   plan and ships through `functions:production:ranked-runes`. Keep
   `apple-revocation-retry` scheduled with its cron secret. The September 5
   read-only audit confirmed the active schedule; successful scheduling alone
   does not establish successful Apple revocation (see `docs/LEGAL.md`).
2. **The auth boundary, alone.** Preview
   `mise exec -- npm run functions:production:game-center`, then apply it with
   `KB_ALLOW_PRODUCTION_GAME_CENTER_FUNCTIONS=1 … -- --apply`. That plan
   contains `gc-auth` and nothing else, on its own opt-in and its own database
   gate (the `game_center_ids` mapping plus its service grants), because
   `gc-auth` answers unauthenticated requests — `verify_jwt = false` — and a
   bad deploy of it is an open door rather than a degraded feature. The rollout
   deploys it, re-reads its row as `ACTIVE` with that exact posture, then
   downloads the deployed closure and byte-compares it against what was
   uploaded.
3. **Acceptance, immediately after step 2.** On a signed physical device,
   exercise launch restore, attach, account switching, Apple repair, deletion
   and revocation through the gateway. This pass is the *acceptance* step for
   `gc-auth`, not a precondition for deploying it: the device exercises the
   deployed function, so requiring the pass first is a condition no rollout
   could ever satisfy. If it fails, the fix is a corrected redeploy of the same
   single-function plan.

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
