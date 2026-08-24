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
| The one panel that serves attach *and* restore | `AUTH` in `src/online/auth-screen.ts` |
| Game Center → a session | `supabase/functions/gc-auth/` (`verify.ts` is the pure crypto) |
| The native bridges | `@capawesome/capacitor-apple-sign-in` plus `native/plugins/gamecenter/` |
| Tests | `tests/apple-identity.test.ts`, `tests/browser/online-ui/run.mjs`, and `tests/gcauth.test.ts` |

A new provider is a registry entry in `identity.ts` with `available()`,
`restore()` and `attach()`. The panel renders whatever is available and never
learns a provider's name; the web build finds none.

## State, and what is left

**Rung 1 — guest: LIVE.** Verified against production on 2026-08-19: a guest
joined ranked and matched a bot with no email anywhere.

**Rung 2 — Apple: repository-complete, dashboard/device acceptance pending.**
iOS uses native AuthenticationServices. Android initializes the same bridge
with Services ID `com.appavaria.knucklebones.web` and uses its HTTPS WebView
flow. Every attempt creates a raw nonce and state; Apple receives
`SHA-256(rawNonce)`, Supabase receives the raw nonce, and Android results must
return an exact state match before any Supabase call. Restore uses
`signInWithIdToken`; attach uses typed `linkIdentity` when a session exists and
falls back to `signInWithIdToken` only for sessionless account creation. A link
conflict never replaces the current guest. Client-decoded Apple claims are not
trusted.

**Rung 3 — Game Center: code complete, deliberately NOT deployed.** The
signature verification is tested against Apple's real production certificates,
but nothing has run on a device. The Edge Function, migration 0014, and its
`20260823132611_game_center_service_grants.sql` companion stay un-deployed
until a signed build can exercise them — an auth endpoint that has never
answered a real request does not belong in production.

### What Johannes clicks

- [x] **Anonymous sign-ins → ON** — done 2026-08-19.
- [ ] **Confirm email → OFF**, or configure SMTP. Until then "Keep it forever"
      can only get as far as *"confirm the link we sent"* — and no link is sent.
      Guest play is unaffected.
- [ ] **A paid Apple Developer Program membership**, if `4RKFC79X48` is not one
      already. Sign in with Apple and Game Center are both paid-only
      capabilities; a free personal team cannot sign `App.entitlements`.

      `App.entitlements` exists but is **deliberately not wired** — the Xcode
      project has no `CODE_SIGN_ENTITLEMENTS` setting. It was wired on
      2026-08-19 and immediately unwired: Xcode cannot create a development
      provisioning profile for capabilities the App ID lacks, so the local
      build failed outright with *"Cannot create a iOS App Development
      provisioning profile"*. A capability that cannot be signed is not a
      harmless placeholder — it stops the app compiling. Wire it back (both
      build configurations) only AFTER the portal has the capabilities.
- [ ] **Apple App ID:** enable Sign in with Apple for the existing
      `com.appavaria.knucklebones` App ID.
- [ ] **Apple Services ID:** create `com.appavaria.knucklebones.web`, associate
      it with that App ID, and register website domain
      `euzjcejbkxvqfrttgaxu.supabase.co` with return URL
      `https://euzjcejbkxvqfrttgaxu.supabase.co/auth/v1/callback`.
- [ ] **Provisioning, then entitlements:** regenerate/confirm provisioning for
      the App ID capability first. Only then wire the prepared
      `App.entitlements` into both Xcode build configurations.
- [ ] **Supabase Apple provider → ON:** list
      `com.appavaria.knucklebones.web` first and
      `com.appavaria.knucklebones` second under Client IDs.
- [ ] **Supabase Manual Linking → ON** (Authentication → Sign In / Providers),
      so a guest can attach Apple without losing its existing user and rating.

This client sends Apple's ID token directly to Supabase
`signInWithIdToken`/`linkIdentity`; it does not use Supabase's Apple OAuth code
exchange. Do not create or configure an Apple OAuth client secret for this
flow. None of the unchecked items above is implied complete by repository
tests.

### Android/Play owner release

- [ ] Install Android Studio Otter or newer, JDK 21, and Android SDK 36 before
      local device testing or signed bundling.
- [ ] Create the Play listing under unchanged package id
      `com.appavaria.knucklebones` and set the listing name to
      **Knucklebones Neon**.
- [ ] Enroll in Play App Signing, keep a distinct owner-held upload key, and
      configure only the ignored `native/android/keystore.properties` locally.
- [ ] Run `npm run native:bundle:android` and manually upload its signed AAB.
      Do not add Play API credentials or automated publishing to CI.

Apple requires an App Store app using Sign in with Apple before the associated
service can be offered on other platforms. Android Apple sign-in is therefore
release-blocked until the associated iOS app is live; a locally successful
WebView does not remove that requirement. The **Knucklebones Neon** shell rename
also does not resolve store-name legal/trademark clearance.

### Then, in the repo

```bash
npm --prefix native ci
npm run native:verify:ios
npm run native:verify:android
# or: npm run native:verify
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
