# Project status

*Current as of 2026-08-30. Keep this page short: current state, unresolved
decisions, and externally owned actions only. Detailed sprint history lives in
[`docs/history/2026-08-sprint.md`](history/2026-08-sprint.md).*

## Current state

| Area | State | Authoritative source |
|---|---|---|
| Web | Live at <https://knucklebones-asg.pages.dev>; pushes to `main` still deploy through the Cloudflare Pages dashboard build immediately, ahead of CI. The gated `deploy` job is merged but skipped until `DEPLOY_VIA_ACTIONS` is set | `build.mjs`, `.github/workflows/ci.yml` |
| Game | Local solo and two-player play, tutorial, modes, optional offline spells, and shared local/ranked board rendering | `src/core/`, `src/flow/`, `src/ui/` |
| Ranked | Production has server-authoritative play, matchmaking/bot backfill, ladder, history, profiles, deletion, permanent mode-pool progression, IVORY Rune Trial, authoritative casts, rune collection, and an equipped seat. The selected ordinary-ranked contract snapshots each participant's equipped rune from SILVER; a missing seat remains rune-free, while Rune Trial ignores equipment. The disposable test population has 200 bots spanning the ladder with deliberately beatable 41–54% aggregate win rates, streaks 2–7, and modest varied peaks; real play then updates the ordinary aggregates. Bots carry rune winnings and equipped seats scaled by standing and record — see `docs/LADDER.md` § Bot rune winnings | `src/online/`, `src/core/ranked-outcomes.ts`, `supabase/functions/`, `docs/LADDER.md` |
| Localization | English, Brazilian Portuguese, Spanish, German, French, and Italian share one ordered registry, complete catalogs, native metadata, and measured eager/online mobile geometry | `src/i18n/`, `docs/architecture/localization.md` |
| Database | Repository and production share the same canonical 57-migration timestamped prefix through `20260830155543_equipped_runes_ranked.sql`; `supabase/migration-history.json` and the migration-ledger test pin it. The former compact aliases, obsolete 12-bot seed, and two wrong-stamped equipped-rune files are preserved only in the non-executable archive. Production records Rune Trial, streak baselines, Apple/Game Center schema, command stall checks, auto-forfeit streaks, dense ladder positions, equipped-rune state, and the SILVER ordinary-ranked snapshots plus owned bot-seat backfill; guarded catalog, security, data, Realtime, and cron audits cover their owned surfaces. Ledger alignment does not establish deployed Edge Function bytes. | `supabase/migrations/`, `supabase/legacy-migrations/`, `supabase/migration-history.json` |
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
- Mechanical mode identities come from `src/core/modes.ts`; progressive ranked
  outcomes and odds come from `src/core/ranked-outcomes.ts`. Rune identity,
  legality, and charges come only from `src/core/spells.ts`.
- Ordinary ranked snapshots each participant's equipped rune from SILVER. The
  two seats are independent: below SILVER or without an equipped rune that
  participant remains rune-free. Fresh matches reveal both immutable match-row
  assignments, including NONE; rejoin is silent. These matches and Rune Trial
  use authoritative replayable aim/cast/place actions, but separate capabilities
  because Trial ignores equipment and loans its own private choices. The
  additive v1 placement protocol remains only for legacy rune-free standard
  rows.
- Ranked variety unlocks permanently from the player's historical peak:
  STONE has Classic, Single Strike, Column Shield, and Limited; BONE adds Row
  Switch, Row Multiply, and Bounty; IVORY adds Rune Trial. Demotion and season
  turnover never relock a pool. A human pairing uses the lower shared pool and
  protocol-capability intersection; a bot uses its human's pool. Classic is
  exactly 40% and eligible additions split the remaining 60% equally —
  temporarily suspended for IVORY by the Rune Trial test share below.
- Rune Trial is `format='rune_trial'` with `modifier='classic'`, not an eighth
  mechanical core mode. Both seats receive the same uniform three-of-six loan,
  choose privately, and reveal together; a 10-second deadline (owner call
  2026-08-29, `RUNE_TRIAL_PICK_SECS`, counted down on the picker) resolves a
  missing choice deterministically. Equipment is ignored and left unchanged.
  Every settled Trial win awards the winner's selected rune once; loss/draw
  awards nothing and a duplicate is not replaced. Collections start empty.
- Offline CPU setup exposes NONE plus collected runes; rune RANDOM and
  RANDOM×2 require two collected runes, and CPU Rune Trial requires three.
  The last server-confirmed collection is cached per account for offline use.
  Local two-player always exposes the full roster and every Trial/RANDOM
  variant, never grants collection rewards, and keeps separate setup
  preferences from CPU play.
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
- Confirm the ranked Edge Function closure state independently; the reconciled
  migration history establishes database identity, not deployed function bytes.
- The Apple/Game Center database migrations are recorded in the canonical
  production ledger. Keep the remaining rollout separate: deploy the
  rate-limited Cloudflare identity gateway plus the identity/revocation Edge
  Functions, configure owner-held secrets and the retry schedule, and prove
  launch restore, attach, account-change protection, deletion, and revocation
  with a signed device. None of those non-database production actions is
  recorded as complete here.
- A fully suspended mobile client can still leave a bot match waiting until it
  returns. A server-side sweep is the honest remaining solution.

### Product and release decisions

