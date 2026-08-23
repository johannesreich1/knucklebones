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
| The native bridge | `native/plugins/gamecenter/` |
| Tests | `tests/browser/online-ui/run.mjs` (ladder/identity UI), `tests/gcauth.test.ts` (the crypto) |

A new provider is a registry entry in `identity.ts` with `available()`,
`restore()` and `attach()`. The panel renders whatever is available and never
learns a provider's name; the web build finds none.

## State, and what is left

**Rung 1 — guest: LIVE.** Verified against production on 2026-08-19: a guest
joined ranked and matched a bot with no email anywhere.

**Rung 2 — Apple: code complete, not yet runnable.** The client path is
written; the app needs the capability before it can be exercised.

**Rung 3 — Game Center: code complete, deliberately NOT deployed.** The
signature verification is tested against Apple's real production certificates,
but nothing has run on a device. The Edge Function and migration 0014 stay
un-deployed until a signed build can exercise them — an auth endpoint that has
never answered a real request does not belong in production.

### What Johannes clicks

- [x] **Anonymous sign-ins → ON** — done 2026-08-19.
- [ ] **Manual linking → ON** (Authentication → Sign In / Providers). Needed
      before a guest can attach an identity and keep its rating.
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
- [ ] **Apple provider ON** in Supabase, with `com.appavaria.knucklebones` in
      the Client IDs list (native sign-in needs nothing else — no Services ID,
      no key).

### Then, in the repo

```bash
npm --prefix native ci
npm run native:verify
```

That registers both plugins and regenerates the Podfile. After it, the Apple
button appears in the native build only, because `available()` looks for the
Capacitor bridge that the web build does not have.

Game Center additionally needs migration 0014 applied and `gc-auth` deployed —
hold both until there is a device to test on.

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
