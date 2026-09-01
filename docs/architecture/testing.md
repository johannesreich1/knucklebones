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

During iteration, select one or more exact manifest owners without paying for
unrelated suites:

```text
mise exec -- npm test -- --suite architecture
mise exec -- npm test -- --suite production-test-data --suite typecheck-tests
```

The gate prints that command with the first failing suite id. Selection is not
a cached resume: local suites run concurrently, and a fix changes the tree, so
there is no truthful linear checkpoint. A focused run still validates the full
manifest, builds once, takes the repository gate lock, starts a server only
when a selected owner needs one, and preserves `pwa-update` as exclusive/final.
It is for decisive iteration and contained handoff checks; the native-aware
release helper deliberately invokes the unfiltered full gate before pushing.

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

The gate holds one lock per REPOSITORY — a file in the temp directory named
after the shared `.git` directory — so every worktree of this clone queues and
a separate clone stays independent. Build output is shared inside a tree, and
the machine is shared between them. Servers use kernel-assigned ports, so
parallel worktree gates are correct; they are not affordable. Three at once
reached load average 284 here and failed on starvation alone — 30s waits for
buttons already in the markup, screenshots timing out after fonts had loaded,
benches 40-50% over budget — and one release took five attempts to find a quiet
moment. Serial gates finish sooner than contended ones plus their retries, and
they do not lie. `KB_NO_LOCK=1` skips the wait for one deliberate run. Playwright harnesses must
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
  current deal, durable unseen reward presentation, and the reward card's door
  into the shared rune entry. Pure outcome coverage owns RANDOM's Trial admission and odds;
  do not claim a browser workflow until it actually drives that workflow.
- Equipped-standard coverage treats the two match-row seats independently:
  pure replay accepts known rune/null, null/known, and null/null action deals
  while rejecting unknown non-null ids. Ranked WebKit coverage proves an
  ordinary fresh match never paints the paired rune-reveal screen, even when
  immutable assignments are present; that reveal belongs only to Rune Trial.
  Rejoin remains silent. Profile and database cases distinguish permanent
  historical-SILVER activation from a never-SILVER waiting/null seat and prove
  that eligible RANDOM resolves to an owned rune rather than NONE. The explicit
  `mise exec -- npm run test:db:historical-silver-upgrade` gate resets only the
  local database to the deployed progression version, exercises legacy
  demotion/prior-Silver/never-Silver/old-crossing rows through the pending
  migration, and always restores the latest local schema.
- Database Rune Trial contracts exercise grants/RLS and negative visibility,
  v1/v2 queue capability isolation, stale-claim rejection, idempotent
  selection/action retries, deadline auto-picks, atomic terminal action reward,
  duplicate versus first reward, durable acknowledgement, monotonic
  promotion/no-demotion, ANVIL reservation plus bot follow-up, and the legacy
  LIMITED constraint. Resignation, timeout, deletion, draw/loss no-reward,
  historical backfill, and full bot-Trial settlement need explicit pgTAP cases
  before this page may describe them as database-covered.
- Client idempotency coverage holds Rune Trial selection and every protocol-v2
  aim, cast, and place input—including equipped standard—closed across a lost
  response plus an unchanged authoritative read, and proves every retry reuses
  the original command id until the delayed commit is observed or the server
  returns a definitive rejection.
- Mocks match the authoritative API or migration result shape. A hand-written
  mock that omits a renamed field can keep a broken client green.
- Test hooks such as `window.__kb`, `__kbOnline`, `__kbResult`, and
  `__kbRankedReveal` are stable driver surfaces. Production modules must not
  import a lazy feature merely to expose a test hook.
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

Native Share is statically gated for its exact package, pod, Gradle
registration, and copied plugin manifests. Final device acceptance still opens
the result sheet on iPhone/iPad and Android, dismisses it, returns to the app,
and verifies the recipient receives the public URL; UIKit/chooser presentation
cannot be proven by the web harness or an unsigned compiler build.

