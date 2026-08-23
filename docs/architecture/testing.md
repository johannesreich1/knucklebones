# Testing architecture

Read this page before changing tests, CI, browser harnesses, or release gates.

## Release gate

`npm test` runs `tests/run-all.mjs`. The runner builds first, executes pure
Node contracts, browser behaviour suites, design checks, and the AI benchmark,
then restores build output changed by update tests. A push to `main` must never
precede a green full gate.

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

Run the narrow owner suite while iterating, then the full gate before handoff.
CSS moves additionally require same-machine before/after visual or computed
style comparison. Backend changes require authorization, race/idempotency, and
rollback coverage. Build/native changes require artifact-level checks rather
than treating a successful TypeScript compile as delivery proof.
