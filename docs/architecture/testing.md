# Testing architecture

Read this page before changing tests, CI, browser harnesses, or release gates.

## Release gate

`mise exec -- npm test` runs `tests/run-all.mjs`. The runner builds first,
executes pure Node contracts, browser behaviour suites, design checks, and the AI benchmark,
then restores build output changed by update tests. Use it before pushing
cross-cutting or high-risk changes, changes without decisive focused coverage,
and shared build/test infrastructure changes. A well-contained, low-risk
change may instead use its focused owner and specialized gates; never push a
known failure, and report explicitly when the full gate was not run. The runner
propagates `process.execPath` to every child build, suite, and benchmark,
preserving the validated Node 24 runtime for the whole gate even on a machine
with another `node` earlier on `PATH`.

TypeScript under `tests/` and `tools/` executes through
`node --experimental-strip-types`, which erases annotations without checking
them, so the gate suite `typecheck-tests` runs the dedicated
`tsconfig.tests.json` project through the pinned compiler; the root
`tsconfig.json` continues to gate `src/` inside `build.mjs`.

Database contracts are a sibling CI gate because they require Docker and a
fresh Supabase database: `mise exec -- npm run db:start`,
`mise exec -- npm run test:db`, then schema
lint. The start helper mirrors the project without raw Edge Function sources
and starts only PostgreSQL; deployable function closures are materialized and
Deno-checked separately. Run the database sequence locally for every
migration, grant, RLS, or RPC change.

Worktree isolation does not make the local Supabase stack independent: this
project uses fixed machine-global Docker resources and ports. Serialize
`db:start`, reset, pgTAP, lint, and stop across all worktrees. Do not run a
second database gate merely because its `.gate.lock` is elsewhere.

The gate holds `.gate.lock` because build output is shared inside one working
tree. Servers use kernel-assigned ports, so independent worktrees may gate in
parallel when they do not use the database stack. Playwright harnesses must
also create their own browser context/storage and bind a kernel-assigned port;
sharing a signed-in context or fixed dev-server port defeats worktree
isolation. A complete local run schedules the measured long owners first
across four workers; use `KB_JOBS=2` under machine contention and repeat a timing
failure alone before treating it as a product regression. Start/completion
lines include per-suite elapsed time so the schedule can be rebalanced from
evidence when an owner grows.

The workflow runs on `pull_request` as well as on pushes to `main`, which is
the cheap way to verify anything whose subject is the hosted environment
itself — a CI change, or a rendering fix for Linux. Push a branch, open a PR,
and read the shards: an ubuntu-latest verdict costs no release, no native
sync, and no deploy, and the macOS gate cannot answer the question anyway.
Release once the shards are green rather than learning through `main`. And
because that gate is macOS while CI is Linux, a green local run says nothing
about the pipeline: read `gh run list --branch main` before calling it green.

Hosted CI selects four coverage-checked `--ci-shard` manifests. Each shard has
its own checkout, build output, server, and kernel-assigned ports, while using
one suite worker inside its two-core runner to avoid browser-contention flakes.
Runs share a workflow-and-ref concurrency group: a newer push or PR revision
cancels its still-running predecessor, so obsolete checks and Android artifacts
cannot finish after the current revision. Matrix `fail-fast` remains disabled
inside that current run so every shard still reports its complete inventory;
the aggregate check runs after ordinary failures but skips a cancelled run.
`tests/gate-manifest.test.ts` rejects a missing, duplicated, unknown, or
multiply assigned suite and requires the workflow matrix to match the manifest.
An independent, dependency-free manifest preflight guards matrix startup, so a
removed shard cannot also remove the only check capable of noticing it. The
four runners collectively execute the same registry as an unsharded local gate.
The Deno closure check runs alongside one shard; database and Android compiler
gates remain independent jobs.

### Hosted CI renders in a font the app actually names

