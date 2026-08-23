# Project status

*Current as of 2026-08-23. Keep this page short: current state, unresolved
decisions, and externally owned actions only. Detailed sprint history lives in
[`docs/history/2026-08-sprint.md`](history/2026-08-sprint.md).*

## Current state

| Area | State | Authoritative source |
|---|---|---|
| Web | Live at <https://knucklebones-asg.pages.dev>; pushes to `main` deploy through Cloudflare Pages immediately | `build.mjs`, `.github/workflows/ci.yml` |
| Game | Local solo and two-player play, tutorial, modes, optional offline spells, and shared local/ranked board rendering | `src/core/`, `src/flow/`, `src/ui/` |
| Ranked | Server-authoritative online play with guest accounts, human matchmaking, bot backfill, seasonal ladder points, history, profiles, and account deletion | `src/online/`, `supabase/functions/`, `docs/LADDER.md` |
| Database | The immutable repository ledger ends at `20260823121000_ranked_leaderboard_windows.sql`; a clean local reset and all pgTAP contracts pass | `supabase/migrations/`, `supabase/tests/` |
| Builds | Hosted PWA, standalone HTML, widget, and Capacitor web assets come from the same source build | `build.mjs`, `docs/architecture/build.md` |
| Native | The Capacitor configuration and iOS Xcode project are tracked; Android is not yet present | `native/` |
| Design | Product cards, open studies, and archived candidates are explicitly classified and recursively built from shared application CSS/renderers | `design/screens/`, `design/build.mjs` |
| Verification | `npm test` gates the application; CI also starts a fresh local Supabase stack for pgTAP and schema lint. Live PvP suites remain explicit external probes | `tests/run-all.mjs`, `.github/workflows/ci.yml`, `docs/architecture/testing.md` |

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
- Reconcile the production migration ledger, apply the five `20260823…`
  migrations in order, and deploy the five checked Edge Function closures.
  Repository-local reset, pgTAP, query-plan, handler, closure-sync, and Deno
  checks are green; production deployment remains an owner action.
- A fully suspended mobile client can still leave a bot match waiting until it
  returns. A server-side sweep is the honest remaining solution.

### Product and release decisions

- Configure production SMTP through Resend and verify the attach-email loop.
  DNS, provider credentials, rate limits, and dashboard settings are owner
  actions.
- Resolve the product name after a real trademark review. The current app id
  is `com.appavaria.knucklebones`; `tests/iosship.test.ts` consistency-gates
  the platform copies if a rename changes it.
- Complete legal text and company details before store submission.
- Add the Android wrapper only after the name/app-id decision; finish Apple
  identity and store release work alongside the existing iOS project.
- The shield/ward visual study remains open in the retained design cards.

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
