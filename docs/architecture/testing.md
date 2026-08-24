# Testing architecture

Read this page before changing tests, CI, browser harnesses, or release gates.

## Release gate

`npm test` runs `tests/run-all.mjs`. The runner builds first, executes pure
Node contracts, browser behaviour suites, design checks, and the AI benchmark,
then restores build output changed by update tests. Use it before pushing
cross-cutting or high-risk changes, changes without decisive focused coverage,
and shared build/test infrastructure changes. A well-contained, low-risk
change may instead use its focused owner and specialized gates; never push a
known failure, and report explicitly when the full gate was not run. The runner
propagates `process.execPath` to every child build, suite, and benchmark,
preserving the validated Node 24 runtime for the whole gate even on a machine
with another `node` earlier on `PATH`.

Database contracts are a sibling CI gate because they require Docker and a
fresh Supabase database: `npm run db:start`, `npm run test:db`, then schema
lint. The start helper mirrors the project without raw Edge Function sources
and starts only PostgreSQL; deployable function closures are materialized and
Deno-checked separately. Run the database sequence locally for every
migration, grant, RLS, or RPC change.

The gate holds `.gate.lock` because build output is shared inside one working
tree. Servers use kernel-assigned ports, so independent worktrees may gate in
parallel. Use `KB_JOBS=2` under machine contention and repeat a timing failure
alone before treating it as a product regression.

## Test ownership

Tests should be discoverable by what they prove rather than a growing numeric
sequence. The target organization is:

```text
tests/
  core/         rules, replay, modes, spells, ladder, AI contracts
  browser/      screens, input, responsive layout, accessibility, PWA
  contracts/    architecture, CSS graph/reach, function sync, native identity
  e2e/          isolated end-to-end workflows
  live/         explicit external probes, never part of the default gate
  support/      server, report, browser-app, and Supabase mock helpers
```

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

`npm run test:native` runs the static iOS and Android shipping contracts
without requiring a sync. Platform release checks use
`npm run native:verify:ios`, `npm run native:verify:android`, or the combined
`npm run native:verify`; each rebuilds, syncs, and requires the copied native
web payload to match. Apple identity coverage separately exercises nonce
hashing, Android state validation, per-platform plugin arguments,
restore/attach/sessionless behavior, silent cancellation, conflict handling,
and rejection before Supabase on invalid results. A Playwright startup contract
observes the real built Home when the native bridge receives its one splash
hide call; the focused unit contract also verifies boot-error release and that
widget/web startup remains independent of Capacitor.

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
It is never a publishable substitute for `npm run native:bundle:android`, and
there is no automatic Play publication.

Before a native release, run the full Node 24 `npm test` gate, the focused
native/identity/startup contracts, CocoaPods plus an unsigned iOS simulator
build, and the Android Gradle/AAB job. Repository gates do not replace device
acceptance:

Apple/Game Center device acceptance and both stores' signed-release rehearsals
were explicitly deferred by the owner on 2026-08-24. They remain required
release gates; the current shell-validation pass does not mark them complete.

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