The app ships no font files. `src/styles/page.css` names only OS-provided
faces, so every pixel a suite measures depends on what the host has installed.
`system-ui` is a real system face on macOS, Android and Windows; on Linux it is
whatever fontconfig ranks first, which nobody chose. A stock GitHub runner
resolves it to DejaVu Sans and the bare Playwright image to WenQuanYi Zen Hei,
so hosted CI was measuring a rendering no player will ever see and reporting
its metrics as layout defects — design cards 12-16px "too tall", a French legal
title "wrapped".

The `test_shard` job — the only CI job that renders anything — therefore
installs pinned `fonts-roboto-unhinted` and aliases the two generic families to
Roboto. Roboto is the one family in the app's own stack that is redistributable
and packaged (Apple's are not), and it is exactly what Android's `system-ui`
resolves to, so the runner measures the shipping Android rendering. Installing
the package alone changes nothing: `system-ui` precedes `Roboto` in the stack
and keeps winning, which is why the alias is the load-bearing half. The alias
is `<alias><prefer>`, not a `prepend_first` match rule, so it rewrites only the
generic names and a test asking for an explicit face still gets that face.

`tests/support/rendering-font.mjs` is the guard. `design-cards-render` and the
localization runner call it before any geometry, and on Linux they fail with
the cause by name when the stack does not bind Roboto — instead of emitting a
list of things that are 12px too tall and sending the reader off to edit card
declarations. Do not answer a font-shaped geometry failure by widening a budget
or a declared card height; that bakes a face nobody has into the source.

The spell browser keeps one no-argument run for whole-suite diagnosis and also
exposes `--only <scenario-id>` for focused iteration. The release runner uses
four coverage-validated `--shard` selections: every scenario must belong to
exactly one shard or startup fails. The `--only`/`--shard` grammar and the
shard-coverage validator live in `tests/support/browser-scenarios.mjs`; the
online-ui and hud-settings trees expose the same `--only` for focused
iteration, and any new multi-scenario tree should adopt the shared module
rather than growing a private parser. Local workers overlap those independent
browsers; CI distributes the same shard union across its coverage-checked gate
manifests, without removing or narrowing coverage. Successful selected runs
print only their scenario ids; a failure keeps the full observation report for diagnosis.
Ordinary spell scenarios also settle the opening roll synchronously after
invalidating its delayed callback. Tutorial pacing and LIMITED's real die bag
stay authentic, and dedicated lifecycle suites retain opening-animation
coverage; the spell suite therefore spends its time on the state it owns.

`pwa-update` (`tests/pwa-update.mjs`) is the sole `exclusive-final` suite. It
mutates `pwa/` through the shared server only after every pooled suite in its
checkout has completed, and the runner restores generated output afterward.
Manifest and executor contracts prove it cannot overlap a reader or be
followed by another suite.

Pure localization contracts keep the registry, exact catalog keys,
interpolation placeholders, trusted rich-copy shape, typed compact labels,
regional-tag normalization, persistence, and fallback aligned across all six
locales. `tests/i18n.test.ts`, `tests/i18n-catalog.test.ts`, and
`tests/preferences.test.ts` own those checks. The iOS shell contract derives
`CFBundleLocalizations` expectations from that same registry;
`tests/production-migrations.test.ts` and
`supabase/tests/database/player-settings.test.sql` require the six stable
database IDs and reject presentation/unsupported tags.

Rendered localization has three complementary checks. The report-only grapheme audit is
`mise exec -- node --experimental-strip-types tests/i18n-length-report.test.ts`;
it identifies copy needing review but never replaces rendered evidence. The
shared eager/mobile/widget matrix remains available through
`mise exec -- node tests/browser/localization/run.mjs`, but is temporarily
manual-only rather than part of `npm test` or hosted CI. It measures computed
geometry and hit testing, not whether a person approved the rendered images;
run it deliberately for locale, copy, or shared-layout work and complete the
manual visual pass described in the localization architecture. The gate keeps
the same runner's `--smoke` mode as the `localization-smoke` suite: one
locale (German) on one viewport, proving the server, the harness modules, and
the i18n exports this tree stands on still fit together, so the manual matrix
cannot silently rot. The smoke never replaces the manual matrix or its visual
pass. The automated gate retains
`mise exec -- node tests/browser/online-localization/run.mjs`, which uses Chromium and
stubbed Supabase routes to measure auth, profile, avatar, history, ladder,
face-off, and ranked-result surfaces. Both browser matrices derive their six
locales from the registry and cover 320 × 568, 390 × 844, 568 × 320, and
667 × 375; the eager gate also measures widget widths 320, 390, and 520, and
renders every registered mode/rune HUD combination at each widget width. It
also proves the widget screen-reader heading repaints inside its owned locale
root. The online gate additionally scrolls every action into view and measures
its effective 44 px hit region.

Legal delivery has two focused pure contracts. Run
`mise exec -- node --experimental-strip-types tests/legal.test.ts` for draft
public-route suppression, exact Settings/auth placeholder doors, ready-fact
validation, all 24 synthetic static pages, canonical and
`hreflang` metadata, and shared in-app/static document parity. Run
`mise exec -- node tests/service-worker.test.mjs` for exact root/legal cache
keys, offline isolation, and rejection of unknown-page or missing-asset HTML
fallback. `mise exec -- node tests/browser/legal.mjs` opens the real controller
through a synthetic non-shipping opener so all four documents are covered;
production draft exposes only Imprint/Privacy in Settings and Privacy in auth.
The same run browser-renders the 24 pages generated from a complete synthetic
ready fixture. Across 320 × 568, 390 × 844, 568 × 320, and 667 × 375 it covers
192 in-app/static locale-page cases, shared-renderer parity, text ranges, full
scroll reachability, a deliberately long URL, one-line compact in-app headers,
44 px navigation targets, active-overlay language repaint, background
inertness, heading focus, and close-path focus restoration.

## Test ownership

A test is discoverable by what it proves, not by a position in a numeric
sequence. Every suite is named for its subject, and the file is named for the
suite:

```text
tests/
  <subject>.test.ts   pure Node contract, run with --experimental-strip-types
  <subject>.mjs       single-subject browser suite (Playwright)
  browser/<tree>/     multi-scenario browser tree: one run.mjs, focused scenarios
  live-*.mjs          explicit external probes, never part of the default gate
  support/            server, gate manifest/lock, report, and mock helpers
  fixtures/           static inputs a contract reads
  screens/            screenshots suites write for humans (gitignored)
```

`tests/support/gate-manifest.mjs` maps each suite name to its file, and the
mapping is now an identity for every single-subject suite: `file('hud-timer')`
resolves to `tests/hud-timer.mjs`, so a suite whose file drifts from its name
is visible in the manifest as an explicit path. Only a suite that genuinely
lives elsewhere — a browser tree's `run.mjs`, a `.test.mjs` — still spells its
file out.

Grouping the flat suites further (a `core/`, `browser/`, `contracts/` split)
remains available if the root file list becomes hard to scan. It buys nothing
today, costs every path reference in the repository, and is deliberately not
scheduled.

Large browser scripts split into focused scenario modules while sharing one
browser/session runner. Do not introduce a page-object framework when a small
typed helper expresses the common action.

## Assertion policy

- Assert the fact the player can observe. For layout, visibility, stacking,
  and animation, inspect computed pixels, hit testing, or running animations;
  a matching DOM/state snapshot is insufficient.
- Pure rules and replay receive deterministic seeds and cover all registered
  modes/spells through the registry rather than copied name lists where
  possible.
- Ranked-outcome tests cover every permanent tier/capability intersection and
  exact 40/60 integer weights, strict format/modifier resolution, all 20
  three-of-six offers, independent same-rune choices, and deterministic
  participant-specific auto-picks. Trial action tests replay committed aim,
  cast, placement, FATE draw, one-cast enforcement, charm, reconnect
  projection, ANVIL timeout resolution, and a cast-terminal game.
- Collection/offline tests start from an empty account, distinguish no cache
  from a verified account snapshot, reject cross-account cache reuse, and cover
  every 0/1/2/3/6-rune setup boundary. Browser tests prove focusable per-option
  locks and their visible reasons, a non-hue lock treatment, separate
  CPU/two-player preferences, local secret pass-and-pick, restart preserving the
  current deal, durable unseen reward presentation, and the transient `TRY IT`
  return path. Pure outcome coverage owns RANDOM's Trial admission and odds;
  do not claim a browser workflow until it actually drives that workflow.
- Database Rune Trial contracts exercise grants/RLS and negative visibility,
  v1/v2 queue capability isolation, stale-claim rejection, idempotent
  selection/action retries, deadline auto-picks, atomic terminal action reward,
  duplicate versus first reward, durable acknowledgement, monotonic
  promotion/no-demotion, ANVIL reservation plus bot follow-up, and the legacy
  LIMITED constraint. Resignation, timeout, deletion, draw/loss no-reward,
  historical backfill, and full bot-Trial settlement need explicit pgTAP cases
  before this page may describe them as database-covered.
- Client idempotency coverage holds Rune Trial selection, aim, cast, and place
  input closed across a lost response plus an unchanged authoritative read,
  and proves every retry reuses the original command id until the delayed
  commit is observed or the server returns a definitive rejection.
- Mocks match the authoritative API or migration result shape. A hand-written
  mock that omits a renamed field can keep a broken client green.
- Test hooks such as `window.__kb`, `__kbOnline`, and `__kbResult` are stable
  driver surfaces. Production modules must not import a lazy feature merely to
  expose a test hook.
- Architecture gates are ratchets: no new dependency cycle, unchecked file,
  unapproved oversized authored module, CSS graph cycle, or eager/lazy leak.

Game-completion loops intentionally allow 900–1200 ticks. Destruction-heavy
random games exceeded smaller budgets on CI; do not reduce them as a speed
optimization. Speed work should remove setup duplication or share a browser,
not narrow the behavioural state space.

## Native release verification

`mise exec -- npm run test:native` runs the static iOS and Android shipping
contracts without requiring a sync. Platform release checks use
`mise exec -- npm run native:verify:ios`,
`mise exec -- npm run native:verify:android`, or the combined
`mise exec -- npm run native:verify`; each rebuilds, syncs, and requires the
copied native web payload to match. Apple identity coverage separately exercises nonce
hashing, Android state validation, per-platform plugin arguments,
restore/attach/sessionless behavior, silent cancellation, conflict handling,
and rejection before Supabase on invalid results. A Playwright startup contract
observes the real built Home when the native bridge receives its one splash
hide call; the focused unit contract also verifies boot-error release and that
widget/web startup remains independent of Capacitor.

The iOS contract also requires the App target's Debug and Release
configurations to reference the exact Sign in with Apple and Game Center
entitlement request. App Store listing delivery stays a separate focused
contract: `appstore:screenshots:contract` checks listing identity, exports,
Fastlane pinning, and mutation guardrails; `appstore:screenshots:test` exercises
the pure target-set planner; and `appstore:screenshots:check` repeats the
contract through pinned Fastlane and proves every export maps to
`APP_IPHONE_67`. The authenticated `plan` lane is read-only. The `upload` lane
is an external mutation and must remain outside `npm test` and CI; it requires
committed reviewed inputs, campaign approval, and an inventory-bound
confirmation token.

The `android` CI job is deliberately separate from the web and database gates.
It provisions Node 24, Java 21, Android SDK/build-tools 36, installs both npm
lockfiles, syncs Android, runs the Android shipping contract, then executes:

```text
testDebugUnitTest lintDebug assembleDebug bundleRelease
```

CI has no `keystore.properties`, upload keystore, or Play API credentials, so
`bundleRelease` is unsigned. The post-build contract uses a checksum-pinned
bundletool 1.18.3 to inspect the AAB's own package, version, SDK, security
metadata, and signing state before the workflow uploads
`knucklebones-neon-unsigned-aab` as a seven-day, verification-only artifact.
It is never a publishable substitute for
`mise exec -- npm run native:bundle:android`, and there is no automatic Play
publication.

Before a native release, run the full Node 24 `mise exec -- npm test` gate, the focused
native/identity/startup contracts, CocoaPods plus an unsigned iOS simulator
build, and the Android Gradle/AAB job. Repository gates do not replace device
acceptance:

Apple capability activation and repository entitlement wiring were completed
on 2026-08-25, but profile uptake, signed archive/device acceptance, Game Center
backend rollout, and both stores' signed-release rehearsals remain required
release gates. Static shell validation does not mark them complete.

| Target | Required acceptance |
|---|---|
| iOS 15+ | Cold and warm launch in light and dark mode; branded splash continuity; safe areas; rotation; back navigation; resume; Apple attach and restore. |
| Android API 24 | Cold/warm launch, splash continuity, safe areas, rotation, system back, resume, core offline/ranked navigation, and—once externally unblocked—Apple attach/restore on the minimum SDK. |
| Android API 31 | Repeat every Android behavior, including Apple attach/restore once unblocked, across the Android 12 system-splash boundary. |
| Android API 35 | Repeat with enforced edge-to-edge, gesture and three-button navigation, cutouts, keyboard, and system-bar contrast. |
| Android API 36 | Repeat every Android behavior, including predictive Back and Apple attach/restore once unblocked, on the Play target. |
| Cross-platform identity | Attach or restore the same Apple identity on iOS and Android and prove it preserves the same Supabase user, profile, rating, and history. |

Android Apple sign-in remains release-blocked until the associated iOS app with
Sign in with Apple is live on the App Store. Passing mocks, Gradle, or an Android
device before then does not clear that external prerequisite.

## Live tests

Live PvP checks use environment-provided disposable credentials and a clearly
identified `KB_E2E_TARGET` (`local`, `staging`, or `production`). Every run
requires `KB_ALLOW_LIVE_E2E=1`; production additionally requires
`KB_ALLOW_PROD_E2E=1`, local is restricted to loopback, staging must match
`KB_E2E_STAGING_HOST`, and the production hostname cannot be disguised with a
safer label. The browser probe uses the production-configured app build and is
therefore production-only; the API probe supports all three targets. Use
dedicated test accounts. Both probes establish a clean participant baseline,
then use `finally` cleanup to dequeue those accounts and resign any active test
matches even after an assertion or browser failure. Review the report for
cleanup errors and remove any accounts a probe creates. Never commit live
credentials or make a live probe part of `npm test`.

## Change verification

Run the narrow owner suite while iterating. Before handoff or deployment,
decide whether focused/specialized gates cover the affected surface decisively;
run the full gate when the scope or remaining risk warrants it. CSS moves
additionally require same-machine before/after visual or computed style
comparison. Backend changes require authorization, race/idempotency, and
rollback coverage. Build/native changes require artifact-level checks rather
than treating a successful TypeScript compile as delivery proof.

## One suite, two engines

`tests/browser/online-ui/` runs WebKit. That is why a Chromium-only scroll
bug — native scroll anchoring compensating a prepend that the ladder was
already compensating by hand — shipped and stayed shipped: the suite is
structurally incapable of seeing an effect the engine does not implement. When
a change turns on behaviour that only one engine has, the check belongs in that
engine, and it must also assert the engine can express the feature at all, or a
negative reading is indistinguishable from ignorance. See `styles.md`.

Two harness traps worth knowing before writing a scroll probe here:

- **Never give this suite `isMobile` / `devices['iPhone 13']`.** Every other
  browser tree does, but under WebKit it silently disables `page.route()` — the
  Supabase stubs stop firing and the suite talks to the live backend — and it
  makes `page.mouse.wheel` throw outright. `harness/visit.mjs` says so where it
  omits the flag.
- **Shadowing `scrollTop` does not observe scrolling.** An own accessor on the
  element sees assignments only: measured in this harness, a wheel took the
  scroller from 580 to 980 with an empty write log, and `scrollTo` and
  `scrollIntoView` are invisible to it too. A scroll JUMP produces no assignment
  at all, so such a probe reports "no writes" and proves nothing. Record a
  `scroll`-event timeline instead and keep the accessor, if at all, as an
  annotation on top of it.

Fixtures for the ladder carry the RPC's dense `pos` and `population`. A mock
that omits a field a migration added keeps a broken client green — and this one
is load-bearing, because the client places a page by `pos` and would otherwise
fall back to counting from a cursor.
