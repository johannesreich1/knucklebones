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
| Database | The repository migration ledger currently ends at `0031_history_pages.sql`; verify the live applied set before any deployment | `supabase/migrations/` |
| Builds | Hosted PWA, standalone HTML, widget, and Capacitor web assets come from the same source build | `build.mjs`, `docs/architecture/build.md` |
| Native | The Capacitor configuration and iOS Xcode project are tracked; Android is not yet present | `native/` |
| Design | Product cards and retained studies are built from application CSS and shared UI renderers | `design/`, `design/build.mjs` |
| Verification | `npm test` is the release gate; live PvP suites are explicit, environment-driven checks rather than part of the default gate | `tests/run-all.mjs`, `docs/architecture/testing.md` |

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
- `src/core/` is shared with Edge Functions. Replay and scoring must stay
  deterministic and free of browser dependencies.
- A shared player-visible concept has one implementation with explicit slots
  for real differences; local and online drivers may not paint private copies
  of the same game view.

## Open work and owner actions

### Security and backend correctness

- Rotate/revoke any live-test credentials that were ever committed. Repository
  live tests must remain environment-only, fail closed, and require explicit
  production opt-in. Credential rotation is an owner action.
- Consolidate match settlement behind one short transactional compare-and-set
  database operation. Normal completion, resignation, stalled-bot cleanup, and
  account deletion must use the same settlement path.
- Decide the retention and opponent-payout semantics for deleting an account
  during an active match, then encode them in the shared settlement contract.
- A fully suspended mobile client can still leave a bot match waiting until it
  returns. A server-side sweep is the honest remaining solution.

### Product and release decisions

- Configure production SMTP through Resend and verify the attach-email loop.
  DNS, provider credentials, rate limits, and dashboard settings are owner
  actions.
- Resolve the product name and app identifier after a real trademark review.
  `src/config.ts` deliberately retains an invalid placeholder until then;
  native identity copies must ultimately be generated or consistency-gated.
- Complete legal text and company details before store submission.
- Add the Android wrapper only after the name/app-id decision; finish Apple
  identity and store release work alongside the existing iOS project.
- The shield/ward visual study remains open in the retained design cards.

### Architecture work

- Split eager and lazy CSS by foundations, shared components, game state, and
  screen ownership while preserving the current cascade and visual output.
- Isolate widget styles and portals beneath the application root; lazy online
  CSS must not modify offline screens.
- Reduce oversized interactive TypeScript modules, remove import cycles, and
  eliminate existing `@ts-nocheck` files through typed extraction rather than
  copying unchecked code.
- Split oversized browser suites into focused scenarios with shared support,
  keeping one release gate and the hard-earned completion-loop budgets.
- Centralize shared Edge Function HTTP and settlement code, add Deno type
  gates, and keep immutable migrations separate from any future declarative
  schema view.
- Align local and CI Node selection, make native sync explicit and fail-fast,
  and consistency-gate the unavoidable application-identity copies.

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