- **RELEASE BLOCKER — revert the Rune Trial test weighting before the App
  Store build (added 2026-08-28, owner decision).** `src/core/rune-trial-test-share.ts`
  gives Rune Trial 60% of every DRAW that may contain it, so the pre-game flow
  can be judged by playing rather than by seeding. It biases only the draw;
  `rankedOutcomePool` still returns the shipped 40/60 weights, so
  `tests/botbench.test.ts` keeps calibrating the bots against the real ladder.
  That bench also states the cost: at 60%, IVORY's modelled novice-with-a-rune
  human takes ~45% of outcomes, so ranked is bot-favoured while the share is
  live. **Reverting is one line: set `RUNE_TRIAL_TEST_SHARE` to `null`.** The
  draw returns to the shipped weights and `tests/ranked-outcomes.test.ts`
  follows the constant to its permanent expectations with no edit. Deleting the
  file outright is a later tidy-up and is not one line — the header of
  `rune-trial-test-share.ts` lists what else has to move. Ranked keeps the
  temporary share until the PvP functions are redeployed again without it.
- The `localization-browser` geometry matrix is manual-only since 2026-08-26
  (owner: Johannes): run
  `mise exec -- node tests/browser/localization/run.mjs` plus the manual
  visual pass for any locale, copy, or shared-layout change. The gate keeps
  `localization-smoke` (the same runner's `--smoke` mode) as a rot guard.
  Re-enable the full matrix in `tests/support/gate-manifest.mjs` once a
  screenshot-review workflow owns visual acceptance.
- Switch production onto the gated deploy (owner: Johannes). The `deploy` job in
  `.github/workflows/ci.yml` is merged but skipped, so the dashboard build still
  publishes `main` ahead of CI. In order: (1) create a Cloudflare API token with
  Pages edit rights and note the account id; (2) add repository secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and repository variable
  `DEPLOY_VIA_ACTIONS=true` — plus `CLOUDFLARE_PAGES_PROJECT` only if the Pages
  project is ever renamed away from `knucklebones` (confirmed in the dashboard
  on 2026-08-27: the project is `knucklebones`, matching `wrangler.jsonc`; only
  its hostname is `knucklebones-asg.pages.dev`); (3) push to `main` and confirm the
  `deploy / production` job publishes the live site; (4) only then disconnect the
  dashboard git build, so the two paths never both own a deploy. Steps 2 and 3
  publish each commit twice, which is harmless because both publish the same
  build. Rollback at any point is unsetting `DEPLOY_VIA_ACTIONS` and re-enabling
  the dashboard build. Not verifiable in the repository: no CI run can execute
  this job until the variable exists.
- Configure production SMTP through Resend and verify the attach-email loop.
  DNS, provider credentials, rate limits, and dashboard settings are owner
  actions.
- Resolve the product name after a real trademark review. The current app id
  is `com.appavaria.knucklebones`; `tests/iosship.test.ts` consistency-gates
  the platform copies if a rename changes it.
- The shared legal system now contains draft provider, privacy, support, and
  deletion documents in all six supported languages, plus a deterministic
  24-page static generator and isolated service-worker routes. Publication is
  fail-closed at `draft`: no public routes or Home door ship yet. By owner
  decision, Settings/auth expose the localized placeholder Imprint/Privacy
  documents in-app while the public
  support/privacy email, verified provider regions/retention/transfer facts,
  deletion verification workflow, translation and German legal review, and
  territory review remain open. The interim development policy is all ages
  with no gate; mandatory
  child/privacy and store-audience reconsideration remains a release blocker
  before App Store or Play production submission. Mainland China and Vietnam
  require game approvals and are excluded from the initial App Store scope
  until those approvals exist. See `docs/LEGAL.md`.
- Apple work resumed on 2026-08-25: the paid membership is active, Sign in with
  Apple and Game Center are enabled on `com.appavaria.knucklebones`, the App
  Store Connect record exists as Apple app `6804966098`, and both Xcode
  configurations now reference the confirmed entitlement request; automatic
  signing and a Debug build work. The editable iOS 1.0 draft now contains the
  exact owned listing copy and six screenshots for each `en-GB`, `de-DE`, and
  `fr-FR` locale on both iPhone 6.9-inch and iPad 13-inch (36 images total), and
  a post-sync read confirmed no remaining metadata, upload, deletion, or order
  change. No binary or review submission was touched. Before review, ranked
  runes must ship and every affected future-state preview must be regenerated
  from that shipping implementation; store-name clearance, localized public
  legal/support URLs, a signed archive and physical-device proof, Services ID
  and Supabase switches, deletion-time token revocation, and the remaining Game
  Center gateway/function/device rollout also remain open. Android
  signing/upload remains deferred. See `docs/IDENTITY.md` and
  `docs/architecture/build.md`.
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
  `design/screens/product/47j-limited-gutter.html`, and
  `tests/limited-bag-gauge.mjs`
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
| Locale model, translated copy, or translation layout budgets | [`architecture/localization.md`](architecture/localization.md) |
| Supabase, auth, RLS, migrations, or Edge Functions | [`architecture/backend.md`](architecture/backend.md), `supabase/DESIGN.md` |
| Build, PWA, widget, native, or deployment | [`architecture/build.md`](architecture/build.md) |
| Tests, CI, browser verification, or live probes | [`architecture/testing.md`](architecture/testing.md) |
| Legal publication facts, gate, or public routes | [`LEGAL.md`](LEGAL.md) |
| Modes, spells, ladder, or identity | [`MODES.md`](MODES.md), [`SPELLS.md`](SPELLS.md), [`LADDER.md`](LADDER.md), [`IDENTITY.md`](IDENTITY.md) |
| Why an August decision was made | [`history/2026-08-sprint.md`](history/2026-08-sprint.md) |