Profile launcher icons have three complementary owners. Pure contracts derive
all 42 avatars from the face/hue registries and exercise the off-by-default,
install-local preference; enable/current-avatar sync; enabled-only confirmed
read/save sync; explicit-Off, sign-out, account-replacement, and disabled-boot
primary reset; stale-account rejection; latest-wins serialization; unavailable
bridges; and cosmetic native failures. Browser contracts require the control to
appear only when the native iOS/Android bridge exists and to be absent from the
web/PWA/widget Settings layout, whose icon remains fixed. The disabled-boot
case also pins the repair path for installs exposed to the briefly released
automatic behaviour. Native shell contracts pin the local plugin packages and
registration, iOS's primary plus exact 41 alternate catalogs/build settings,
Android's exact 42 aliases and component state policy, iOS Any/Dark/Tinted and
Android adaptive/legacy/monochrome resource contracts, and the timestamp-free
`native/profile-app-icons.manifest.json` mappings and hashes. Pixel contracts
require every Dark rendition to be byte-identical to its opaque, shimmering
Light partner; they also reject a washed-out neon die, a non-cutout Tinted
face, and any hard seam in the full-canvas native splash glow.
Regenerating twice must leave the manifest and representative assets
byte-identical. None of those checks proves that SpringBoard or an OEM launcher
has repainted its pixels.

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

- On signed iPhone and iPad builds, select the primary, at least one value of
  every face and every hue, and two successive alternates. Confirm the iOS
  system alert appears only for a real change, relaunch/reconciliation of the
  already-selected icon is silent, and returning to `die:5:cy` restores the
  primary. Inspect authored Light/Dark/Tinted plus system-derived Clear Home,
  Spotlight, Settings, and notification appearances.
- On API 24 and API 33+ devices, exercise primary → alternate → alternate →
  primary, then cold launch from the selected alias. Inspect legacy, adaptive,
  round-masked, and themed monochrome presentations. Record launcher/OEM and
  allow its cache to settle; PackageManager convergence is the assertion, not
  an immediate claim that a Home-screen item repainted in place.
- On both platforms, prove a failed avatar save leaves the launcher unchanged,
  a native icon failure does not undo a successful profile save, the latest of
  overlapping profile/reset requests wins, and sign-out or account replacement
  restores primary before the next account reconciles. Throughout, native
  splash, in-app loading, PWA, and widget art must remain the cyan five.

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

## Regression coverage for bug fixes

Every bug fix carries a test that fails without the fix. Write it first and
watch it go red against the unfixed code; a regression test that was never seen
red is only a description of current behaviour, and will keep passing when the
bug returns.

Pin the fact the player reported, at the level they reported it. A player who
says "my board is the wrong colour" is reporting a computed colour, so the test
resolves a computed colour — asserting the state that was supposed to produce it
re-tests the half that was already right. This is the assertion policy above
applied to the specific claim that failed.

A bug that reached a player also means the gate had a hole, and the hole is
usually a case the suites never varied. Ranked seats are the worked example: the
board's colours were only ever exercised from the seat offline play uses, so a
mismatch that appears in the other seat was invisible for as long as the feature
existed. Close the hole as well as the bug — cover both sides of whatever
variable went untested — and name in the commit which test now fails without the
change.

## Traps this harness has already fallen into

Each of these cost a real debugging session, and each looked like something else
first. They are recorded with the measurement that settled them, because in
every case reasoning harder produced a confident wrong answer and measuring
produced the right one in minutes.

**A report over 64KB loses its tail — but only under the gate.** A suite prints
one JSON report and forces its own exit. Under `run-all` stdout is a PIPE, and
pipe writes are asynchronous: `process.exit()` returns immediately and discards
whatever the 64KB buffer has not taken. Run the same suite by hand and stdout is
a file, the write is synchronous, and nothing is lost. `run-all` treats an
unparseable report as FAILED, correctly — so the suite fails with no failing
check anywhere in it. Measured: 65,536 bytes captured against a 79,714-byte
report, after four green standalone runs of the same commit. Every suite emits
through `tests/support/emit-report.mjs`, which drains before exiting. Reproduce
the gate's condition with `node <suite> | cat > /tmp/x.log`, never a bare run.

**The online UI WebKit process is recycled at a measured context margin.** The
tree opens and closes a fresh context for every visit, but on this development
machine a single WebKit process stopped beginning navigations at about the
sixtieth context: `page.goto` waited the full timeout before
`domcontentloaded`, while the exact scenario passed in a fresh browser. The
runner therefore recycles WebKit after 48 completed visit calls, between
contexts. Keep the stable visit wrapper; removing the recycle makes the full
tree red long before a focused scenario can reproduce the failure.

