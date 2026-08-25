# Project status

*Current as of 2026-08-25. Keep this page short: current state, unresolved
decisions, and externally owned actions only. Detailed sprint history lives in
[`docs/history/2026-08-sprint.md`](history/2026-08-sprint.md).*

## Current state

| Area | State | Authoritative source |
|---|---|---|
| Web | Live at <https://knucklebones-asg.pages.dev>; pushes to `main` deploy through Cloudflare Pages immediately | `build.mjs`, `.github/workflows/ci.yml` |
| Game | Local solo and two-player play, tutorial, modes, optional offline spells, and shared local/ranked board rendering | `src/core/`, `src/flow/`, `src/ui/` |
| Ranked | Server-authoritative online play with guest accounts, human matchmaking, bot backfill, seasonal ladder points, history, profiles, and account deletion | `src/online/`, `supabase/functions/`, `docs/LADDER.md` |
| Database | The repository migration directory ends at `20260824212535_match_command_retention.sql`; production records the ranked migrations through `20260823154719_matchmaking_read_grants.sql`, the player-settings base/locale rollout, and the match-command retention rollout, while Game Center remains held; a clean local reset and the focused lifecycle, command, command-retention, history-plan, grant, settlement, settings, and RLS pgTAP contracts pass locally | `supabase/migrations/`, `supabase/tests/` |
| Builds | Hosted PWA, standalone HTML, widget, and Capacitor web assets come from the same source build | `build.mjs`, `docs/architecture/build.md` |
| Native | Capacitor 8.5 iOS and Android projects are tracked; iOS supports 15+, Android installs on API 24+ while targeting API 36 | `native/`, `docs/architecture/build.md` |
| Design | Product cards, open studies, and archived candidates are explicitly classified and recursively built from shared application CSS/renderers | `design/screens/`, `design/build.mjs` |
| Verification | `mise exec -- npm test` gates the application; CI also starts a fresh local Supabase stack for pgTAP and schema lint. Live PvP suites remain explicit external probes | `tests/run-all.mjs`, `.github/workflows/ci.yml`, `docs/architecture/testing.md` |

Deployment version numbers and dashboard state are intentionally not copied
here. Confirm those in Cloudflare or Supabase when a task depends on them.

## Decisions that remain in force

- Practice is unranked. Ranked play is online and server-authoritative.
- The ladder uses non-zero-sum points starting at zero; it is not Elo. The
  formulas and rank groups live in `src/core/ladder.ts` and `docs/LADDER.md`.
- The lower-rated player opens every ranked match in every mode. Do not add a
  per-mode seating rule without a new measured decision.
- Mode odds come only from `src/core/modes.ts`. Spell identity, legality, and
  charges come only from `src/core/spells.ts`.
- Spells are offline-only until casts have a server-written, replayable online
  protocol. Ranked must continue to deal an empty spell hand meanwhile.
- Offline WARD is a one-hit scoring seal: while it is active, an all-distinct
  column adds its raw pips once after native mode scoring. A duplicate pauses
  that bonus without spending the mark; a matching hostile action or PILFER
  spends it. A full distinct COLUMN SHIELD column may be warded and loses only
  WARD—not dice or BOUNTY—when matched; a full matched shield is illegal.
  Hard applies WARD's existing `×1.5` cast threshold only after flooring its
  base demand at Normal's 16 points.
- `src/core/` is shared with Edge Functions. Replay, scoring, and search must
  stay deterministic, explicitly seeded, and free of browser dependencies.
- A shared player-visible concept has one implementation with explicit slots
  for real differences; local and online drivers may not paint private copies
  of the same game view.

## Open work and owner actions

### Security and backend correctness

- Rotate/revoke any live-test credentials that were ever committed. Repository
  live tests must remain environment-only, fail closed, and require explicit
  production opt-in. Credential rotation is an owner action.
- Reconcile the legacy local/production migration identifiers before any normal
  linked push. Production already records the eight ranked dated migrations
  through `20260823132602` plus
  `20260823154719_matchmaking_read_grants.sql`; do not reapply them or use
  `--include-all`. Confirm the four ranked Edge Function versions
  independently because migration history does not establish function state.
- Keep the Game Center rollout separate: apply pending migration
  `0014_game_center_ids.sql` and
  `20260823132611_game_center_service_grants.sql` together, configure a
  durable deployment-layer rate limit for the deliberately unauthenticated
  assertion endpoint, then deploy `gc-auth` and prove it with a signed device.
  None of those production actions is recorded as complete here.
- A fully suspended mobile client can still leave a bot match waiting until it
  returns. A server-side sweep is the honest remaining solution.

### Product and release decisions