**An overlay's `hidden` attribute means nothing.** `.ov` gates on the `on`
CLASS: without it the element is `visibility:hidden` and `pointer-events:none`,
so a hit test lands on whatever is behind. `element.hidden` is always false on
these, and a probe that reports it will state confidently that the sheet is open
while the player cannot touch it. Report `className` and the computed
`visibility` / `pointerEvents` instead.

**Starting a game hides the setup sheet, and the start may still be pending.**
`flow/local-start.ts` hides `#ovPractice` as part of starting. A test that
dismisses a reveal and returns to setup can beat that hide: it reopens the
sheet, the pending start lands, and the sheet closes again — leaving a control
the board covers permanently, not for a frame, so no longer wait rescues it.
Waiting for a live phase does not help either; the close was observed with
`S.phase` already `roll`. Opening a sheet and pressing something on it must
therefore retry as ONE unit — separating them just moves the failure into the
gap, where it reappears as `element is not visible` on a control verified
reachable moments earlier. `tests/browser/support/hittable.mjs` owns that.

**The tapped column fills before anything is placed.** A probe timing a
placement by watching the column's `.slot` elements is timing the PREVIEW. It
will pass with the feature disabled — which is how an optimistic-move fix was
nearly abandoned as unnecessary. Time `window.__kb.S.boards`, the state
`renderSide` paints from: a die there is a placement and nothing else.

**Counting nodes is not seeing.** A hidden element still answers
`querySelectorAll`, and a beat still HAS a name for assistive tech even when the
shell no longer prints it. An assertion that counts nodes passes whether the
player sees them or not. Measure the box, as the assertion policy above already
requires.

**Ranked has two protocol paths and they drift.** Legacy rune-free standard play
goes through `pvp-move`; protocol-v2 Rune Trial and equipped standard play go
through `pvp-action` into the authoritative action log. `trial` distinguishes
the private-selection format, not the transport. Behaviour added to one path
silently misses the other — that is how Trial once kept the full server round
trip after v1 had stopped feeling it. Change one, check both, including a
one-sided standard rune deal and an action-protocol null/null deal.

**A red run against a stale `dist/` is not a red run.** The browser suites serve
the BUILT tree, and `npm run build` typechecks first — so removing a fix to watch
its test fail can leave the build refusing (`error TS6133: declared but never
read`, from the import the fix was the only user of) while the suite happily
re-runs the PREVIOUS, fixed bundle and passes. That is the worst possible
outcome: it reads as "the test does not detect this", which invites weakening the
test. Measured 2026-08-29 on the flying-die colour fix, twice in a row. So
disable a fix in a way that still compiles — an early return behind a
`const OFF: boolean = true`, never a deleted call — and CHECK the build succeeded
before believing the run.

REBUILD AFTER THE RESTORE TOO. The trap has a second face, and it caught the same
session twice: restoring the fix and re-running WITHOUT rebuilding measures the
reverted bundle and reports the fix as broken. On 2026-08-29 that produced a
"the fix does not work" reading of a refused ranked aim that was entirely an
artefact of a stale `dist/`. Treat every source edit in a red/green pair —
including the one that puts the code back — as requiring its own build. Do not
grep `dist/` for a comment to confirm: minification strips them, so an absent
marker proves nothing.

**A clamped counter cannot show a doubled action.** `spendChargePresentation`
floors a charge at zero, so spending a one-use rune twice reads exactly like
spending it once, and an assertion on `S.spellCharges` passes either way. What
the player sees is the CARD leaving the rail — one `.rune-played` copy per spend
— so count those. The same reasoning found that the ANVIL double-spend is not
observable at all today (its single charge is already gone by cast time, so the
second spend finds no card to fly): said plainly in the test rather than left as
a green tick implying a guard that is not there.

**A test block inserted after a `return` is green forever.** Adding a case by
splicing text into a file can land it inside the nearest function rather than at
top level — after that function's `return`, where it is unreachable. It compiles,
the suite passes, the report looks normal, and the case has never run. Measured
2026-08-30: a guest-replacement case landed inside a stub's `signIn` body and
reported green with the guard under test both ON and OFF.
The tell is cheap: a case that never runs leaves no trace in the report's own
output (the stub's recorded calls did not grow). So when a new case passes on the
FIRST run, disable the code it guards and watch it fail before believing it —
and if it passes both ways, suspect placement before logic, then read the lines
around it rather than the diff you thought you wrote.

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