- Configure production SMTP through Resend and verify the attach-email loop.
  DNS, provider credentials, rate limits, and dashboard settings are owner
  actions.
- Resolve the product name after a real trademark review. The current app id
  is `com.appavaria.knucklebones`; `tests/iosship.test.ts` consistency-gates
  the platform copies if a rename changes it.
- Complete and publish German, English, and French legal/privacy text before
  store submission. The natural-person name/address, Bavaria authority,
  non-commercial hobby model, and low-risk content profile are recorded; a public
  support/privacy email, verified provider retention/region facts, localized
  public pages, an external account-deletion path, and territory review remain
  open. The interim development policy is all ages with no gate; mandatory
  child/privacy and store-audience reconsideration remains a release blocker
  before App Store or Play production submission. Mainland China and Vietnam
  require game approvals and are excluded from the initial App Store scope
  until those approvals exist. See `docs/LEGAL.md`.
- Apple work resumed on 2026-08-25: the paid membership is active, Sign in with
  Apple and Game Center are enabled on `com.appavaria.knucklebones`, the App
  Store Connect record exists as Apple app `6804966098`, and both Xcode
  configurations now reference the confirmed entitlement request. Provisioning/profile
  uptake, a signed archive and physical-device proof, Services ID and Supabase
  switches, deletion-time token revocation, and the held Game Center backend
  rollout remain open. The iPhone screenshot uploader is owner-local and
  draft-gated; the universal app still needs its 13-inch iPad set before
  submission. Android signing/upload remains deferred. See `docs/IDENTITY.md`
  and `docs/architecture/build.md`.
- The first Android CI compile found an API-27 theme attribute in base API-24
  resources. It is now isolated in `values-v27` without raising minSdk, but the
  Android CI/AAB job must rerun green after these local changes are committed.
- Android system/predictive Back still has no app-level routing. Before release,
  make it close the current sheet/page, cancel matchmaking safely, ask before
  leaving an active duel, and fall through to normal OS Back only on Home.
  Repository splash/startup tests and the unsigned iOS compiler build are green;
  background/resume, OS process death, and physical safe areas remain device
  acceptance rather than laptop proof.
- W3's centre-facing runic seal is the production shield/ward treatment. Its
  closed shield, scoring clasped Ward, matching-action/PILFER break contract,
  and layered COLUMN SHIELD answer are recorded in
  `design/screens/product/39c-guard-seal.html` and `docs/SPELLS.md`.
- RC4's turn-owned charge stack is now the production rune rail. The retained
  29a–29f studies record the alternatives; `docs/SPELLS.md` owns the selected
  face-down hand, deal-away cast, FATE stack, and empty-outline contract.
- BO2's struck coin is now BOUNTY's production grid-kill signature: every real
  victim receives a centred `✦` coin on the exact 1584ms active clock recorded
  in `docs/MODES.md`; the study's score/nameplate treatment is explicitly not
  part of that decision. LI10's gutter is now LIMITED's production
  supply gauge: a 2px achromatic column at the pile's left edge whose length is
  `n/24`, plus a draw that always lifts the shell that was on top. The
  contract lives in `docs/MODES.md §9` and
  `design/screens/product/47j-limited-gutter.html`, and `tests/test24.mjs`
  measures both. 47a–47l retain the rival proposals — including 47g/47h, which
  combine LI1's draw with LI4's endgame escalation under the constraint that
  **no text may change**, and 47i/47k/47l, each of which was proposed, refuted
  and rebuilt from its own refutation. Whether any of them still earns a place
  beside the gutter is open. NUDGE and FATE are resolved: NU1's pip-only
  tick (including 6→1) and FA4's contained simultaneous pass are production,
  with the alternatives retained in 48a–48f and 49a–49f. Their contracts live in
  `design/screens/product/27b-spell-effects.html` and `docs/SPELLS.md`.

## Documentation map

| Task | Read |
|---|---|
| Frontend flow or module boundaries | [`architecture/frontend.md`](architecture/frontend.md) |
| CSS, responsive layout, or widget isolation | [`architecture/styles.md`](architecture/styles.md) |
| Supabase, auth, RLS, migrations, or Edge Functions | [`architecture/backend.md`](architecture/backend.md), `supabase/DESIGN.md` |
| Build, PWA, widget, native, or deployment | [`architecture/build.md`](architecture/build.md) |
| Tests, CI, browser verification, or live probes | [`architecture/testing.md`](architecture/testing.md) |
| Modes, spells, ladder, or identity | [`MODES.md`](MODES.md), [`SPELLS.md`](SPELLS.md), [`LADDER.md`](LADDER.md), [`IDENTITY.md`](IDENTITY.md) |
| Why an August decision was made | [`history/2026-08-sprint.md`](history/2026-08-sprint.md) |
